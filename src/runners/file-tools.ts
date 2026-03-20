/**
 * msgcode: File Tools Runner
 *
 * 职责：
 * - 处理 read_file / write_file / edit_file 的路径解析与 fs_scope 边界
 * - 处理二进制探测与大文件 preview
 * - 处理 edit_file 补丁语义与简写兼容
 */

import { isUtf8 } from "node:buffer";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { getFsScope } from "../config/workspace.js";
import { logger } from "../logger/index.js";

const READ_FILE_BINARY_SNIFF_BYTES = 4096;
const READ_FILE_INLINE_BYTE_LIMIT = 64 * 1024;
const READ_FILE_PREVIEW_BYTES = 16 * 1024;
const READ_FILE_TAIL_PREVIEW_BYTES = 4096;

type FileRunnerErrorCode = "TOOL_NOT_ALLOWED" | "TOOL_EXEC_FAILED" | (string & {});

export interface EditFileEdit {
  oldText: string;
  newText: string;
}

interface FileRunnerError {
  ok: false;
  code: FileRunnerErrorCode;
  message: string;
  previewText?: string;
}

interface FileRunnerContext {
  workspacePath: string;
  timeoutMs?: number;
}

export interface ReadFileRunnerSuccess {
  ok: true;
  filePath: string;
  content: string;
  byteLength: number;
  truncated?: boolean;
}

export interface WriteFileRunnerSuccess {
  ok: true;
  filePath: string;
  displayPath: string;
  bytesWritten: number;
}

export interface EditFileRunnerSuccess {
  ok: true;
  filePath: string;
  displayPath: string;
  editsApplied: number;
}

export type ReadFileRunnerResult = ReadFileRunnerSuccess | FileRunnerError;
export type WriteFileRunnerResult = WriteFileRunnerSuccess | FileRunnerError;
export type EditFileRunnerResult = EditFileRunnerSuccess | FileRunnerError;

export function normalizeEditFileEditsInput(
  args: Record<string, unknown>
): EditFileEdit[] | null {
  if (Array.isArray(args.edits) && args.edits.length > 0) {
    return args.edits as EditFileEdit[];
  }

  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    return [{ oldText: args.oldText, newText: args.newText }];
  }

  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms = 120000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("TOOL_TIMEOUT")), ms)),
  ]);
}

function isPathWithinWorkspace(targetPath: string, workspacePath: string): boolean {
  const normalizedWorkspace = resolve(workspacePath);
  const normalizedTarget = resolve(targetPath);

  if (normalizedTarget === normalizedWorkspace) {
    return true;
  }

  const workspacePrefix = normalizedWorkspace.endsWith(sep)
    ? normalizedWorkspace
    : `${normalizedWorkspace}${sep}`;

  return normalizedTarget.startsWith(workspacePrefix);
}

async function resolveFilePath(
  tool: "read_file" | "write_file" | "edit_file",
  inputPath: string,
  ctx: FileRunnerContext
): Promise<{ ok: true; filePath: string } | FileRunnerError> {
  const fsScope = await getFsScope(ctx.workspacePath);
  const filePath = fsScope === "unrestricted" && isAbsolute(inputPath)
    ? inputPath
    : resolve(ctx.workspacePath, inputPath);

  if (fsScope === "workspace" && !isPathWithinWorkspace(filePath, ctx.workspacePath)) {
    logger.warn("File tool path denied by fs_scope policy", {
      module: "file-runner",
      tool,
      fsScope,
      inputPath,
      resolvedPath: filePath,
      workspacePath: ctx.workspacePath,
    });
    return {
      ok: false,
      code: "TOOL_NOT_ALLOWED",
      message: `path must be under workspace (fsScope: ${fsScope}, path: ${inputPath})`,
    };
  }

  return {
    ok: true,
    filePath,
  };
}

function detectBinaryKind(sample: Buffer): string | undefined {
  if (sample.length >= 8 && sample.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "PNG 图片";
  }
  if (sample.length >= 3 && sample[0] === 0xff && sample[1] === 0xd8 && sample[2] === 0xff) {
    return "JPEG 图片";
  }
  if (sample.length >= 6) {
    const header6 = sample.subarray(0, 6).toString("ascii");
    if (header6 === "GIF87a" || header6 === "GIF89a") {
      return "GIF 图片";
    }
  }
  if (sample.length >= 12) {
    const riff = sample.subarray(0, 4).toString("ascii");
    const webp = sample.subarray(8, 12).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") {
      return "WEBP 图片";
    }
  }
  if (sample.length >= 4 && sample.subarray(0, 4).toString("ascii") === "%PDF") {
    return "PDF 文件";
  }
  if (sample.length >= 4 && sample[0] === 0x50 && sample[1] === 0x4b && sample[2] === 0x03 && sample[3] === 0x04) {
    return "ZIP 压缩包";
  }
  if (sample.includes(0)) {
    return "二进制文件";
  }
  let utf8Like = false;
  for (let trim = 0; trim <= 3 && trim < sample.length; trim += 1) {
    const candidate = trim === 0 ? sample : sample.subarray(0, sample.length - trim);
    if (candidate.length > 0 && isUtf8(candidate)) {
      utf8Like = true;
      break;
    }
  }
  if (!utf8Like) {
    return "二进制文件";
  }
  return undefined;
}

function buildReadFileBinaryMessage(filePath: string, kind: string): string {
  return [
    `read_file 无法直接按 UTF-8 读取该文件：${kind}`,
    `path: ${filePath}`,
  ].join("\n");
}

function buildTruncatedReadFileContent(params: {
  head: string;
  tail: string;
  byteLength: number;
}): string {
  const parts = [
    "[head]",
    params.head,
    `[... truncated ${(params.byteLength - Buffer.byteLength(params.head, "utf-8") - Buffer.byteLength(params.tail, "utf-8"))} bytes ...]`,
  ];

  const trimmedTail = params.tail.trim();
  if (trimmedTail) {
    parts.push("[tail]");
    parts.push(trimmedTail);
  }

  return parts.join("\n");
}

export async function runReadFileTool(
  args: { path: string },
  ctx: FileRunnerContext
): Promise<ReadFileRunnerResult> {
  const pathResult = await resolveFilePath("read_file", args.path, ctx);
  if (!pathResult.ok) {
    return pathResult;
  }

  const filePath = pathResult.filePath;

  try {
    const fileStat = await withTimeout(stat(filePath), ctx.timeoutMs ?? 30000);
    if (!fileStat.isFile()) {
      return {
        ok: false,
        code: "TOOL_EXEC_FAILED",
        message: `read_file 只能读取普通文件，当前路径不是文件：${filePath}`,
        previewText: `read_file 无法读取：${filePath}\n原因：目标不是普通文件。`,
      };
    }

    let largeFilePreview = "";
    const handle = await withTimeout(open(filePath, "r"), ctx.timeoutMs ?? 30000);
    try {
      const sampleBuffer = Buffer.alloc(Math.min(READ_FILE_BINARY_SNIFF_BYTES, Math.max(fileStat.size, 1)));
      const { bytesRead } = await withTimeout(
        handle.read(sampleBuffer, 0, sampleBuffer.length, 0),
        ctx.timeoutMs ?? 30000
      );
      const sample = sampleBuffer.subarray(0, bytesRead);
      const binaryKind = detectBinaryKind(sample);
      if (binaryKind) {
        const message = buildReadFileBinaryMessage(filePath, binaryKind);
        return {
          ok: false,
          code: "TOOL_EXEC_FAILED",
          message,
          previewText: message,
        };
      }

      if (fileStat.size > READ_FILE_INLINE_BYTE_LIMIT) {
        const headBytes = Math.min(READ_FILE_PREVIEW_BYTES, fileStat.size);
        const headBuffer = Buffer.alloc(headBytes);
        const headRead = await withTimeout(
          handle.read(headBuffer, 0, headBuffer.length, 0),
          ctx.timeoutMs ?? 30000
        );
        const headText = headBuffer.subarray(0, headRead.bytesRead).toString("utf-8");

        const tailBytes = Math.min(READ_FILE_TAIL_PREVIEW_BYTES, fileStat.size);
        const tailBuffer = Buffer.alloc(tailBytes);
        const tailStart = Math.max(fileStat.size - tailBytes, 0);
        const tailRead = await withTimeout(
          handle.read(tailBuffer, 0, tailBuffer.length, tailStart),
          ctx.timeoutMs ?? 30000
        );
        const tailText = tailBuffer.subarray(0, tailRead.bytesRead).toString("utf-8");

        largeFilePreview = buildTruncatedReadFileContent({
          head: headText,
          tail: tailText,
          byteLength: fileStat.size,
        });
      }
    } finally {
      await handle.close();
    }

    if (fileStat.size > READ_FILE_INLINE_BYTE_LIMIT) {
      return {
        ok: true,
        filePath,
        content: largeFilePreview,
        byteLength: fileStat.size,
        truncated: true,
      };
    }

    const content = await withTimeout(
      readFile(filePath, "utf-8"),
      ctx.timeoutMs ?? 30000
    );

    return {
      ok: true,
      filePath,
      content,
      byteLength: fileStat.size,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "TOOL_TIMEOUT") {
      throw error;
    }

    const nodeError = error as NodeJS.ErrnoException;
    const nativeCode = typeof nodeError?.code === "string" && nodeError.code.trim()
      ? nodeError.code.trim()
      : "TOOL_EXEC_FAILED";
    let message = nodeError?.message || String(error);
    if (nodeError?.code === "ENOENT") {
      message = `文件不存在：${filePath}`;
    } else if (nodeError?.code === "EISDIR") {
      message = `目标是目录不是文件：${filePath}`;
    }

    return {
      ok: false,
      code: nativeCode,
      message,
      previewText: message,
    };
  }
}

export async function runWriteFileTool(
  args: { path: string; content: string },
  ctx: FileRunnerContext
): Promise<WriteFileRunnerResult> {
  const pathResult = await resolveFilePath("write_file", args.path, ctx);
  if (!pathResult.ok) {
    return pathResult;
  }

  const filePath = pathResult.filePath;
  await mkdir(dirname(filePath), { recursive: true });
  await withTimeout(writeFile(filePath, args.content, "utf-8"), ctx.timeoutMs ?? 30000);

  return {
    ok: true,
    filePath,
    displayPath: args.path,
    bytesWritten: Buffer.byteLength(args.content, "utf-8"),
  };
}

export async function runEditFileTool(
  args: { path: string; edits: EditFileEdit[] },
  ctx: FileRunnerContext
): Promise<EditFileRunnerResult> {
  const pathResult = await resolveFilePath("edit_file", args.path, ctx);
  if (!pathResult.ok) {
    return pathResult;
  }

  const filePath = pathResult.filePath;
  let content = await withTimeout(readFile(filePath, "utf-8"), ctx.timeoutMs ?? 30000);

  let editsApplied = 0;
  for (const edit of args.edits) {
    if (typeof edit.oldText !== "string" || typeof edit.newText !== "string") {
      throw new Error("each edit must have oldText and newText as strings");
    }

    if (!content.includes(edit.oldText)) {
      throw new Error(`oldText not found in file: ${edit.oldText.substring(0, 100)}...`);
    }

    content = content.replace(edit.oldText, edit.newText);
    editsApplied++;
  }

  await withTimeout(writeFile(filePath, content, "utf-8"), ctx.timeoutMs ?? 30000);

  return {
    ok: true,
    filePath,
    displayPath: args.path,
    editsApplied,
  };
}

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
const READ_FILE_PAGE_BYTE_LIMIT = 16 * 1024;
const READ_FILE_UTF8_SLACK_BYTES = 3;

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
  kind: "text" | "binary";
  content?: string;
  byteLength: number;
  totalBytes: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
  totalLines?: number;
  binaryKind?: string;
  handle?: string;
  blob?: {
    type: "file";
    path: string;
    byteLength: number;
    mediaKind?: string;
  };
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

function parseOptionalNonNegativeInteger(
  value: unknown,
  field: "offset" | "limit"
): number | FileRunnerError {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const parsed = typeof value === "number"
    ? value
    : (typeof value === "string" ? Number(value) : Number.NaN);

  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return {
      ok: false,
      code: "TOOL_BAD_ARGS",
      message: `read_file: '${field}' must be a non-negative integer when provided`,
    };
  }

  return parsed;
}

function finalizeUtf8Page(buffer: Buffer, maxBytes: number): { text: string; bytesUsed: number } {
  const hardLimit = Math.min(buffer.length, Math.max(0, maxBytes + READ_FILE_UTF8_SLACK_BYTES));

  for (let trim = 0; trim <= READ_FILE_UTF8_SLACK_BYTES; trim += 1) {
    const candidateLength = hardLimit - trim;
    if (candidateLength <= 0) {
      continue;
    }
    const candidate = buffer.subarray(0, candidateLength);
    if (isUtf8(candidate)) {
      return {
        text: candidate.toString("utf-8"),
        bytesUsed: candidateLength,
      };
    }
  }

  const fallback = buffer.subarray(0, Math.min(buffer.length, maxBytes));
  return {
    text: fallback.toString("utf-8"),
    bytesUsed: fallback.length,
  };
}

export async function runReadFileTool(
  args: { path: string; offset?: unknown; limit?: unknown },
  ctx: FileRunnerContext
): Promise<ReadFileRunnerResult> {
  const pathResult = await resolveFilePath("read_file", args.path, ctx);
  if (!pathResult.ok) {
    return pathResult;
  }

  const filePath = pathResult.filePath;
  const offset = parseOptionalNonNegativeInteger(args.offset, "offset");
  if (typeof offset !== "number") {
    return offset;
  }
  const rawLimit = parseOptionalNonNegativeInteger(args.limit, "limit");
  if (typeof rawLimit !== "number") {
    return rawLimit;
  }

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
        return {
          ok: true,
          kind: "binary",
          filePath,
          byteLength: fileStat.size,
          totalBytes: fileStat.size,
          offset: 0,
          limit: 0,
          hasMore: false,
          nextOffset: null,
          binaryKind,
          handle: `blob:${filePath}`,
          blob: {
            type: "file",
            path: filePath,
            byteLength: fileStat.size,
            mediaKind: binaryKind,
          },
        };
      }

      if (offset > fileStat.size) {
        return {
          ok: false,
          code: "TOOL_BAD_ARGS",
          message: `read_file: offset ${offset} 超出文件大小 ${fileStat.size}`,
          previewText: `read_file 无法读取：${filePath}\n原因：offset ${offset} 超出文件大小 ${fileStat.size}。`,
        };
      }

      const wantsInlineFull = fileStat.size <= READ_FILE_INLINE_BYTE_LIMIT
        && offset === 0
        && rawLimit === 0;

      if (wantsInlineFull) {
        const buffer = await withTimeout(readFile(filePath), ctx.timeoutMs ?? 30000);
        const content = buffer.toString("utf-8");
        return {
          ok: true,
          kind: "text",
          filePath,
          content,
          byteLength: fileStat.size,
          totalBytes: fileStat.size,
          offset: 0,
          limit: fileStat.size,
          hasMore: false,
          nextOffset: null,
          totalLines: content.split("\n").length,
          truncated: false,
        };
      }

      const defaultLimit = fileStat.size <= READ_FILE_INLINE_BYTE_LIMIT
        ? Math.max(fileStat.size - offset, 0)
        : READ_FILE_PAGE_BYTE_LIMIT;
      const requestedLimit = rawLimit > 0 ? rawLimit : defaultLimit;
      const remainingBytes = Math.max(fileStat.size - offset, 0);
      const readWindow = Math.min(
        remainingBytes,
        requestedLimit + READ_FILE_UTF8_SLACK_BYTES
      );

      const pageBuffer = Buffer.alloc(readWindow);
      const pageRead = await withTimeout(
        handle.read(pageBuffer, 0, pageBuffer.length, offset),
        ctx.timeoutMs ?? 30000
      );
      const pageSlice = pageBuffer.subarray(0, pageRead.bytesRead);
      const page = finalizeUtf8Page(pageSlice, requestedLimit);
      const pageLimit = page.bytesUsed;
      const nextOffset = offset + pageLimit;

      return {
        ok: true,
        kind: "text",
        filePath,
        content: page.text,
        byteLength: fileStat.size,
        totalBytes: fileStat.size,
        offset,
        limit: pageLimit,
        hasMore: nextOffset < fileStat.size,
        nextOffset: nextOffset < fileStat.size ? nextOffset : null,
        truncated: offset > 0 || nextOffset < fileStat.size,
      };
    } finally {
      await handle.close();
    }
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

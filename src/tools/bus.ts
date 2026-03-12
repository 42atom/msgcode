/**
 * msgcode: Tool Bus - 统一工具执行闸门
 *
 * 默认策略：explicit 模式（显式命令触发），避免依赖 tool-calls 玄学
 * 可选策略：autonomous 模式（模型自主编排）
 *
 * 职责：
 * - canExecuteTool(): 统一判定工具是否可执行
 * - executeTool(): 统一执行包装（超时、错误码、日志、产物路径）
 * - sideEffects 分级：read-only / local-write / message-send / process-control
 * - 结构化日志：所有工具执行通过 recordToolEvent 记录到 telemetry
 */

import type {
  ToolName, ToolSource, ToolPolicy, ToolContext, ToolResult, SideEffectLevel
} from "./types.js";
import { isUtf8 } from "node:buffer";
import { resolve as resolvePath, sep as pathSep } from "node:path";
import { getFsScope, getToolPolicy } from "../config/workspace.js";
import { getHelpDocsData } from "../cli/help.js";
import { runTts } from "../runners/tts.js";
import { runAsr } from "../runners/asr.js";
import { runVision } from "../runners/vision.js";
import { runBashCommand } from "../runners/bash-runner.js";
import {
  executeBrowserOperation,
  BrowserCommandError,
  BROWSER_ERROR_CODES,
  type BrowserOperation,
} from "../runners/browser-patchright.js";
import { logger } from "../logger/index.js";
import { recordToolEvent } from "./telemetry.js";
import { filterDefaultLlmTools } from "./manifest.js";

const TOOL_META: Record<ToolName, { sideEffect: SideEffectLevel }> = {
  tts: { sideEffect: "message-send" },
  asr: { sideEffect: "local-write" },
  vision: { sideEffect: "local-write" },
  mem: { sideEffect: "local-write" },
  bash: { sideEffect: "process-control" },
  browser: { sideEffect: "process-control" },
  desktop: { sideEffect: "local-write" },  // T6.1: observe 会落盘 evidence
  // P5.6.13-R1A-EXEC: run_skill 已退役
  read_file: { sideEffect: "read-only" },  // P5.6.8-R3: PI 四基础工具
  help_docs: { sideEffect: "read-only" },
  write_file: { sideEffect: "local-write" },
  edit_file: { sideEffect: "local-write" },
  feishu_send_file: { sideEffect: "message-send" },  // 飞书文件发送
  feishu_list_members: { sideEffect: "read-only" },  // 飞书群成员查询
  feishu_list_recent_messages: { sideEffect: "read-only" },  // 飞书最近消息查询
  feishu_reply_message: { sideEffect: "message-send" },  // 飞书消息回复
  feishu_react_message: { sideEffect: "message-send" },  // 飞书消息表情回复
};

const MEDIA_PIPELINE_ALLOWED: ToolName[] = ["asr", "vision"];
const TOOL_PREVIEW_MAX_CHARS = 4000;
const READ_FILE_BINARY_SNIFF_BYTES = 4096;
const READ_FILE_INLINE_BYTE_LIMIT = 64 * 1024;
const READ_FILE_PREVIEW_BYTES = 16 * 1024;

export { getToolPolicy } from "../config/workspace.js";

function isPathWithinWorkspace(targetPath: string, workspacePath: string): boolean {
  const normalizedWorkspace = resolvePath(workspacePath);
  const normalizedTarget = resolvePath(targetPath);

  if (normalizedTarget === normalizedWorkspace) {
    return true;
  }

  const workspacePrefix = normalizedWorkspace.endsWith(pathSep)
    ? normalizedWorkspace
    : `${normalizedWorkspace}${pathSep}`;

  return normalizedTarget.startsWith(workspacePrefix);
}

export function canExecuteTool(
  policy: ToolPolicy,
  tool: ToolName,
  source: ToolSource
): { ok: boolean; code?: NonNullable<ToolResult["error"]>["code"]; message?: string } {
  const effectiveAllow = source === "llm-tool-call"
    ? filterDefaultLlmTools(policy.allow)
    : policy.allow;

  // 检查工具是否在允许列表中
  if (!effectiveAllow.includes(tool)) {
    return { ok: false, code: "TOOL_NOT_ALLOWED", message: `tool not allowed: ${tool}` };
  }

  // Autonomous 模式：全放行策略
  if (policy.mode === "autonomous") {
    // 不检查 source（llm-tool-call / media-pipeline / slash-command / internal 全允许）
    // 不检查 requireConfirm（自主决策，不需要确认）
    return { ok: true };
  }

  // Explicit 模式：原有逻辑保持不变
  if (policy.mode === "explicit") {
    if (source === "llm-tool-call") {
      return { ok: false, code: "TOOL_NOT_ALLOWED", message: "llm tool-call disabled in explicit mode" };
    }
    if (source === "media-pipeline" && !MEDIA_PIPELINE_ALLOWED.includes(tool)) {
      return { ok: false, code: "TOOL_NOT_ALLOWED", message: `${tool} not allowed from media-pipeline` };
    }
    if (source === "slash-command" || source === "media-pipeline" || source === "internal") {
      return { ok: true };
    }
  }

  // tool-calls 模式：预留扩展
  // 当前保持与 explicit 相同的行为

  // requireConfirm 检查（仅非 autonomous 模式）
  if (policy.requireConfirm.includes(tool) && source !== "slash-command") {
    return { ok: false, code: "TOOL_CONFIRM_REQUIRED", message: `confirm required: ${tool}` };
  }

  return { ok: true };
}

// ============================================
// P5.6.13-R1A-EXEC R2: 四核心工具参数校验
// ============================================

interface ValidationError {
  code: "TOOL_BAD_ARGS";
  message: string;
}

function normalizeEditFileEdits(
  args: Record<string, unknown>
): Array<{ oldText: string; newText: string }> | null {
  if (Array.isArray(args.edits) && args.edits.length > 0) {
    return args.edits as Array<{ oldText: string; newText: string }>;
  }

  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    return [{ oldText: args.oldText, newText: args.newText }];
  }

  return null;
}

/**
 * 校验四核心工具参数
 * 校验失败返回结构化错误，不进入工具执行体
 */
function validateToolArgs(
  tool: ToolName,
  args: Record<string, unknown>
): ValidationError | null {
  switch (tool) {
    case "read_file": {
      if (!args.path || typeof args.path !== "string" || !args.path.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "read_file: 'path' must be a non-empty string" };
      }
      break;
    }
    case "write_file": {
      if (!args.path || typeof args.path !== "string" || !args.path.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "write_file: 'path' must be a non-empty string" };
      }
      if (args.content === undefined || args.content === null) {
        return { code: "TOOL_BAD_ARGS", message: "write_file: 'content' is required" };
      }
      break;
    }
    case "help_docs": {
      if (args.query !== undefined && typeof args.query !== "string") {
        return { code: "TOOL_BAD_ARGS", message: "help_docs: 'query' must be a string when provided" };
      }
      if (args.limit !== undefined) {
        const limit = Number(args.limit);
        if (!Number.isFinite(limit) || limit <= 0) {
          return { code: "TOOL_BAD_ARGS", message: "help_docs: 'limit' must be a positive number when provided" };
        }
      }
      break;
    }
    case "edit_file": {
      if (!args.path || typeof args.path !== "string" || !args.path.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "edit_file: 'path' must be a non-empty string" };
      }
      const edits = normalizeEditFileEdits(args);
      if (!edits || edits.length === 0) {
        return {
          code: "TOOL_BAD_ARGS",
          message: "edit_file: provide either 'edits' or the shorthand pair 'oldText' + 'newText'",
        };
      }
      args.edits = edits;
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i] as Record<string, unknown>;
        if (typeof edit.oldText !== "string") {
          return { code: "TOOL_BAD_ARGS", message: `edit_file: edits[${i}].oldText must be a string` };
        }
        if (typeof edit.newText !== "string") {
          return { code: "TOOL_BAD_ARGS", message: `edit_file: edits[${i}].newText must be a string` };
        }
      }
      break;
    }
    case "bash": {
      if (!args.command || typeof args.command !== "string" || !args.command.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "bash: 'command' must be a non-empty string" };
      }
      break;
    }
    case "browser": {
      if (!args.operation || typeof args.operation !== "string" || !args.operation.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "browser: 'operation' must be a non-empty string" };
      }

      const operation = String(args.operation).trim();
      switch (operation) {
        case "instances.launch": {
          const mode = typeof args.mode === "string" ? args.mode.trim() : "headless";
          if (mode !== "headed" && mode !== "headless") {
            return { code: "TOOL_BAD_ARGS", message: "browser: 'mode' must be headed or headless" };
          }
          break;
        }
        case "instances.stop":
        case "tabs.list": {
          if (!args.instanceId || typeof args.instanceId !== "string" || !args.instanceId.trim()) {
            return { code: "TOOL_BAD_ARGS", message: `browser: '${operation}' requires 'instanceId'` };
          }
          break;
        }
        case "tabs.open": {
          if (!args.url || typeof args.url !== "string" || !args.url.trim()) {
            return { code: "TOOL_BAD_ARGS", message: "browser: 'tabs.open' requires 'url'" };
          }
          break;
        }
        case "tabs.snapshot":
        case "tabs.text":
        case "tabs.action":
        case "tabs.eval": {
          if (!args.tabId || typeof args.tabId !== "string" || !args.tabId.trim()) {
            return { code: "TOOL_BAD_ARGS", message: `browser: '${operation}' requires 'tabId'` };
          }
          if (operation === "tabs.action" && (!args.kind || typeof args.kind !== "string" || !args.kind.trim())) {
            return { code: "TOOL_BAD_ARGS", message: "browser: 'tabs.action' requires 'kind'" };
          }
          if (operation === "tabs.eval" && (!args.expression || typeof args.expression !== "string" || !args.expression.trim())) {
            return { code: "TOOL_BAD_ARGS", message: "browser: 'tabs.eval' requires 'expression'" };
          }
          break;
        }
      }
      break;
    }
    case "feishu_send_file": {
      if (!args.filePath || typeof args.filePath !== "string" || !args.filePath.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "feishu_send_file: 'filePath' must be a non-empty string" };
      }
      break;
    }
    case "feishu_reply_message": {
      if (!args.text || typeof args.text !== "string" || !args.text.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "feishu_reply_message: 'text' must be a non-empty string" };
      }
      if (
        args.messageId !== undefined
        && (typeof args.messageId !== "string" || !args.messageId.trim())
      ) {
        return { code: "TOOL_BAD_ARGS", message: "feishu_reply_message: 'messageId' must be a non-empty string when provided" };
      }
      break;
    }
    case "feishu_react_message": {
      if (
        args.messageId !== undefined
        && (typeof args.messageId !== "string" || !args.messageId.trim())
      ) {
        return { code: "TOOL_BAD_ARGS", message: "feishu_react_message: 'messageId' must be a non-empty string when provided" };
      }
      if (args.emoji !== undefined && typeof args.emoji !== "string") {
        return { code: "TOOL_BAD_ARGS", message: "feishu_react_message: 'emoji' must be a string when provided" };
      }
      break;
    }
  }
  return null;
}

function isSoulAliasPath(inputPath: string): boolean {
  const normalized = inputPath.trim().replace(/\\/g, "/").toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "soul" ||
    normalized === "soul.md" ||
    normalized.endsWith("/soul") ||
    normalized.endsWith("/soul.md")
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const fsPromises = await import("node:fs/promises");
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function withTimeout<T>(p: Promise<T>, ms = 120000): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("TOOL_TIMEOUT")), ms)),
  ]);
}

function clipPreviewText(text: string, maxChars = TOOL_PREVIEW_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3)}...`;
}

function buildBashPreviewText(params: {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  fullOutputPath?: string;
}): string {
  const lines: string[] = [`[bash] exitCode=${params.exitCode}`];

  if (params.stdoutTail) {
    lines.push("[stdout]");
    lines.push(params.stdoutTail);
  }

  if (params.stderrTail) {
    lines.push("[stderr]");
    lines.push(params.stderrTail);
  }

  if (params.fullOutputPath) {
    lines.push(`[fullOutputPath] ${params.fullOutputPath}`);
  }

  return clipPreviewText(lines.join("\n"));
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
    "下一步建议：如果只是确认文件类型或抽样内容，改用 bash 执行 file、strings、head、xxd 这类命令；不要继续用 read_file 硬读二进制。",
  ].join("\n");
}

function buildReadFilePreviewText(params: {
  filePath: string;
  content: string;
  byteLength: number;
  truncated: boolean;
  guidance?: string;
}): string {
  const lines = [
    `[read_file] path=${params.filePath}`,
    `[bytes] ${params.byteLength}`,
    params.truncated ? "[status] truncated-preview" : "[status] inline-full",
    "[content]",
    params.content,
  ];
  if (params.guidance) {
    lines.push(`[guidance] ${params.guidance}`);
  }
  return clipPreviewText(lines.join("\n"));
}

function buildHelpDocsPreviewText(params: {
  version: string;
  query?: string;
  matchedCommands: number;
  totalCommands: number;
  commandNames: string[];
}): string {
  const lines = [
    `[help_docs] version=${params.version}`,
    params.query ? `[query] ${params.query}` : "[query] <all>",
    `[matched] ${params.matchedCommands}/${params.totalCommands}`,
  ];
  if (params.commandNames.length > 0) {
    lines.push("[commands]");
    lines.push(...params.commandNames.map((name) => `- ${name}`));
  }
  return clipPreviewText(lines.join("\n"));
}

export async function executeTool<TTool extends ToolName>(
  tool: TTool,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult<TTool>>;

export async function executeTool(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const started = Date.now();
  const requestId = ctx.requestId;

  // 策略检查
  const policy = await getToolPolicy(ctx.workspacePath);
  const gate = canExecuteTool(policy, tool, ctx.source);
  if (!gate.ok) {
    const result: ToolResult = {
      ok: false,
      tool,
      error: { code: gate.code!, message: gate.message! },
      durationMs: Date.now() - started,
    };

    // 记录策略拒绝事件
    recordToolEvent({
      requestId,
      workspacePath: ctx.workspacePath,
      chatId: ctx.chatId,
      tool,
      source: ctx.source,
      durationMs: result.durationMs,
      ok: false,
      errorCode: gate.code!,
      artifactPaths: [],
      timestamp: Date.now(),
    });

    return result;
  }

  // P5.6.13-R1A-EXEC R2: 参数校验（四核心工具）
  const validationError = validateToolArgs(tool, args);
  if (validationError) {
    const result: ToolResult = {
      ok: false,
      tool,
      error: { code: validationError.code, message: validationError.message },
      durationMs: Date.now() - started,
    };

    // 记录参数校验失败事件
    recordToolEvent({
      requestId,
      workspacePath: ctx.workspacePath,
      chatId: ctx.chatId,
      tool,
      source: ctx.source,
      durationMs: result.durationMs,
      ok: false,
      errorCode: validationError.code,
      artifactPaths: [],
      timestamp: Date.now(),
    });

    return result;
  }

  try {
    let result: ToolResult;

    switch (tool) {
      case "tts": {
        const text = String(args.text ?? "").trim();
        if (!text) throw new Error("empty text");
        const instruct = typeof args.instruct === "string" ? args.instruct.trim() : undefined;
        const speedNum = typeof args.speed === "number"
          ? args.speed
          : (typeof args.speed === "string" ? Number(args.speed) : Number.NaN);
        const temperatureNum = typeof args.temperature === "number"
          ? args.temperature
          : (typeof args.temperature === "string" ? Number(args.temperature) : Number.NaN);
        const out = await withTimeout(
          runTts({
            workspacePath: ctx.workspacePath,
            text,
            ...(instruct ? { instruct } : {}),
            ...(Number.isFinite(speedNum) && speedNum > 0 ? { speed: speedNum } : {}),
            ...(Number.isFinite(temperatureNum) && temperatureNum > 0 ? { temperature: temperatureNum } : {}),
          }),
          ctx.timeoutMs ?? 120000
        );
        if (!out.success || !out.audioPath) throw new Error(out.error || "tts failed");
        result = {
          ok: true,
          tool,
          data: { audioPath: out.audioPath },
          artifacts: [{ kind: "tts", path: out.audioPath }],
          durationMs: Date.now() - started,
        };
        break;
      }
      case "asr": {
        // 兼容旧入参 inputPath，并对齐当前 manifest 的 audioPath。
        const inputPath = String(args.audioPath ?? args.inputPath ?? "");
        const out = await withTimeout(
          runAsr({ workspacePath: ctx.workspacePath, inputPath }),
          ctx.timeoutMs ?? 300000
        );
        if (!out.success) throw new Error(out.error || "asr failed");
        result = {
          ok: true,
          tool,
          data: { txtPath: out.txtPath },
          artifacts: [{ kind: "asr", path: out.txtPath }],
          durationMs: Date.now() - started,
        };
        break;
      }
      case "vision": {
        const imagePath = String(args.imagePath ?? "");
        const userQuery = typeof args.userQuery === "string" ? args.userQuery : undefined;
        const out = await withTimeout(
          runVision({ workspacePath: ctx.workspacePath, imagePath, userQuery }),
          ctx.timeoutMs ?? 120000
        );
        if (!out.success || !out.textPath) throw new Error(out.error || "vision failed");
        result = {
          ok: true,
          tool,
          data: { textPath: out.textPath },
          artifacts: [{ kind: "vision", path: out.textPath }],
          durationMs: Date.now() - started,
        };
        break;
      }
      case "bash": {  // P5.6.8-R4g: 统一使用 bash 命名
        const command = String(args.command ?? "").trim();
        if (!command) throw new Error("empty command");

        // P5.7-R3f: 改接 bash-runner，支持 timeout/abort/输出截断
        const out = await withTimeout(
          runBashCommand({
            command,
            cwd: ctx.workspacePath,
            timeoutMs: ctx.timeoutMs ?? 120000,
          }),
          ctx.timeoutMs ?? 120000
        );

        // P5.7-R3f: 结构化日志（exitCode/stdoutTail/stderrTail/fullOutputPath）
        // P5.7-R3h: 诊断字段透传到 ToolResult 顶层
        result = {
          ok: out.ok,
          tool,
          data: {
            exitCode: out.exitCode,
            stdout: out.stdoutTail,
            stderr: out.stderrTail,
            fullOutputPath: out.fullOutputPath,
          },
          // P5.7-R3h: 诊断字段透传
          exitCode: out.exitCode,
          stdoutTail: out.stdoutTail,
          stderrTail: out.stderrTail,
          fullOutputPath: out.fullOutputPath,
          previewText: buildBashPreviewText({
            exitCode: out.exitCode,
            stdoutTail: out.stdoutTail,
            stderrTail: out.stderrTail,
            fullOutputPath: out.fullOutputPath,
          }),
          durationMs: Date.now() - started,
        };
        break;
      }
      case "browser": {
        try {
          const browser = await withTimeout(
            executeBrowserOperation({
              operation: String(args.operation) as BrowserOperation,
              mode: typeof args.mode === "string" ? args.mode as "headed" | "headless" : undefined,
              rootName: typeof args.rootName === "string" ? args.rootName : undefined,
              profileId: typeof args.profileId === "string" ? args.profileId : undefined,
              instanceId: typeof args.instanceId === "string" ? args.instanceId : undefined,
              tabId: typeof args.tabId === "string" ? args.tabId : undefined,
              url: typeof args.url === "string" ? args.url : undefined,
              kind: typeof args.kind === "string" ? args.kind : undefined,
              ref: typeof args.ref === "string" ? args.ref : undefined,
              text: typeof args.text === "string" ? args.text : undefined,
              key: typeof args.key === "string" ? args.key : undefined,
              expression: typeof args.expression === "string" ? args.expression : undefined,
              interactive: args.interactive === true,
              compact: args.compact === true,
              port: typeof args.port === "string" || typeof args.port === "number" ? args.port : undefined,
              timeoutMs: ctx.timeoutMs,
            }),
            ctx.timeoutMs ?? 120000
          );

          result = {
            ok: true,
            tool,
            data: {
              operation: browser.operation,
              result: browser.data,
            },
            durationMs: Date.now() - started,
          };
          break;
        } catch (error) {
          const message = error instanceof BrowserCommandError
            ? `${error.code}: ${error.message}`
            : (error instanceof Error ? error.message : String(error));
          const code = (
            (error instanceof BrowserCommandError && error.code === BROWSER_ERROR_CODES.TIMEOUT)
            || message === "TOOL_TIMEOUT"
          )
            ? "TOOL_TIMEOUT"
            : "TOOL_EXEC_FAILED";

          result = {
            ok: false,
            tool,
            error: {
              code,
              message,
            },
            durationMs: Date.now() - started,
          };
          break;
        }
      }
      case "desktop": {
        // T8.4: 优先使用 rpc 透传，兼容旧 subcommand
        const method = String(args.method ?? "").trim();

        if (method) {
          // T8.6.4.1: RPC 模式使用 session（稳定 peer）
          try {
            const { randomUUID } = await import("node:crypto");
            const requestId = randomUUID();

            // 注入 meta（如果不存在）
            const finalParams: Record<string, unknown> = { ...(args.params ?? {}) };
            if (!finalParams.meta) {
              finalParams.meta = {
                schemaVersion: 1,
                requestId,
                workspacePath: ctx.workspacePath,
                timeoutMs: ctx.timeoutMs ?? 120000,
              };
            }

            // 通过 session 发送请求
            const out = await withTimeout(
              sendDesktopViaSession(
                ctx.workspacePath,
                method,
                finalParams,
                ctx.timeoutMs ?? 120000
              ),
              ctx.timeoutMs ?? 120000
            );

            // 解析响应和 artifacts
            let artifacts: Array<{ kind: "desktop" | "log"; path: string }> = [];
            try {
              const jsonOut = JSON.parse(out.stdout);
              // 提取 evidence.dir
              if (jsonOut.result?.evidence?.dir) {
                artifacts.push({
                  kind: "desktop",
                  path: jsonOut.result.evidence.dir as string
                });
              }
            } catch {
              // stdout 不是 JSON：忽略解析
            }

            result = {
              ok: out.exitCode === 0,
              tool,
              data: { exitCode: out.exitCode, stdout: out.stdout, stderr: out.stderr },
              artifacts: artifacts.length > 0 ? artifacts : undefined,
              durationMs: Date.now() - started,
            };
            break;

          } catch (e) {
            // Session 失败，记录错误
            const msg = e instanceof Error ? e.message : String(e);
            logger.error(`[DesktopSession] 请求失败: ${msg}`);

            result = {
              ok: false,
              tool,
              error: {
                code: "TOOL_EXEC_FAILED",
                message: msg
              },
              durationMs: Date.now() - started,
            };
            break;
          }


        } else {
          // 兼容模式：旧 subcommand
          const subcommand = String(args.subcommand ?? "").trim();
          if (!subcommand || !["ping", "doctor", "observe", "find", "click", "type-text", "hotkey", "wait-until", "abort", "abort-demo"].includes(subcommand)) {
            throw new Error(`invalid subcommand: ${subcommand}. Use rpc mode with --method`);
          }

          // 查找 desktopctl 可执行文件
          const { resolve } = await import("node:path");
          const { existsSync } = await import("node:fs");

          let desktopctlPath = "";

          // 策略 0: 环境变量覆盖
          const envOverride = process.env.MSGCODE_DESKTOPCTL_PATH;
          if (envOverride && existsSync(envOverride)) {
            desktopctlPath = envOverride;
          }

          // 策略 1: 项目根 release 版本
          if (!desktopctlPath) {
            const releasePath = resolve(process.cwd(), "mac", "msgcode-desktopctl", ".build", "release", "msgcode-desktopctl");
            if (existsSync(releasePath)) {
              desktopctlPath = releasePath;
            }
          }

          // 策略 2: 项目根 debug 版本
          if (!desktopctlPath) {
            const debugPath = resolve(process.cwd(), "mac", "msgcode-desktopctl", ".build", "debug", "msgcode-desktopctl");
            if (existsSync(debugPath)) {
              desktopctlPath = debugPath;
            }
          }

          if (!desktopctlPath) {
            result = {
              ok: false,
              tool,
              error: {
                code: "TOOL_EXEC_FAILED",
                message: `msgcode-desktopctl not found. Build first: cd mac/msgcode-desktopctl && swift build`
              },
              durationMs: Date.now() - started,
            };
            break;
          }

          // 根据子命令构建参数
          const cmdArgs: string[] = [];
          if (subcommand === "ping" || subcommand === "doctor") {
            cmdArgs.push(subcommand, "--workspace", ctx.workspacePath);
          } else if (subcommand === "observe") {
            cmdArgs.push("observe", ctx.workspacePath, "--timeout-ms", String(ctx.timeoutMs ?? 60000));
          } else if (subcommand === "find") {
            cmdArgs.push("find", ctx.workspacePath);
            if (args.byRole) cmdArgs.push("--by-role", String(args.byRole));
            if (args.titleContains) cmdArgs.push("--title-contains", String(args.titleContains));
            if (args.valueContains) cmdArgs.push("--value-contains", String(args.valueContains));
            if (args.limit) cmdArgs.push("--limit", String(args.limit));
          } else if (subcommand === "click") {
            cmdArgs.push("click", ctx.workspacePath);
            if (args.byRole) cmdArgs.push("--by-role", String(args.byRole));
            if (args.titleContains) cmdArgs.push("--title-contains", String(args.titleContains));
            cmdArgs.push("--confirm", String(args.confirm ?? "CONFIRM"));
          } else if (subcommand === "type-text") {
            cmdArgs.push("type-text", ctx.workspacePath, String(args.text ?? ""));
            if (args.byRole) cmdArgs.push("--by-role", String(args.byRole));
            if (args.titleContains) cmdArgs.push("--title-contains", String(args.titleContains));
            cmdArgs.push("--confirm", String(args.confirm ?? "CONFIRM"));
          } else if (subcommand === "hotkey") {
            cmdArgs.push("hotkey", ctx.workspacePath, String(args.keys ?? "enter"));
            cmdArgs.push("--confirm", String(args.confirm ?? "CONFIRM"));
          } else if (subcommand === "wait-until") {
            cmdArgs.push("wait-until", ctx.workspacePath);
            if (args.byRole) cmdArgs.push("--by-role", String(args.byRole));
            if (args.titleContains) cmdArgs.push("--title-contains", String(args.titleContains));
            if (args.valueContains) cmdArgs.push("--value-contains", String(args.valueContains));
            if (args.timeoutMs) cmdArgs.push("--timeout-ms", String(args.timeoutMs ?? 15000));
            if (args.pollMs) cmdArgs.push("--poll-ms", String(args.pollMs ?? 500));
          } else if (subcommand === "abort") {
            cmdArgs.push("abort", ctx.workspacePath, String(args.targetRequestId ?? ""));
          } else if (subcommand === "abort-demo") {
            // abort-demo 是演示命令，不通过 tool bus 调用
            result = {
              ok: false,
              tool,
              error: { code: "TOOL_NOT_ALLOWED", message: "abort-demo is for CLI testing only" },
              durationMs: Date.now() - started,
            };
            break;
          } else {
            throw new Error(`unsupported subcommand: ${subcommand}`);
          }

          // spawn desktopctl
          const { spawn } = await import("node:child_process");
          const out = await withTimeout(
            new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
            const proc = spawn(desktopctlPath, cmdArgs, {
              cwd: ctx.workspacePath,
              env: { ...process.env, PWD: ctx.workspacePath },
            });
            let stdout = "";
            let stderr = "";

            proc.stdout?.on("data", (data) => { stdout += data; });
            proc.stderr?.on("data", (data) => { stderr += data; });

            proc.on("close", (code) => {
              resolve({ exitCode: code, stdout, stderr });
            });

            proc.on("error", (err) => {
              reject(err);
            });
          }),
          ctx.timeoutMs ?? 120000
          );

          // 解析 stdout 中的 executionId 和 evidence（若是 JSON）
          let artifacts: Array<{ kind: "desktop" | "log"; path: string }> = [];
          try {
            const jsonOut = JSON.parse(out.stdout);
            if (jsonOut.result?.executionId && jsonOut.result?.evidence?.dir) {
              artifacts.push({
                kind: "desktop",
                path: jsonOut.result.evidence.dir
              });
              // env.json 路径
              if (jsonOut.result.evidence.envPath) {
                artifacts.push({
                  kind: "log",
                  path: `${jsonOut.result.evidence.dir}/${jsonOut.result.evidence.envPath}`
                });
              }
            }
          } catch {
            // stdout 不是 JSON，忽略
          }

          result = {
            ok: out.exitCode === 0,
            tool,
            data: { exitCode: out.exitCode ?? -1, stdout: out.stdout, stderr: out.stderr },
            artifacts: artifacts.length > 0 ? artifacts : undefined,
            durationMs: Date.now() - started,
          };
          break;
        }
      }
      // P5.6.13-R1A-EXEC: run_skill 已退役
      case "read_file": {
        // P5.6.8-R3: 读取文件内容
        // P5.7-R3i: 应用 fs_scope 策略
        const { resolve, isAbsolute } = await import("node:path");
        const inputPath = String(args.path || "");

        // 获取 fs_scope 策略
        const fsScope = await getFsScope(ctx.workspacePath);

        let filePath: string;
        if (fsScope === "unrestricted" && isAbsolute(inputPath)) {
          // unrestricted 模式：允许绝对路径
          filePath = inputPath;
        } else {
          // workspace 模式（默认）：解析为 workspace 内路径
          filePath = resolve(ctx.workspacePath, inputPath);
        }

        // P5.7-R3i: workspace 模式下的边界校验
        if (fsScope === "workspace" && !isPathWithinWorkspace(filePath, ctx.workspacePath)) {
          // P5.7-R3i: 日志包含 fsScope/path
          logger.warn("File tool path denied by fs_scope policy", {
            module: "tools-bus",
            tool,
            fsScope,
            inputPath,
            resolvedPath: filePath,
            workspacePath: ctx.workspacePath,
          });
          result = {
            ok: false,
            tool,
            error: {
              code: "TOOL_NOT_ALLOWED",
              message: `path must be under workspace (fsScope: ${fsScope}, path: ${inputPath})`,
            },
            durationMs: Date.now() - started,
          };
          break;
        }

        // P5.7-R6e: soul 路径别名兜底
        // 仅在模型传入相对别名且主路径不存在时回退到工作区 SOUL 文件，避免误参导致 ENOENT
        if (!isAbsolute(inputPath) && isSoulAliasPath(inputPath)) {
          const canonicalSoulPath = resolve(ctx.workspacePath, ".msgcode", "SOUL.md");
          const [primaryExists, canonicalExists] = await Promise.all([
            pathExists(filePath),
            pathExists(canonicalSoulPath),
          ]);

          if (!primaryExists && canonicalExists) {
            logger.info("read_file remapped soul alias to workspace SOUL", {
              module: "tools-bus",
              tool,
              inputPath,
              resolvedPath: filePath,
              remappedPath: canonicalSoulPath,
            });
            filePath = canonicalSoulPath;
          }
        }

        try {
          const fsPromises = await import("node:fs/promises");
          const stat = await withTimeout(fsPromises.stat(filePath), ctx.timeoutMs ?? 30000);
          if (!stat.isFile()) {
            result = {
              ok: false,
              tool,
              error: {
                code: "TOOL_EXEC_FAILED",
                message: `read_file 只能读取普通文件，当前路径不是文件：${filePath}\n下一步建议：先用 bash 执行 ls、find 或 file 确认路径类型。`,
              },
              previewText: `read_file 无法读取：${filePath}\n原因：目标不是普通文件。`,
              durationMs: Date.now() - started,
            };
            break;
          }

          let largeFilePreview: string | undefined;
          const handle = await withTimeout(fsPromises.open(filePath, "r"), ctx.timeoutMs ?? 30000);
          try {
            const sampleBuffer = Buffer.alloc(Math.min(READ_FILE_BINARY_SNIFF_BYTES, Math.max(stat.size, 1)));
            const { bytesRead } = await withTimeout(
              handle.read(sampleBuffer, 0, sampleBuffer.length, 0),
              ctx.timeoutMs ?? 30000
            );
            const sample = sampleBuffer.subarray(0, bytesRead);
            const binaryKind = detectBinaryKind(sample);
            if (binaryKind) {
              const message = buildReadFileBinaryMessage(filePath, binaryKind);
              result = {
                ok: false,
                tool,
                error: {
                  code: "TOOL_EXEC_FAILED",
                  message,
                },
                previewText: message,
                durationMs: Date.now() - started,
              };
              break;
            }

            if (stat.size > READ_FILE_INLINE_BYTE_LIMIT) {
              const previewBuffer = Buffer.alloc(Math.min(READ_FILE_PREVIEW_BYTES, stat.size));
              const previewRead = await withTimeout(
                handle.read(previewBuffer, 0, previewBuffer.length, 0),
                ctx.timeoutMs ?? 30000
              );
              largeFilePreview = previewBuffer.subarray(0, previewRead.bytesRead).toString("utf-8");
            }
          } finally {
            await handle.close();
          }

          const isLargeFile = stat.size > READ_FILE_INLINE_BYTE_LIMIT;
          if (isLargeFile) {
            const content = largeFilePreview ?? "";
            const guidance = "文件较大，只返回预览。若需继续，请改用 bash 配合 rg、head、tail、sed 分段读取。";
            result = {
              ok: true,
              tool,
              data: {
                content,
                path: filePath,
                truncated: true,
                byteLength: stat.size,
                guidance,
              },
              previewText: buildReadFilePreviewText({
                filePath,
                content,
                byteLength: stat.size,
                truncated: true,
                guidance,
              }),
              durationMs: Date.now() - started,
            };
            break;
          }

          const content = await withTimeout(
            fsPromises.readFile(filePath, "utf-8"),
            ctx.timeoutMs ?? 30000
          );

          result = {
            ok: true,
            tool,
            data: {
              content,
              path: filePath,
              byteLength: stat.size,
            },
            previewText: buildReadFilePreviewText({
              filePath,
              content,
              byteLength: stat.size,
              truncated: false,
            }),
            durationMs: Date.now() - started,
          };
          break;
        } catch (error) {
          if (error instanceof Error && error.message === "TOOL_TIMEOUT") {
            throw error;
          }

          const nodeError = error as NodeJS.ErrnoException;
          let message = nodeError?.message || String(error);
          if (nodeError?.code === "ENOENT") {
            message = `文件不存在：${filePath}\n下一步建议：先用 bash 执行 ls、find 或 rg 确认路径，再继续读取。`;
          } else if (nodeError?.code === "EISDIR") {
            message = `目标是目录不是文件：${filePath}\n下一步建议：先用 bash 执行 ls 查看目录内容，再决定读取哪个文件。`;
          }

          result = {
            ok: false,
            tool,
            error: {
              code: "TOOL_EXEC_FAILED",
              message,
            },
            previewText: message,
            durationMs: Date.now() - started,
          };
          break;
        }
      }
      case "help_docs": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const rawLimit = args.limit;
        const numericLimit = rawLimit === undefined ? undefined : Number(rawLimit);
        const data = await getHelpDocsData({
          query: query || undefined,
          limit: Number.isFinite(numericLimit) && numericLimit && numericLimit > 0 ? numericLimit : undefined,
        });
        const commands = Array.isArray(data.commands) ? data.commands : [];
        result = {
          ok: true,
          tool,
          data: {
            version: data.version,
            totalCommands: data.totalCommands,
            matchedCommands: commands.length,
            query: query || undefined,
            commands,
          },
          previewText: buildHelpDocsPreviewText({
            version: data.version,
            query: query || undefined,
            matchedCommands: commands.length,
            totalCommands: data.totalCommands,
            commandNames: commands
              .map((item) => (typeof item?.name === "string" ? item.name : ""))
              .filter(Boolean)
              .slice(0, 12),
          }),
          durationMs: Date.now() - started,
        };
        break;
      }
      case "write_file": {
        // P5.6.8-R3: 整文件写入
        // P5.7-R3i: 应用 fs_scope 策略
        const { resolve, dirname, isAbsolute } = await import("node:path");
        const inputPath = String(args.path || "");
        const content = String(args.content ?? "");

        // 获取 fs_scope 策略
        const fsScope = await getFsScope(ctx.workspacePath);

        let filePath: string;
        if (fsScope === "unrestricted" && isAbsolute(inputPath)) {
          // unrestricted 模式：允许绝对路径
          filePath = inputPath;
        } else {
          // workspace 模式（默认）：解析为 workspace 内路径
          filePath = resolve(ctx.workspacePath, inputPath);
        }

        // P5.7-R3i: workspace 模式下的边界校验
        if (fsScope === "workspace" && !isPathWithinWorkspace(filePath, ctx.workspacePath)) {
          // P5.7-R3i: 日志包含 fsScope/path
          logger.warn("File tool path denied by fs_scope policy", {
            module: "tools-bus",
            tool,
            fsScope,
            inputPath,
            resolvedPath: filePath,
            workspacePath: ctx.workspacePath,
          });
          result = {
            ok: false,
            tool,
            error: {
              code: "TOOL_NOT_ALLOWED",
              message: `path must be under workspace (fsScope: ${fsScope}, path: ${inputPath})`,
            },
            durationMs: Date.now() - started,
          };
          break;
        }

        // 确保目录存在
        const { mkdir } = await import("node:fs/promises");
        await mkdir(dirname(filePath), { recursive: true });

        await withTimeout(
          (await import("node:fs/promises")).writeFile(filePath, content, "utf-8"),
          ctx.timeoutMs ?? 30000
        );

        result = {
          ok: true,
          tool,
          data: { path: args.path as string },
          durationMs: Date.now() - started,
        };
        break;
      }
      case "edit_file": {
        // P5.6.8-R3: 补丁式编辑（禁止整文件覆盖）
        // P5.7-R3i: 应用 fs_scope 策略
        const { resolve, isAbsolute } = await import("node:path");
        const inputPath = String(args.path || "");
        const edits = normalizeEditFileEdits(args) ?? undefined;

        // 获取 fs_scope 策略
        const fsScope = await getFsScope(ctx.workspacePath);

        let filePath: string;
        if (fsScope === "unrestricted" && isAbsolute(inputPath)) {
          // unrestricted 模式：允许绝对路径
          filePath = inputPath;
        } else {
          // workspace 模式（默认）：解析为 workspace 内路径
          filePath = resolve(ctx.workspacePath, inputPath);
        }

        // P5.7-R3i: workspace 模式下的边界校验
        if (fsScope === "workspace" && !isPathWithinWorkspace(filePath, ctx.workspacePath)) {
          // P5.7-R3i: 日志包含 fsScope/path
          logger.warn("File tool path denied by fs_scope policy", {
            module: "tools-bus",
            tool,
            fsScope,
            inputPath,
            resolvedPath: filePath,
            workspacePath: ctx.workspacePath,
          });
          result = {
            ok: false,
            tool,
            error: {
              code: "TOOL_NOT_ALLOWED",
              message: `path must be under workspace (fsScope: ${fsScope}, path: ${inputPath})`,
            },
            durationMs: Date.now() - started,
          };
          break;
        }

        if (!edits || !Array.isArray(edits) || edits.length === 0) {
          throw new Error("edits must be a non-empty array of { oldText, newText }");
        }

        // 读取原文件
        const fsPromises = await import("node:fs/promises");
        let content = await withTimeout(
          fsPromises.readFile(filePath, "utf-8"),
          ctx.timeoutMs ?? 30000
        );

        // 逐个应用补丁
        let editsApplied = 0;
        for (const edit of edits) {
          if (typeof edit.oldText !== "string" || typeof edit.newText !== "string") {
            throw new Error("each edit must have oldText and newText as strings");
          }

          if (!content.includes(edit.oldText)) {
            throw new Error(
              `oldText not found in file: ${edit.oldText.substring(0, 100)}...`
            );
          }

          content = content.replace(edit.oldText, edit.newText);
          editsApplied++;
        }

        // 写回
        await withTimeout(
          fsPromises.writeFile(filePath, content, "utf-8"),
          ctx.timeoutMs ?? 30000
        );

        result = {
          ok: true,
          tool,
          data: { path: args.path as string, editsApplied },
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_send_file": {
        // 飞书文件发送工具
        const filePath = String(args.filePath ?? "").trim();
        let chatId = args.chatId ? String(args.chatId).trim() : undefined;
        const { loadWorkspaceConfig } = await import("../config/workspace.js");
        const workspaceConfig = await loadWorkspaceConfig(ctx.workspacePath);

        // 如果没提供 chatId，优先使用当前对话的群 ID
        // ctx.chatId 格式是 feishu:oc_xxx，需要转换成 oc_xxx
        if (!chatId && ctx.chatId) {
          chatId = ctx.chatId.replace(/^feishu:/, "");
        }

        // 再 fallback 到 workspace 当前会话上下文（单一真相源）
        if (!chatId) {
          chatId = (workspaceConfig["runtime.current_chat_id"] as string | undefined)?.trim();
        }
        chatId = chatId || "";
        const message = args.message ? String(args.message).trim() : undefined;

        // 读取飞书配置（优先环境变量，然后 workspace config）
        let appId = process.env.FEISHU_APP_ID?.trim();
        let appSecret = process.env.FEISHU_APP_SECRET?.trim();

        if (!appId || !appSecret) {
          appId = (workspaceConfig["feishu.appId"] as string | undefined)?.trim();
          appSecret = (workspaceConfig["feishu.appSecret"] as string | undefined)?.trim();
        }

        if (!appId || !appSecret) {
          throw new Error("飞书配置未找到：请设置环境变量 FEISHU_APP_ID/FEISHU_APP_SECRET 或 workspace config 中的 feishu.appId/feishu.appSecret");
        }
        if (!chatId) {
          throw new Error("飞书 chatId 未找到：请传入 chatId，或先让当前请求把 runtime.current_chat_id 写入 .msgcode/config.json");
        }

        // 调用飞书发送文件函数
        const { feishuSendFile } = await import("../tools/feishu-send.js");
        const out = await withTimeout(
          feishuSendFile(
            { filePath, chatId, message },
            { appId, appSecret }
          ),
          ctx.timeoutMs ?? 60000
        );

        result = {
          ok: out.ok,
          tool,
          data: out.ok ? {
            chatId: out.chatId,
            ...(out.attachmentType ? { attachmentType: out.attachmentType } : {}),
            ...(out.attachmentKey ? { attachmentKey: out.attachmentKey } : {}),
          } : undefined,
          error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "发送失败" },
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_list_members": {
        let chatId = args.chatId ? String(args.chatId).trim() : undefined;
        const memberIdTypeRaw = String(args.memberIdType ?? "open_id").trim();
        const memberIdType = memberIdTypeRaw === "user_id" || memberIdTypeRaw === "union_id"
          ? memberIdTypeRaw
          : "open_id";
        const { loadWorkspaceConfig } = await import("../config/workspace.js");
        const workspaceConfig = await loadWorkspaceConfig(ctx.workspacePath);

        if (!chatId && ctx.chatId) {
          chatId = ctx.chatId.replace(/^feishu:/, "");
        }
        if (!chatId) {
          chatId = (workspaceConfig["runtime.current_chat_id"] as string | undefined)?.trim();
        }
        chatId = chatId || "";

        let appId = process.env.FEISHU_APP_ID?.trim();
        let appSecret = process.env.FEISHU_APP_SECRET?.trim();

        if (!appId || !appSecret) {
          appId = (workspaceConfig["feishu.appId"] as string | undefined)?.trim();
          appSecret = (workspaceConfig["feishu.appSecret"] as string | undefined)?.trim();
        }

        if (!appId || !appSecret) {
          throw new Error("飞书配置未找到：请设置环境变量 FEISHU_APP_ID/FEISHU_APP_SECRET 或 workspace config 中的 feishu.appId/feishu.appSecret");
        }
        if (!chatId) {
          throw new Error("飞书 chatId 未找到：请传入 chatId，或先让当前请求把 runtime.current_chat_id 写入 .msgcode/config.json");
        }

        const { feishuListMembers } = await import("../tools/feishu-list-members.js");
        const out = await withTimeout(
          feishuListMembers(
            { chatId, memberIdType },
            { appId, appSecret }
          ),
          ctx.timeoutMs ?? 30000
        );

        result = {
          ok: out.ok,
          tool,
          data: out.ok
            ? {
                chatId: out.chatId,
                memberIdType: out.memberIdType,
                memberTotal: out.memberTotal ?? out.members?.length ?? 0,
                members: out.members ?? [],
              }
            : undefined,
          error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "获取群成员失败" },
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_list_recent_messages": {
        let chatId = args.chatId ? String(args.chatId).trim() : undefined;
        const limitRaw = Number(args.limit ?? 40);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.trunc(limitRaw), 40)) : 40;
        const { loadWorkspaceConfig } = await import("../config/workspace.js");
        const workspaceConfig = await loadWorkspaceConfig(ctx.workspacePath);

        if (!chatId && ctx.chatId) {
          chatId = ctx.chatId.replace(/^feishu:/, "");
        }
        if (!chatId) {
          chatId = (workspaceConfig["runtime.current_chat_id"] as string | undefined)?.trim();
        }
        chatId = chatId || "";

        let appId = process.env.FEISHU_APP_ID?.trim();
        let appSecret = process.env.FEISHU_APP_SECRET?.trim();

        if (!appId || !appSecret) {
          appId = (workspaceConfig["feishu.appId"] as string | undefined)?.trim();
          appSecret = (workspaceConfig["feishu.appSecret"] as string | undefined)?.trim();
        }

        if (!appId || !appSecret) {
          throw new Error("飞书配置未找到：请设置环境变量 FEISHU_APP_ID/FEISHU_APP_SECRET 或 workspace config 中的 feishu.appId/feishu.appSecret");
        }
        if (!chatId) {
          throw new Error("飞书 chatId 未找到：请传入 chatId，或先让当前请求把 runtime.current_chat_id 写入 .msgcode/config.json");
        }

        const { feishuListRecentMessages } = await import("../tools/feishu-list-recent-messages.js");
        const out = await withTimeout(
          feishuListRecentMessages(
            { chatId, limit },
            { appId, appSecret }
          ),
          ctx.timeoutMs ?? 30000
        );

        result = {
          ok: out.ok,
          tool,
          data: out.ok
            ? {
                chatId: out.chatId,
                count: out.count ?? out.messages?.length ?? 0,
                messages: out.messages ?? [],
              }
            : undefined,
          error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "获取最近消息失败" },
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_reply_message": {
        let messageId = args.messageId ? String(args.messageId).trim() : undefined;
        const text = String(args.text ?? "").trim();
        const replyInThread = Boolean(args.replyInThread);
        const { loadWorkspaceConfig } = await import("../config/workspace.js");
        const workspaceConfig = await loadWorkspaceConfig(ctx.workspacePath);

        if (!messageId) {
          messageId = ctx.defaultActionTargetMessageId?.trim() || ctx.currentMessageId?.trim();
        }

        let appId = process.env.FEISHU_APP_ID?.trim();
        let appSecret = process.env.FEISHU_APP_SECRET?.trim();

        if (!appId || !appSecret) {
          appId = (workspaceConfig["feishu.appId"] as string | undefined)?.trim();
          appSecret = (workspaceConfig["feishu.appSecret"] as string | undefined)?.trim();
        }

        if (!appId || !appSecret) {
          throw new Error("飞书配置未找到：请设置环境变量 FEISHU_APP_ID/FEISHU_APP_SECRET 或 workspace config 中的 feishu.appId/feishu.appSecret");
        }
        if (!messageId) {
          throw new Error("飞书目标消息 ID 未找到：请显式传入 messageId，或仅对当前消息执行回复动作");
        }

        const { feishuReplyMessage } = await import("../tools/feishu-reply-message.js");
        const out = await withTimeout(
          feishuReplyMessage(
            { messageId, text, replyInThread },
            { appId, appSecret }
          ),
          ctx.timeoutMs ?? 30000
        );

        result = {
          ok: out.ok,
          tool,
          data: out.ok
            ? {
                chatId: out.chatId,
                repliedToMessageId: out.repliedToMessageId,
                messageId: out.messageId ?? "",
                replyInThread: out.replyInThread ?? replyInThread,
              }
            : undefined,
          error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "回复消息失败" },
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_react_message": {
        let messageId = args.messageId ? String(args.messageId).trim() : undefined;
        const emoji = args.emoji ? String(args.emoji).trim() : undefined;
        const { loadWorkspaceConfig } = await import("../config/workspace.js");
        const workspaceConfig = await loadWorkspaceConfig(ctx.workspacePath);

        if (!messageId) {
          messageId = ctx.defaultActionTargetMessageId?.trim() || ctx.currentMessageId?.trim();
        }

        let appId = process.env.FEISHU_APP_ID?.trim();
        let appSecret = process.env.FEISHU_APP_SECRET?.trim();

        if (!appId || !appSecret) {
          appId = (workspaceConfig["feishu.appId"] as string | undefined)?.trim();
          appSecret = (workspaceConfig["feishu.appSecret"] as string | undefined)?.trim();
        }

        if (!appId || !appSecret) {
          throw new Error("飞书配置未找到：请设置环境变量 FEISHU_APP_ID/FEISHU_APP_SECRET 或 workspace config 中的 feishu.appId/feishu.appSecret");
        }
        if (!messageId) {
          throw new Error("飞书目标消息 ID 未找到：请显式传入 messageId，或仅对当前消息执行表情回复动作");
        }

        const { feishuReactMessage } = await import("../tools/feishu-react-message.js");
        const out = await withTimeout(
          feishuReactMessage(
            { messageId, emoji },
            { appId, appSecret }
          ),
          ctx.timeoutMs ?? 30000
        );

        result = {
          ok: out.ok,
          tool,
          data: out.ok
            ? {
                messageId: out.messageId,
                reactionId: out.reactionId,
                emojiType: out.emojiType ?? "THUMBSUP",
              }
            : undefined,
          error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "消息表情回复失败" },
          durationMs: Date.now() - started,
        };
        break;
      }
      default:
        result = {
          ok: false,
          tool,
          error: { code: "TOOL_NOT_ALLOWED", message: `unsupported tool in P0: ${tool}` },
          durationMs: Date.now() - started,
        };
        break;
    }

    // 记录成功事件
    const artifactPaths = result.artifacts?.map(a => a.path) ?? [];
    recordToolEvent({
      requestId,
      workspacePath: ctx.workspacePath,
      chatId: ctx.chatId,
      tool,
      source: ctx.source,
      durationMs: result.durationMs,
      ok: result.ok,
      errorCode: result.error?.code,
      artifactPaths,
      timestamp: Date.now(),
    });

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg === "TOOL_TIMEOUT" ? "TOOL_TIMEOUT" : "TOOL_EXEC_FAILED";

    const result: ToolResult = {
      ok: false,
      tool,
      error: { code, message: msg },
      durationMs: Date.now() - started,
    };

    // 记录失败事件
    recordToolEvent({
      requestId,
      workspacePath: ctx.workspacePath,
      chatId: ctx.chatId,
      tool,
      source: ctx.source,
      durationMs: result.durationMs,
      ok: false,
      errorCode: code,
      artifactPaths: [],
      timestamp: Date.now(),
    });

    return result;
  }
}

// ============================================
// T8.6.4.1: Desktop Session Pool（稳定 peer）
// ============================================

/**
 * Session 请求类型（NDJSON stdin）
 */
interface SessionRequest {
  id: string;  // Tool Bus 生成的请求 ID
  workspacePath: string;
  method: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Session 响应类型（NDJSON stdout）
 */
interface SessionResponse {
  id: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Session 状态
 */
interface SessionState {
  proc: import("child_process").ChildProcess;
  lastUsedAt: number;
  isProcessing: boolean;  // 单飞队列标志
  pendingRequests: Array<{
    request: SessionRequest;
    resolve: (response: SessionResponse) => void;
    reject: (error: Error) => void;
    timeoutMs: number;
  }>;
  stdoutBuffer: string;
  responseResolvers: Map<string, (response: SessionResponse) => void>;
  idleTimer?: NodeJS.Timeout;
}

/**
 * Desktop Session Pool（T8.6.4.1）
 *
 * 功能：
 * - 以 workspacePath 为 key 维护常驻 session 子进程
 * - idle 60s 自动回收
 * - 单飞队列（串行处理，避免响应乱序）
 * - 崩溃自愈（检测 close 后自动重启）
 */
class DesktopSessionPool {
  private readonly desktopctlPath: string;
  private readonly sessions: Map<string, SessionState> = new Map();
  private readonly idleTimeoutMs = 60000;  // 60s idle 超时
  private readonly logger = logger;

  constructor(desktopctlPath: string) {
    this.desktopctlPath = desktopctlPath;
    // 启动定期清理 idle session 的定时器
    this.startIdleCleanup();
  }

  /**
   * 发送请求到 session（或 fallback 到一次性调用）
   */
  async send(request: SessionRequest): Promise<SessionResponse> {
    const workspacePath = request.workspacePath;

    // 尝试复用现有 session
    let session = this.sessions.get(workspacePath);

    // 如果 session 不存在或已退出，创建新的
    if (!session || !this.isSessionAlive(session)) {
      this.logger.debug(`[DesktopSessionPool] 创建新 session: ${workspacePath}`);
      session = await this.createSession(workspacePath);
      this.sessions.set(workspacePath, session);
    }

    // 重置 idle 计时器
    this.resetIdleTimer(session);

    // 单飞队列：等待上一个请求完成（最多等待 5 秒）
    let waited = 0;
    const maxWait = 5000;
    while (session.isProcessing && waited < maxWait) {
      await this.sleep(50);
      waited += 50;
    }

    if (session.isProcessing) {
      throw new Error("Session busy: previous request still processing");
    }

    // 发送请求
    return this.sendRequest(session, request);
  }

  /**
   * 创建新的 session 子进程
   */
  private async createSession(workspacePath: string): Promise<SessionState> {
    const { spawn } = await import("node:child_process");

    // 启动 session 子进程
    const proc = spawn(this.desktopctlPath, ["session", workspacePath, "--idle-ms", String(this.idleTimeoutMs)], {
      cwd: workspacePath,
      env: { ...process.env, PWD: workspacePath },
    });

    const session: SessionState = {
      proc,
      lastUsedAt: Date.now(),
      isProcessing: false,
      pendingRequests: [],
      stdoutBuffer: "",
      responseResolvers: new Map(),
    };

    // 处理 stdout（NDJSON 逐行解析）
    proc.stdout?.on("data", (data: Buffer) => {
      const dataStr = data.toString();
      this.logger.debug(`[DesktopSession stdout] 收到数据: ${dataStr.substring(0, 200)}...`);
      session.stdoutBuffer += dataStr;
      this.processStdoutLines(session);
    });

    // 处理 stderr（日志）
    proc.stderr?.on("data", (data: Buffer) => {
      this.logger.debug(`[DesktopSession stderr] ${data.toString().trim()}`);
    });

    // 处理进程退出（崩溃自愈）
    proc.on("close", (code, signal) => {
      this.logger.debug(`[DesktopSession] 进程退出: code=${code}, signal=${signal}`);
      this.sessions.delete(workspacePath);

      // 拒绝所有待处理的请求
      for (const { reject } of session.pendingRequests) {
        reject(new Error(`Session closed: code=${code}, signal=${signal}`));
      }
      session.pendingRequests = [];
    });

    // 处理进程错误
    proc.on("error", (err) => {
      this.logger.error(`[DesktopSession] 进程错误: ${err.message}`);
      this.sessions.delete(workspacePath);

      // 拒绝所有待处理的请求
      for (const { reject } of session.pendingRequests) {
        reject(err);
      }
      session.pendingRequests = [];
    });

    // 等待进程启动并准备好
    await this.sleep(500);

    this.logger.debug(`[DesktopSession] Session 进程已启动: pid=${proc.pid}`);

    return session;
  }

  /**
   * 发送请求到 session（单飞队列）
   */
  private async sendRequest(session: SessionState, request: SessionRequest): Promise<SessionResponse> {
    if (session.isProcessing) {
      throw new Error(`Session busy: ${session.proc.pid} is processing`);
    }

    session.isProcessing = true;
    const timeoutMs = request.timeoutMs ?? 30000;

    this.logger.debug(`[DesktopSession] 发送请求: ${request.id}, method: ${request.method}`);

    // 创建 Promise
    const promise = new Promise<SessionResponse>((resolve, reject) => {
      // 设置超时
      const timer = setTimeout(() => {
        this.logger.warn(`[DesktopSession] 请求超时: ${request.id}`);
        session.responseResolvers.delete(request.id);
        reject(new Error(`Request timeout: ${request.id}`));
      }, timeoutMs);

      // 注册 resolver
      session.responseResolvers.set(request.id, (response) => {
        this.logger.debug(`[DesktopSession] 收到响应: ${response.id}, exitCode=${response.exitCode}`);
        clearTimeout(timer);
        if (response.exitCode === 0) {
          resolve(response);
        } else {
          reject(new Error(`Request failed: ${response.stderr || response.stdout}`));
        }
      });

      // 发送 NDJSON 请求到 stdin
      const requestJson = JSON.stringify(request) + "\n";
      this.logger.debug(`[DesktopSession stdin] 写入: ${requestJson.substring(0, 200)}...`);
      const written = session.proc.stdin?.write(requestJson);
      this.logger.debug(`[DesktopSession stdin] write 结果: ${written}`);

      if (!written) {
        this.logger.error(`[DesktopSession] stdin 写入失败`);
        clearTimeout(timer);
        session.responseResolvers.delete(request.id);
        reject(new Error("Failed to write to session stdin"));
      }
    });

    // 等待响应（错误处理）
    promise.catch((err) => {
      this.logger.error(`[DesktopSession] 请求失败: ${err}`);
    });

    try {
      const response = await promise;
      return response;
    } finally {
      session.isProcessing = false;
    }
  }

  /**
   * 处理 stdout 行（NDJSON 解析）
   */
  private processStdoutLines(session: SessionState): void {
    const lines = session.stdoutBuffer.split("\n");
    session.stdoutBuffer = lines.pop() || "";  // 保留未完成的行

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: SessionResponse = JSON.parse(line);
        const resolver = session.responseResolvers.get(response.id);
        if (resolver) {
          resolver(response);
          session.responseResolvers.delete(response.id);
        } else {
          this.logger.warn(`[DesktopSession] 未找到响应 resolver: ${response.id}`);
        }
      } catch (e) {
        this.logger.error(`[DesktopSession] 解析响应失败: ${line}`);
      }
    }
  }

  /**
   * 检查 session 是否存活
   */
  private isSessionAlive(session: SessionState): boolean {
    return session.proc.exitCode === null && !session.proc.killed;
  }

  /**
   * 重置 idle 计时器
   */
  private resetIdleTimer(session: SessionState): void {
    session.lastUsedAt = Date.now();

    // 清除旧的计时器
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }

    // 设置新的计时器
    session.idleTimer = setTimeout(() => {
      this.logger.debug(`[DesktopSession] Idle 超时，清理 session`);
      this.killSession(session);
    }, this.idleTimeoutMs);
  }

  /**
   * 杀死 session
   */
  private killSession(session: SessionState): void {
    try {
      session.proc.kill("SIGTERM");
    } catch {
      // 忽略错误
    }
  }

  /**
   * 定期清理 idle session
   */
  private startIdleCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [workspacePath, session] of this.sessions.entries()) {
        if (now - session.lastUsedAt > this.idleTimeoutMs) {
          this.logger.debug(`[DesktopSessionPool] 清理 idle session: ${workspacePath}`);
          this.killSession(session);
          this.sessions.delete(workspacePath);
        }
      }
    }, 30000);  // 每 30 秒检查一次
  }

  /**
   * 辅助：sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 全局 Session Pool 实例（懒加载）
 */
let globalDesktopSessionPool: DesktopSessionPool | null = null;

/**
 * 获取或创建 Desktop Session Pool
 */
async function getDesktopSessionPool(): Promise<DesktopSessionPool> {
  if (globalDesktopSessionPool) {
    return globalDesktopSessionPool;
  }

  // 查找 desktopctl 可执行文件
  const { resolve } = await import("node:path");
  const { existsSync } = await import("node:fs");

  let desktopctlPath = "";

  // 策略 0: 环境变量覆盖
  const envOverride = process.env.MSGCODE_DESKTOPCTL_PATH;
  if (envOverride && existsSync(envOverride)) {
    desktopctlPath = envOverride;
  }

  // 策略 1&2: 查找项目根目录（向上查找）
  if (!desktopctlPath) {
    // 从当前目录向上查找，直到找到包含 mac/msgcode-desktopctl 的目录
    let currentDir = process.cwd();
    while (currentDir !== "/" && !desktopctlPath) {
      // 检查 release 版本
      const releasePath = resolve(currentDir, "mac", "msgcode-desktopctl", ".build", "release", "msgcode-desktopctl");
      if (existsSync(releasePath)) {
        desktopctlPath = releasePath;
        break;
      }

      // 检查 debug 版本
      const debugPath = resolve(currentDir, "mac", "msgcode-desktopctl", ".build", "debug", "msgcode-desktopctl");
      if (existsSync(debugPath)) {
        desktopctlPath = debugPath;
        break;
      }

      // 向上移动一级目录
      currentDir = resolve(currentDir, "..");
    }
  }

  if (!desktopctlPath) {
    logger.error(`[DesktopSessionPool] 当前工作目录: ${process.cwd()}`);
    throw new Error(`msgcode-desktopctl not found. Build first: cd mac/msgcode-desktopctl && swift build`);
  }

  logger.debug(`[DesktopSessionPool] desktopctl 路径: ${desktopctlPath}`);

  globalDesktopSessionPool = new DesktopSessionPool(desktopctlPath);
  return globalDesktopSessionPool;
}

/**
 * 通过 session 发送 desktop 请求（T8.6.4.1）
 */
async function sendDesktopViaSession(
  workspacePath: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const pool = await getDesktopSessionPool();

  // 生成请求 ID
  const { randomUUID } = await import("node:crypto");
  const requestId = randomUUID();

  const request: SessionRequest = {
    id: requestId,
    workspacePath,
    method,
    params,
    timeoutMs,
  };

  const response = await pool.send(request);
  return {
    exitCode: response.exitCode,
    stdout: response.stdout,
    stderr: response.stderr,
  };
}

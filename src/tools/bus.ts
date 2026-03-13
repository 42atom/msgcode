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
import { randomUUID } from "node:crypto";
import { mkdir as mkdirFs, writeFile as writeFileFs } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { getToolPolicy } from "../config/workspace.js";
import { getHelpDocsData } from "../cli/help.js";
import { runTts } from "../runners/tts.js";
import { runAsr } from "../runners/asr.js";
import { runVision } from "../runners/vision.js";
import { runBashCommand } from "../runners/bash-runner.js";
import { runDesktopTool } from "../runners/desktop.js";
import {
  normalizeEditFileEditsInput,
  runReadFileTool,
  runWriteFileTool,
  runEditFileTool,
} from "../runners/file-tools.js";
import {
  runFeishuSendFileTool,
  runFeishuListMembersTool,
  runFeishuListRecentMessagesTool,
  runFeishuReplyMessageTool,
  runFeishuReactMessageTool,
} from "../runners/feishu.js";
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
const BROWSER_TEXT_PREVIEW_CHARS = 1200;

export { getToolPolicy } from "../config/workspace.js";

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
      const edits = normalizeEditFileEditsInput(args);
      if (!edits || edits.length === 0) {
        return {
          code: "TOOL_BAD_ARGS",
          message: "edit_file: provide either 'edits' or the shorthand pair 'oldText' + 'newText'",
        };
      }
      args.edits = edits;
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
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
      break;
    }
    case "desktop": {
      if (!args.method || typeof args.method !== "string" || !args.method.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "desktop: 'method' must be a non-empty string" };
      }
      if (args.params !== undefined && (typeof args.params !== "object" || args.params === null || Array.isArray(args.params))) {
        return { code: "TOOL_BAD_ARGS", message: "desktop: 'params' must be an object when provided" };
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

function applyPreviewFooter(
  previewText: string | undefined,
  params: {
    durationMs: number;
    fullOutputPath?: string;
  }
): string | undefined {
  const base = (previewText || "").trim();
  if (!base) return previewText;

  const footerLines = [`[durationMs] ${params.durationMs}`];
  if (params.fullOutputPath && !base.includes("[fullOutputPath]")) {
    footerLines.push(`[fullOutputPath] ${params.fullOutputPath}`);
  }

  const footer = footerLines.join("\n");
  const separator = base ? "\n" : "";
  const bodyBudget = TOOL_PREVIEW_MAX_CHARS - footer.length - separator.length;
  if (bodyBudget <= 0) {
    return clipPreviewText(footer);
  }

  const body = clipPreviewText(base, bodyBudget);
  return `${body}${separator}${footer}`;
}

function finalizeToolResultPreview<T extends ToolResult>(result: T): T {
  result.previewText = applyPreviewFooter(result.previewText, {
    durationMs: result.durationMs,
    fullOutputPath: result.fullOutputPath,
  });
  return result;
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

function buildReadFilePreviewText(params: {
  filePath: string;
  content: string;
  byteLength: number;
  truncated: boolean;
}): string {
  const lines = [
    `[read_file] path=${params.filePath}`,
    `[bytes] ${params.byteLength}`,
    params.truncated ? "[status] truncated-preview" : "[status] inline-full",
    "[content]",
    params.content,
  ];
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

function buildWriteFilePreviewText(params: {
  filePath: string;
  bytesWritten: number;
}): string {
  return clipPreviewText([
    `[write_file] path=${params.filePath}`,
    `[bytesWritten] ${params.bytesWritten}`,
  ].join("\n"));
}

function buildEditFilePreviewText(params: {
  filePath: string;
  editsApplied: number;
}): string {
  return clipPreviewText([
    `[edit_file] path=${params.filePath}`,
    `[editsApplied] ${params.editsApplied}`,
  ].join("\n"));
}

function buildToolErrorPreviewText(tool: ToolName, message: string): string {
  return clipPreviewText([
    `[${tool}] error`,
    message,
  ].join("\n"));
}

function buildTtsPreviewText(audioPath: string): string {
  return clipPreviewText([
    `[tts] audioPath=${audioPath}`,
  ].join("\n"));
}

function buildAsrPreviewText(txtPath: string): string {
  return clipPreviewText([
    `[asr] txtPath=${txtPath}`,
  ].join("\n"));
}

function buildVisionPreviewText(textPath: string): string {
  return clipPreviewText([
    `[vision] textPath=${textPath}`,
  ].join("\n"));
}

function buildBrowserPreviewText(params: {
  operation: string;
  data: Record<string, unknown>;
  textPath?: string;
  textBytes?: number;
  textPreview?: string;
  textTruncated?: boolean;
}): string {
  const lines = [`[browser] operation=${params.operation}`];
  if (typeof params.data.title === "string" && params.data.title.trim()) {
    lines.push(`[title] ${params.data.title.trim()}`);
  }
  if (typeof params.data.url === "string" && params.data.url.trim()) {
    lines.push(`[url] ${params.data.url.trim()}`);
  }
  if (typeof params.data.instanceId === "string" && params.data.instanceId.trim()) {
    lines.push(`[instanceId] ${params.data.instanceId.trim()}`);
  }
  if (typeof params.data.tabId === "string" && params.data.tabId.trim()) {
    lines.push(`[tabId] ${params.data.tabId.trim()}`);
  }
  if (params.textPath) {
    lines.push(`[textPath] ${params.textPath}`);
  }
  if (typeof params.textBytes === "number" && Number.isFinite(params.textBytes)) {
    lines.push(`[textBytes] ${params.textBytes}`);
  }
  if (params.textPreview) {
    lines.push(params.textTruncated ? "[status] truncated-text-preview" : "[status] inline-text-preview");
    lines.push("[textPreview]");
    lines.push(params.textPreview);
  }
  if (lines.length === 1) {
    const keys = Object.keys(params.data).slice(0, 6);
    lines.push(keys.length > 0 ? `[keys] ${keys.join(", ")}` : "[status] ok");
  }
  return clipPreviewText(lines.join("\n"));
}

function buildBrowserTextSnippet(text: string): {
  preview: string;
  truncated: boolean;
  textBytes: number;
} {
  const normalized = text.trim();
  const textBytes = Buffer.byteLength(normalized, "utf-8");
  if (normalized.length <= BROWSER_TEXT_PREVIEW_CHARS) {
    return {
      preview: normalized,
      truncated: false,
      textBytes,
    };
  }
  return {
    preview: `${normalized.slice(0, BROWSER_TEXT_PREVIEW_CHARS)}...`,
    truncated: true,
    textBytes,
  };
}

async function persistBrowserTextArtifact(params: {
  workspacePath: string;
  text: string;
}): Promise<{
  textPath: string;
  textBytes: number;
  textPreview: string;
  textTruncated: boolean;
}> {
  const browserDir = joinPath(params.workspacePath, "artifacts", "browser");
  await mkdirFs(browserDir, { recursive: true });
  const textPath = joinPath(browserDir, `tabs-text-${randomUUID()}.txt`);
  await writeFileFs(textPath, params.text, "utf-8");
  const snippet = buildBrowserTextSnippet(params.text);
  return {
    textPath,
    textBytes: snippet.textBytes,
    textPreview: snippet.preview,
    textTruncated: snippet.truncated,
  };
}

function buildDesktopPreviewText(params: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}): string {
  const lines = [`[desktop] exitCode=${params.exitCode ?? "null"}`];
  if (params.stdout.trim()) {
    lines.push("[stdout]");
    lines.push(params.stdout.trim());
  }
  if (params.stderr.trim()) {
    lines.push("[stderr]");
    lines.push(params.stderr.trim());
  }
  return clipPreviewText(lines.join("\n"));
}

function buildFeishuSendFilePreviewText(params: {
  chatId: string;
  attachmentType?: "file" | "image";
  attachmentKey?: string;
}): string {
  const lines = [`[feishu_send_file] chatId=${params.chatId}`];
  if (params.attachmentType) {
    lines.push(`[attachmentType] ${params.attachmentType}`);
  }
  if (params.attachmentKey) {
    lines.push(`[attachmentKey] ${params.attachmentKey}`);
  }
  return clipPreviewText(lines.join("\n"));
}

function buildFeishuListMembersPreviewText(params: {
  chatId: string;
  memberTotal: number;
  members: Array<{ senderId: string; name: string }>;
}): string {
  const lines = [
    `[feishu_list_members] chatId=${params.chatId}`,
    `[memberTotal] ${params.memberTotal}`,
  ];
  const roster = params.members.slice(0, 5).map((member) => member.name || member.senderId);
  if (roster.length > 0) {
    lines.push("[members]");
    lines.push(...roster.map((name) => `- ${name}`));
  }
  return clipPreviewText(lines.join("\n"));
}

function buildFeishuRecentMessagesPreviewText(params: {
  chatId: string;
  count: number;
  messages: Array<{ textSnippet: string; senderId: string; messageType: string }>;
}): string {
  const lines = [
    `[feishu_list_recent_messages] chatId=${params.chatId}`,
    `[count] ${params.count}`,
  ];
  const snippets = params.messages.slice(0, 5).map((message) => {
    const snippet = (message.textSnippet || "").trim() || `<${message.messageType}>`;
    return `- ${message.senderId}: ${snippet}`;
  });
  if (snippets.length > 0) {
    lines.push("[messages]");
    lines.push(...snippets);
  }
  return clipPreviewText(lines.join("\n"));
}

function buildFeishuReplyPreviewText(params: {
  repliedToMessageId: string;
  messageId: string;
  replyInThread: boolean;
}): string {
  return clipPreviewText([
    `[feishu_reply_message] repliedTo=${params.repliedToMessageId}`,
    `[messageId] ${params.messageId}`,
    `[replyInThread] ${params.replyInThread ? "true" : "false"}`,
  ].join("\n"));
}

function buildFeishuReactPreviewText(params: {
  messageId: string;
  emojiType: string;
  reactionId?: string;
}): string {
  const lines = [
    `[feishu_react_message] messageId=${params.messageId}`,
    `[emojiType] ${params.emojiType}`,
  ];
  if (params.reactionId) {
    lines.push(`[reactionId] ${params.reactionId}`);
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
      previewText: buildToolErrorPreviewText(tool, gate.message!),
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

    return finalizeToolResultPreview(result);
  }

  // P5.6.13-R1A-EXEC R2: 参数校验（四核心工具）
  const validationError = validateToolArgs(tool, args);
  if (validationError) {
    const result: ToolResult = {
      ok: false,
      tool,
      error: { code: validationError.code, message: validationError.message },
      previewText: buildToolErrorPreviewText(tool, validationError.message),
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

    return finalizeToolResultPreview(result);
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
          previewText: buildTtsPreviewText(out.audioPath),
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
          previewText: buildAsrPreviewText(out.txtPath),
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
          previewText: buildVisionPreviewText(out.textPath),
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

          const browserData = {
            ...browser.data,
          } as Record<string, unknown>;
          let browserTextArtifact: {
            textPath: string;
            textBytes: number;
            textPreview: string;
            textTruncated: boolean;
          } | null = null;

          if (
            browser.operation === "tabs.text"
            && typeof browserData.text === "string"
            && browserData.text.trim()
          ) {
            browserTextArtifact = await persistBrowserTextArtifact({
              workspacePath: ctx.workspacePath,
              text: browserData.text,
            });
            delete browserData.text;
            browserData.textPath = browserTextArtifact.textPath;
            browserData.textBytes = browserTextArtifact.textBytes;
            browserData.textTruncated = browserTextArtifact.textTruncated;
          }

          result = {
            ok: true,
            tool,
            data: {
              operation: browser.operation,
              result: browserData,
              textPath: browserTextArtifact?.textPath,
              textBytes: browserTextArtifact?.textBytes,
              textTruncated: browserTextArtifact?.textTruncated,
            },
            artifacts: browserTextArtifact
              ? [{ kind: "browser", path: browserTextArtifact.textPath }]
              : undefined,
            previewText: buildBrowserPreviewText({
              operation: browser.operation,
              data: browserData,
              textPath: browserTextArtifact?.textPath,
              textBytes: browserTextArtifact?.textBytes,
              textPreview: browserTextArtifact?.textPreview,
              textTruncated: browserTextArtifact?.textTruncated,
            }),
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
            previewText: buildToolErrorPreviewText(tool, message),
            durationMs: Date.now() - started,
          };
          break;
        }
      }
      case "desktop": {
        const out = await withTimeout(
          runDesktopTool({
            workspacePath: ctx.workspacePath,
            method: String(args.method),
            params: (args.params as Record<string, unknown> | undefined) ?? {},
            timeoutMs: ctx.timeoutMs ?? 120000,
          }),
          ctx.timeoutMs ?? 120000
        );

        result = {
          ok: out.exitCode === 0,
          tool,
          data: { exitCode: out.exitCode, stdout: out.stdout, stderr: out.stderr },
          artifacts: out.artifacts,
          previewText: buildDesktopPreviewText({
            exitCode: out.exitCode,
            stdout: out.stdout,
            stderr: out.stderr,
          }),
          durationMs: Date.now() - started,
        };
        break;
      }
      // P5.6.13-R1A-EXEC: run_skill 已退役
      case "read_file": {
        const out = await runReadFileTool(
          { path: String(args.path || "") },
          {
            workspacePath: ctx.workspacePath,
            timeoutMs: ctx.timeoutMs ?? 30000,
          }
        );

        if (!out.ok) {
          result = {
            ok: false,
            tool,
            error: {
              code: out.code,
              message: out.message,
            },
            previewText: out.previewText ?? buildToolErrorPreviewText(tool, out.message),
            durationMs: Date.now() - started,
          };
          break;
        }

        result = {
          ok: true,
          tool,
          data: {
            content: out.content,
            path: out.filePath,
            ...(out.truncated ? { truncated: true } : {}),
            byteLength: out.byteLength,
          },
          previewText: buildReadFilePreviewText({
            filePath: out.filePath,
            content: out.content,
            byteLength: out.byteLength,
            truncated: Boolean(out.truncated),
          }),
          durationMs: Date.now() - started,
        };
        break;
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
        const out = await runWriteFileTool(
          {
            path: String(args.path || ""),
            content: String(args.content ?? ""),
          },
          {
            workspacePath: ctx.workspacePath,
            timeoutMs: ctx.timeoutMs ?? 30000,
          }
        );

        if (!out.ok) {
          result = {
            ok: false,
            tool,
            error: {
              code: out.code,
              message: out.message,
            },
            previewText: out.previewText ?? buildToolErrorPreviewText(tool, out.message),
            durationMs: Date.now() - started,
          };
          break;
        }

        result = {
          ok: true,
          tool,
          data: {
            path: out.displayPath,
            bytesWritten: out.bytesWritten,
          },
          previewText: buildWriteFilePreviewText({
            filePath: out.filePath,
            bytesWritten: out.bytesWritten,
          }),
          durationMs: Date.now() - started,
        };
        break;
      }
      case "edit_file": {
        const edits = normalizeEditFileEditsInput(args) ?? [];
        const out = await runEditFileTool(
          {
            path: String(args.path || ""),
            edits,
          },
          {
            workspacePath: ctx.workspacePath,
            timeoutMs: ctx.timeoutMs ?? 30000,
          }
        );

        if (!out.ok) {
          result = {
            ok: false,
            tool,
            error: {
              code: out.code,
              message: out.message,
            },
            previewText: out.previewText ?? buildToolErrorPreviewText(tool, out.message),
            durationMs: Date.now() - started,
          };
          break;
        }

        result = {
          ok: true,
          tool,
          data: { path: out.displayPath, editsApplied: out.editsApplied },
          previewText: buildEditFilePreviewText({
            filePath: out.filePath,
            editsApplied: out.editsApplied,
          }),
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_send_file": {
        const filePath = String(args.filePath ?? "").trim();
        const out = await withTimeout(
          runFeishuSendFileTool(
            {
              filePath,
              chatId: args.chatId ? String(args.chatId).trim() : undefined,
              message: args.message ? String(args.message).trim() : undefined,
            },
            {
              workspacePath: ctx.workspacePath,
              chatId: ctx.chatId,
              currentMessageId: ctx.currentMessageId,
              defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
            }
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
          previewText: out.ok
            ? buildFeishuSendFilePreviewText({
                chatId: out.chatId,
                attachmentType: out.attachmentType,
                attachmentKey: out.attachmentKey,
              })
            : buildToolErrorPreviewText(tool, out.error || "发送失败"),
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_list_members": {
        const out = await withTimeout(
          runFeishuListMembersTool(
            {
              chatId: args.chatId ? String(args.chatId).trim() : undefined,
              memberIdType: String(args.memberIdType ?? "open_id").trim(),
            },
            {
              workspacePath: ctx.workspacePath,
              chatId: ctx.chatId,
              currentMessageId: ctx.currentMessageId,
              defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
            }
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
          previewText: out.ok
            ? buildFeishuListMembersPreviewText({
                chatId: out.chatId,
                memberTotal: out.memberTotal ?? out.members?.length ?? 0,
                members: out.members ?? [],
              })
            : buildToolErrorPreviewText(tool, out.error || "获取群成员失败"),
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_list_recent_messages": {
        const out = await withTimeout(
          runFeishuListRecentMessagesTool(
            {
              chatId: args.chatId ? String(args.chatId).trim() : undefined,
              limit: args.limit,
            },
            {
              workspacePath: ctx.workspacePath,
              chatId: ctx.chatId,
              currentMessageId: ctx.currentMessageId,
              defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
            }
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
          previewText: out.ok
            ? buildFeishuRecentMessagesPreviewText({
                chatId: out.chatId,
                count: out.count ?? out.messages?.length ?? 0,
                messages: out.messages ?? [],
              })
            : buildToolErrorPreviewText(tool, out.error || "获取最近消息失败"),
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_reply_message": {
        const text = String(args.text ?? "").trim();
        const replyInThread = Boolean(args.replyInThread);
        const out = await withTimeout(
          runFeishuReplyMessageTool(
            {
              messageId: args.messageId ? String(args.messageId).trim() : undefined,
              text,
              replyInThread,
            },
            {
              workspacePath: ctx.workspacePath,
              chatId: ctx.chatId,
              currentMessageId: ctx.currentMessageId,
              defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
            }
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
          previewText: out.ok
            ? buildFeishuReplyPreviewText({
                repliedToMessageId: out.repliedToMessageId,
                messageId: out.messageId ?? "",
                replyInThread: out.replyInThread ?? replyInThread,
              })
            : buildToolErrorPreviewText(tool, out.error || "回复消息失败"),
          durationMs: Date.now() - started,
        };
        break;
      }
      case "feishu_react_message": {
        const out = await withTimeout(
          runFeishuReactMessageTool(
            {
              messageId: args.messageId ? String(args.messageId).trim() : undefined,
              emoji: args.emoji ? String(args.emoji).trim() : undefined,
            },
            {
              workspacePath: ctx.workspacePath,
              chatId: ctx.chatId,
              currentMessageId: ctx.currentMessageId,
              defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
            }
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
          previewText: out.ok
            ? buildFeishuReactPreviewText({
                messageId: out.messageId,
                reactionId: out.reactionId,
                emojiType: out.emojiType ?? "THUMBSUP",
              })
            : buildToolErrorPreviewText(tool, out.error || "消息表情回复失败"),
          durationMs: Date.now() - started,
        };
        break;
      }
      default:
        result = {
          ok: false,
          tool,
          error: { code: "TOOL_NOT_ALLOWED", message: `unsupported tool in P0: ${tool}` },
          previewText: buildToolErrorPreviewText(tool, `unsupported tool in P0: ${tool}`),
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

    return finalizeToolResultPreview(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg === "TOOL_TIMEOUT" ? "TOOL_TIMEOUT" : "TOOL_EXEC_FAILED";

    const result: ToolResult = {
      ok: false,
      tool,
      error: { code, message: msg },
      previewText: buildToolErrorPreviewText(tool, msg),
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

    return finalizeToolResultPreview(result);
  }
}

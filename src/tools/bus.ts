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
  ToolName, ToolSource, ToolPolicy, ToolContext, ToolResult
} from "./types.js";
import { getToolPolicy } from "../config/workspace.js";
import { runTts } from "../runners/tts.js";
import { runAsr } from "../runners/asr.js";
import { runVision } from "../runners/vision.js";
import { runBashCommand } from "../runners/bash-runner.js";
import {
  runGhostMcpTool,
  type GhostToolRunResult,
} from "../runners/ghost-mcp-client.js";
import {
  isGhostToolName,
} from "../runners/ghost-mcp-contract.js";
import { logger } from "../logger/index.js";
import { recordToolEvent } from "./telemetry.js";
import { filterDefaultLlmTools } from "./manifest.js";
import { validateToolArgs } from "./registry.js";
import { executeRoutedTool } from "./handlers.js";
import {
  buildToolErrorPreviewText,
} from "./previews.js";

const MEDIA_PIPELINE_ALLOWED: ToolName[] = ["asr", "vision"];
const TOOL_PREVIEW_MAX_CHARS = 4000;

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

function buildGhostPreviewText(tool: ToolName, params: GhostToolRunResult): string {
  const lines = [
    `[${tool}] ${params.statusSummary}`,
    `[ghost] version=${params.version}`,
    `[binary] ${params.binaryPath}`,
  ];

  if (params.structuredContent) {
    lines.push("[json]");
    lines.push(JSON.stringify(params.structuredContent));
  } else if (params.textContent) {
    lines.push("[text]");
    lines.push(params.textContent);
  }

  const artifactPaths = (params.artifacts ?? []).map((item) => item.path);
  if (artifactPaths.length > 0) {
    lines.push("[artifacts]");
    lines.push(...artifactPaths.map((path) => `- ${path}`));
  }

  if (params.stderr.trim()) {
    lines.push("[stderr]");
    lines.push(params.stderr.trim());
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
      errorMessage: gate.message!,
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
      errorMessage: validationError.message,
      artifactPaths: [],
      timestamp: Date.now(),
    });

    return finalizeToolResultPreview(result);
  }

  try {
    let result: ToolResult;
    const routedResult = await executeRoutedTool(tool, args, ctx, started);
    if (routedResult) {
      result = routedResult;
    } else {

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
      case "ghost_context":
      case "ghost_state":
      case "ghost_find":
      case "ghost_read":
      case "ghost_inspect":
      case "ghost_element_at":
      case "ghost_screenshot":
      case "ghost_click":
      case "ghost_type":
      case "ghost_press":
      case "ghost_hotkey":
      case "ghost_scroll":
      case "ghost_hover":
      case "ghost_long_press":
      case "ghost_drag":
      case "ghost_focus":
      case "ghost_window":
      case "ghost_wait":
      case "ghost_recipes":
      case "ghost_run":
      case "ghost_recipe_show":
      case "ghost_recipe_save":
      case "ghost_recipe_delete":
      case "ghost_parse_screen":
      case "ghost_ground":
      case "ghost_annotate": {
        const ghostToolName = isGhostToolName(tool) ? tool : null;
        if (!ghostToolName) {
          throw new Error(`invalid ghost tool: ${tool}`);
        }

        const out = await withTimeout(
          runGhostMcpTool({
            workspacePath: ctx.workspacePath,
            toolName: ghostToolName,
            args,
            timeoutMs: ctx.timeoutMs ?? 120000,
          }),
          ctx.timeoutMs ?? 120000
        );

        result = {
          ok: true,
          tool,
          data: {
            rawResult: out.rawResult,
            structuredContent: out.structuredContent,
            textContent: out.textContent,
            binaryPath: out.binaryPath,
            version: out.version,
            statusSummary: out.statusSummary,
            stderr: out.stderr || undefined,
          },
          artifacts: out.artifacts,
          previewText: buildGhostPreviewText(tool, out),
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
      errorMessage: result.error?.message,
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
      errorMessage: msg,
      artifactPaths: [],
      timestamp: Date.now(),
    });

    return finalizeToolResultPreview(result);
  }
}

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
import { loadWorkspaceConfig } from "../config/workspace.js";
import { runTts } from "../runners/tts.js";
import { runAsr } from "../runners/asr.js";
import { runVisionOcr } from "../runners/vision_ocr.js";
import { logger } from "../logger/index.js";
import { recordToolEvent } from "./telemetry.js";

const TOOL_META: Record<ToolName, { sideEffect: SideEffectLevel }> = {
  tts: { sideEffect: "message-send" },
  asr: { sideEffect: "local-write" },
  vision: { sideEffect: "local-write" },
  mem: { sideEffect: "local-write" },
  shell: { sideEffect: "process-control" },
  browser: { sideEffect: "process-control" },
};

const MEDIA_PIPELINE_ALLOWED: ToolName[] = ["asr", "vision"];

function normalizePolicy(raw: Partial<ToolPolicy> | null | undefined): ToolPolicy {
  // 优先级：explicit（默认稳态） > autonomous > tool-calls
  const mode = raw?.mode === "explicit" || raw?.mode === "autonomous" || raw?.mode === "tool-calls"
    ? raw.mode
    : "explicit"; // 默认改为 explicit（稳态）

  return {
    mode,
    allow: (raw?.allow ?? ["tts", "asr", "vision"]) as ToolName[],
    requireConfirm: (raw?.requireConfirm ?? []) as ToolName[],
  };
}

export async function getToolPolicy(workspacePath: string): Promise<ToolPolicy> {
  const cfg = await loadWorkspaceConfig(workspacePath);
  return normalizePolicy({
    mode: cfg["tooling.mode"] as ToolPolicy["mode"] | undefined,
    allow: cfg["tooling.allow"] as ToolName[] | undefined,
    requireConfirm: cfg["tooling.require_confirm"] as ToolName[] | undefined,
  });
}

export function canExecuteTool(
  policy: ToolPolicy,
  tool: ToolName,
  source: ToolSource
): { ok: boolean; code?: NonNullable<ToolResult["error"]>["code"]; message?: string } {
  // 检查工具是否在允许列表中
  if (!policy.allow.includes(tool)) {
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

async function withTimeout<T>(p: Promise<T>, ms = 120000): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("TOOL_TIMEOUT")), ms)),
  ]);
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

  try {
    let result: ToolResult;

    switch (tool) {
      case "tts": {
        const text = String(args.text ?? "").trim();
        if (!text) throw new Error("empty text");
        const out = await withTimeout(
          runTts({ workspacePath: ctx.workspacePath, text }),
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
        const inputPath = String(args.inputPath ?? "");
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
          runVisionOcr({ workspacePath: ctx.workspacePath, imagePath, userQuery }),
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
      case "shell": {
        const command = String(args.command ?? "").trim();
        if (!command) throw new Error("empty command");

        // 使用 spawn 执行 shell 命令（shell: true = 完整 shell 解释，支持管道/重定向）
        const { spawn } = await import("node:child_process");
        const out = await withTimeout(
          new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
            const proc = spawn(command, {
              cwd: ctx.workspacePath,
              shell: true,
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

        result = {
          ok: out.exitCode === 0,
          tool,
          data: { exitCode: out.exitCode ?? -1, stdout: out.stdout, stderr: out.stderr },
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

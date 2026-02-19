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
  bash: { sideEffect: "process-control" },
  browser: { sideEffect: "process-control" },
  desktop: { sideEffect: "local-write" },  // T6.1: observe 会落盘 evidence
  run_skill: { sideEffect: "read-only" },  // P5.5: Skill execution (read-only)
  read_file: { sideEffect: "read-only" },  // P5.6.8-R3: PI 四基础工具
  write_file: { sideEffect: "local-write" },
  edit_file: { sideEffect: "local-write" },
};

const MEDIA_PIPELINE_ALLOWED: ToolName[] = ["asr", "vision"];

function normalizePolicy(raw: Partial<ToolPolicy> | null | undefined): ToolPolicy {
  // P5.5: 测试期统一 autonomous（让 LLM 自主决策 tool_calls）
  const mode = raw?.mode === "explicit" || raw?.mode === "autonomous" || raw?.mode === "tool-calls"
    ? raw.mode
    : "autonomous"; // P5.5: 测试期默认 autonomous

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
      case "bash": {  // P5.6.8-R4g: 统一使用 bash 命名
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
      case "run_skill": {
        // P5.5: 统一 skill 执行器入口
        const skillId = String(args.skill_id ?? "").trim();
        if (!skillId) throw new Error("missing skill_id");

        const input = typeof args.input === "string" ? args.input : "";

        // 调用 skills/auto.ts:runSkill()（单一执行器）
        const { runSkill } = await import("../skills/auto.js");
        const skillResult = await withTimeout(
          runSkill(skillId as any, input, {
            workspacePath: ctx.workspacePath,
            chatId: ctx.chatId,
            requestId: ctx.requestId,
          }),
          ctx.timeoutMs ?? 60000
        );

        // 记录 skill 执行事件（含观测字段）
        logger.info("Skill executed via tool_calls", {
          module: "tools-bus",
          chatId: ctx.chatId,
          autoSkill: skillResult.skillId,
          autoSkillResult: skillResult.ok ? "ok" : "error",
          durationMs: skillResult.durationMs,
        });

        result = {
          ok: skillResult.ok,
          tool,
          data: { output: skillResult.output },
          error: skillResult.error ? { code: "TOOL_EXEC_FAILED", message: skillResult.error } : undefined,
          durationMs: Date.now() - started,
        };
        break;
      }
      case "read_file": {
        // P5.6.8-R3: 读取文件内容
        const { resolve } = await import("node:path");
        const filePath = resolve(ctx.workspacePath, String(args.path || ""));

        // 安全检查：文件必须在 workspace 内
        if (!filePath.startsWith(ctx.workspacePath)) {
          throw new Error("path must be under workspace");
        }

        const content = await withTimeout(
          (await import("node:fs/promises")).readFile(filePath, "utf-8"),
          ctx.timeoutMs ?? 30000
        );

        result = {
          ok: true,
          tool,
          data: { content },
          durationMs: Date.now() - started,
        };
        break;
      }
      case "write_file": {
        // P5.6.8-R3: 整文件写入
        const { resolve, dirname } = await import("node:path");
        const filePath = resolve(ctx.workspacePath, String(args.path || ""));
        const content = String(args.content ?? "");

        // 安全检查
        if (!filePath.startsWith(ctx.workspacePath)) {
          throw new Error("path must be under workspace");
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
        const { resolve } = await import("node:path");
        const filePath = resolve(ctx.workspacePath, String(args.path || ""));
        const edits = args.edits as Array<{ oldText: string; newText: string }> | undefined;

        // 安全检查
        if (!filePath.startsWith(ctx.workspacePath)) {
          throw new Error("path must be under workspace");
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

/**
 * msgcode: 会话编排器
 *
 * 职责：
 * - Runner 类型解析（tmux/direct）
 * - 会话生命周期管理（start/stop/status）
 * - 会话操作（snapshot/esc/clear）
 * - 不承载业务逻辑，只做编排与分发
 */

import type { RunnerType } from "../tmux/session.js";
import { TmuxSession } from "../tmux/session.js";
import { sendSnapshot, sendEscape, sendClear } from "../tmux/sender.js";
import { clearSessionArtifacts } from "../session-artifacts.js";
import { logger } from "../logger/index.js";
// P5.6.13-R2: 导入线程存储
import { resetThread } from "./thread-store.js";

// ============================================
// 类型定义
// ============================================

export interface RunnerInfo {
  runner: RunnerType;
  runnerConfig?: "lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code";
  blockedReason?: string;
}

export interface SessionContext {
  projectDir?: string;
  chatId: string;
  groupName: string;
}

export interface SessionResult {
  success: boolean;
  response?: string;
  error?: string;
}

// ============================================
// Runner 解析
// ============================================

/**
 * 解析当前 runner 配置
 *
 * @param projectDir 工作区路径
 * @returns Runner 信息（类型、配置、阻塞原因）
 */
export async function resolveRunner(projectDir?: string): Promise<RunnerInfo> {
  if (!projectDir) return { runner: "direct" };

  try {
    const { getPolicyMode, getDefaultRunner } = await import("../config/workspace.js");
    const mode = await getPolicyMode(projectDir);
    const r = await getDefaultRunner(projectDir);

    // 判断是否为 tmux runner (归一化为 "tmux" | "direct")
    const isTmuxRunner = r === "codex" || r === "claude-code";
    const runner: RunnerType = isTmuxRunner ? "tmux" : "direct";

    // Note: codex and claude-code are tmux runners (need egress)
    if (runner === "tmux" && mode === "local-only") {
      return {
        runner,
        runnerConfig: r,
        blockedReason:
          "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行: /policy on （或 /policy egress-allowed）",
      };
    }

    return { runner, runnerConfig: r };
  } catch {
    return { runner: "direct" };
  }
}

// ============================================
// 会话生命周期管理
// ============================================

/**
 * 启动会话
 *
 * @param ctx 会话上下文
 * @returns 会话操作结果
 */
export async function startSession(ctx: SessionContext): Promise<SessionResult> {
  const r = await resolveRunner(ctx.projectDir);
  if (r.blockedReason) {
    return { success: false, error: r.blockedReason };
  }

  // P0: direct 执行臂无需 tmux 会话（返回 success:true 改善体验）
  if (r.runner !== "tmux") {
    return {
      success: true,
      response: `当前为 direct 执行臂 (${r.runnerConfig})，无需 /start。\n\n直接发送消息即可开始对话。\n\n` +
        `提示：如需切换到 tmux 执行臂，请使用 /model codex 或 /model claude-code`
    };
  }

  // 传递具体执行臂（codex/claude-code）作为 runnerOld 参数
  const runnerOld = r.runnerConfig === "codex" || r.runnerConfig === "claude-code"
    ? r.runnerConfig
    : undefined;

  const response = await TmuxSession.start(
    ctx.groupName,
    ctx.projectDir,
    r.runner,     // "tmux"
    runnerOld     // "codex" | "claude-code" | undefined
  );

  return { success: true, response };
}

/**
 * 关闭会话
 *
 * @param ctx 会话上下文
 * @returns 会话操作结果
 */
export async function stopSession(ctx: SessionContext): Promise<SessionResult> {
  const r = await resolveRunner(ctx.projectDir);

  if (r.runner !== "tmux") {
    return { success: true, response: `当前为 direct 执行臂 (${r.runnerConfig})，无需 /stop。` };
  }

  const response = await TmuxSession.stop(ctx.groupName);
  return { success: true, response };
}

/**
 * 查看会话状态
 *
 * @param ctx 会话上下文
 * @returns 会话操作结果
 */
export async function getSessionStatus(ctx: SessionContext): Promise<SessionResult> {
  const r = await resolveRunner(ctx.projectDir);

  if (r.runner !== "tmux") {
    return { success: true, response: `当前执行臂: ${r.runnerConfig}\n状态: direct（无 tmux 会话）` };
  }

  const response = await TmuxSession.status(ctx.groupName);
  return { success: true, response };
}

// ============================================
// 会话操作
// ============================================

/**
 * 获取终端快照
 *
 * @param ctx 会话上下文
 * @returns 会话操作结果
 */
export async function getSnapshot(ctx: SessionContext): Promise<SessionResult> {
  const r = await resolveRunner(ctx.projectDir);

  if (r.runner !== "tmux") {
    return { success: false, error: "当前为 direct 执行臂，不支持 /snapshot。" };
  }

  const response = await sendSnapshot(ctx.groupName);
  return { success: true, response };
}

/**
 * 发送 ESC 中断
 *
 * @param ctx 会话上下文
 * @returns 会话操作结果
 */
export async function sendEscapeInterrupt(ctx: SessionContext): Promise<SessionResult> {
  const r = await resolveRunner(ctx.projectDir);

  if (r.runner !== "tmux") {
    return { success: false, error: "当前为 direct 执行臂，不支持 /esc。" };
  }

  const response = await sendEscape(ctx.groupName);
  return { success: true, response };
}

/**
 * 清空会话
 *
 * R2: /clear 边界化
 * - 清理 window（短期会话窗口）
 * - 清理 summary（会话摘要）
 * - 不清理 memory（长期记忆）
 * - tmux 执行臂额外重启进程
 *
 * @param ctx 会话上下文
 * @returns 会话操作结果
 */
export async function clearSession(ctx: SessionContext): Promise<SessionResult> {
  const r = await resolveRunner(ctx.projectDir);
  if (r.blockedReason) {
    return { success: false, error: r.blockedReason };
  }

  // R2: 统一清理 session artifacts（window + summary）
  const artifactsResult = await clearSessionArtifacts(ctx.projectDir, ctx.chatId);
  if (!artifactsResult.ok) {
    return { success: false, error: artifactsResult.error };
  }

  logger.info("Session artifacts cleared", {
    module: "session-orchestrator",
    chatId: ctx.chatId,
    runner: r.runner,
  });

  // P5.6.13-R2: 重置线程（/clear 后创建新线程）
  resetThread(ctx.chatId).catch((err) => {
    logger.warn("resetThread failed (non-blocking)", {
      module: "session-orchestrator",
      chatId: ctx.chatId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Tmux runners: 额外重启进程
  if (r.runner === "tmux") {
    const runnerOld = r.runnerConfig === "codex" || r.runnerConfig === "claude-code"
      ? r.runnerConfig
      : undefined;
    const response = await sendClear(ctx.groupName, ctx.projectDir, r.runner, runnerOld);
    return { success: true, response: `已清理会话文件 + ${response}` };
  }

  // Direct runners: 只清理文件
  return { success: true, response: "已清理会话文件（window + summary）" };
}

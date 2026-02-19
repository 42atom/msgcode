/**
 * msgcode: Skill 编排器
 *
 * 职责：
 * - Skill 触发检测（auto skill）
 * - Skill 执行入口（/skill run + tool_calls）
 * - 统一日志记录（autoSkill, autoSkillResult）
 * - 不承载 skill 业务逻辑，只做编排与分发
 */

import { logger } from "../logger/index.js";
import {
  detectAutoSkill,
  normalizeSkillId,
  runAutoSkill,
  runSkill,
  type SkillMatch,
  type SkillId,
} from "../skills/auto.js";

// ============================================
// 类型定义
// ============================================

export interface SkillContext {
  workspacePath?: string;
  chatId?: string;
  requestId?: string;
}

export interface SkillResult {
  success: boolean;
  response?: string;
  error?: string;
}

// ============================================
// Skill 命令处理（/skill run）
// ============================================

/**
 * 处理 /skill run 命令
 *
 * P5.6.8-R3d: 降级为调试入口（仅开发模式可用）
 *
 * @param command 原始命令文本
 * @param ctx Skill 上下文
 * @returns 处理结果（null 表示不是 skill 命令）
 */
export async function handleSkillRunCommand(
  command: string,
  ctx: SkillContext
): Promise<SkillResult | null> {
  // P5.6.8-R3d: 仅在开发模式下可用
  if (process.env.MSGCODE_DEV_MODE !== "true") {
    const trimmed = command.trim();
    if (!trimmed.startsWith("/skill")) return null;

    const parts = trimmed.split(/\s+/);
    if (parts[0] !== "/skill") return null;

    if (parts[1] === "run") {
      return {
        success: false,
        response: "/skill run 仅在开发模式下可用（设置 MSGCODE_DEV_MODE=true）"
      };
    }
    return null;
  }

  const trimmed = command.trim();
  if (!trimmed.startsWith("/skill")) return null;

  const parts = trimmed.split(/\s+/);
  if (parts[0] !== "/skill") return null;

  if (parts[1] !== "run") {
    return { success: true, response: "用法: /skill run <skillId>" };
  }

  const rawId = parts[2] ?? "";
  const skillId = normalizeSkillId(rawId);
  if (!skillId) {
    return { success: false, error: `未知 skill: ${rawId || "<empty>"}` };
  }

  const input = parts.slice(3).join(" ").trim();
  const result = await runSkill(skillId, input, {
    workspacePath: ctx.workspacePath,
    chatId: ctx.chatId,
    requestId: ctx.requestId,
  });

  // P5.5 观测字段：autoSkill, autoSkillResult
  logger.info("Skill run (debug)", {
    module: "skill-orchestrator",
    chatId: ctx.chatId,
    autoSkill: skillId,
    autoSkillResult: result.ok ? "ok" : "error",
  });

  if (!result.ok) {
    return { success: false, error: result.error || "skill failed" };
  }

  return { success: true, response: result.output || "（无输出）" };
}

// ============================================
// Auto Skill 检测与执行
// ============================================

/**
 * 尝试处理 auto skill（自然语言触发）
 *
 * 注意：P5.5 已禁用关键词主触发，此函数保留用于兼容测试
 *
 * @param message 用户消息
 * @param ctx Skill 上下文
 * @returns 处理结果（null 表示没有匹配）
 */
export async function tryHandleAutoSkill(
  message: string,
  ctx: SkillContext
): Promise<SkillResult | null> {
  const match = detectAutoSkill(message);
  if (!match) return null;

  const result = await runAutoSkill(match, {
    workspacePath: ctx.workspacePath,
    chatId: ctx.chatId,
  });

  // P5.5 观测字段：autoSkill, autoSkillResult
  logger.info("AutoSkill triggered", {
    module: "skill-orchestrator",
    chatId: ctx.chatId,
    autoSkill: match.skillId,
    autoSkillResult: result.ok ? "ok" : "error",
  });

  if (!result.ok) {
    return { success: false, error: result.error || "skill failed" };
  }

  return { success: true, response: result.output || "（无输出）" };
}

// ============================================
// Skill 索引（供 LLM tool_calls 使用）
// ============================================

/**
 * Skill 索引信息（供 LLM 决策）
 */
export interface SkillInfo {
  id: SkillId;
  name: string;
  description: string;
  trigger: string;
}

/**
 * 获取可用 skill 索引
 *
 * @returns Skill 索引列表
 */
export function getSkillIndex(): SkillInfo[] {
  return [
    {
      id: "system-info",
      name: "系统信息",
      description: "汇报系统配置和环境信息",
      trigger: "系统信息、系统配置、环境信息",
    },
  ];
}

/**
 * msgcode: Skill 编排器
 *
 * 职责：
 * - Skill 触发检测（auto skill）
 * - Skill 索引（供 LLM 决策）
 * - 统一日志记录（autoSkill, autoSkillResult）
 * - 不承载 skill 业务逻辑，只做编排与分发
 *
 * P5.6.8-R3e: 删除 /skill run 命令面（硬切割）
 */

import { logger } from "../logger/index.js";
import {
  detectAutoSkill,
  runAutoSkill,
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

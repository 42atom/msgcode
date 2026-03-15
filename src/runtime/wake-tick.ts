/**
 * msgcode: Wake Tick - 把 wake consume 封装进 heartbeat tick
 *
 * 职责：
 * - 在 heartbeat tick 中优先消费 wake records
 * - 固定执行顺序：先 wake，再 runnable tasks
 * - 无到期 wake 时静默结束，不刷屏
 */

import { consumePendingWakes, hasPendingWakes } from "./wake-heartbeat.js";
import { logger } from "../logger/index.js";
import type { TickContext } from "./heartbeat.js";
import type { WakeWorkCapsule } from "./wake-consume.js";

/**
 * Wake Tick 配置
 */
export interface WakeTickConfig {
  /** 工作空间路径 */
  workspacePath: string;
  /** 最大一次 tick 消费的 wake 数量 */
  maxConsumePerTick?: number;
  /** 消费者回调 */
  onWakeConsume?: (params: {
    wakeId: string;
    taskId?: string;
    hint?: string;
    capsule?: WakeWorkCapsule;
  }) => Promise<void>;
}

/**
 * Wake Tick 结果
 */
export interface WakeTickResult {
  /** 是否有到期 wake */
  hasWakes: boolean;
  /** 消费了多少 wake */
  consumed: number;
  /** 是否有执行动作 */
  hasActions: boolean;
}

/**
 * 执行 wake tick
 *
 * 执行顺序：
 * 1. 先检查是否有到期 wake（hasPendingWakes）
 * 2. 如果有，调用 consumePendingWakes 消费
 * 3. 返回结果供上层判断是否需要继续扫描 runnable tasks
 *
 * @param config 配置
 * @param tickCtx tick 上下文（用于日志）
 * @returns 执行结果
 */
export async function executeWakeTick(
  config: WakeTickConfig,
  tickCtx: TickContext
): Promise<WakeTickResult> {
  const { workspacePath, maxConsumePerTick = 3, onWakeConsume } = config;

  // 1. 快速检查是否有到期 wake（避免不必要的 list 操作）
  const hasWakes = hasPendingWakes(workspacePath);

  if (!hasWakes) {
    return {
      hasWakes: false,
      consumed: 0,
      hasActions: false,
    };
  }

  // 2. 有到期 wake，消费它们
  logger.debug("[WakeTick] 发现到期 wake，开始消费", {
    workspacePath,
    tickId: tickCtx.tickId,
  });

  const results = await consumePendingWakes(
    workspacePath,
    async ({ wakeRecord, capsule, hint }) => {
      // 调用消费者回调 - 传递完整的 wake 上下文包括 capsule
      if (onWakeConsume) {
        await onWakeConsume({
          wakeId: wakeRecord.id,
          taskId: wakeRecord.taskId,
          hint: hint ?? undefined,
          capsule: capsule ?? undefined,
        });
      }
    },
    { maxConsumePerTick }
  );

  const consumed = results.filter((r) => r.consumed).length;

  logger.info("[WakeTick] wake 消费完成", {
    workspacePath,
    tickId: tickCtx.tickId,
    total: results.length,
    consumed,
  });

  return {
    hasWakes: true,
    consumed,
    hasActions: consumed > 0,
  };
}

/**
 * Heartbeat tick 的完整执行顺序
 *
 * 1. 先检查 wake（优先）
 * 2. 再检查 runnable tasks
 * 3. 两者都无时静默结束
 *
 * @param params 参数
 * @returns 是否还有后续动作（wake 或 task）
 */
export async function executeHeartbeatTick(params: {
  workspacePath: string;
  tickCtx: TickContext;
  maxWakeConsume?: number;
  onWakeConsume?: WakeTickConfig["onWakeConsume"];
  onTaskConsume?: () => Promise<void>;
}): Promise<{ hasActions: boolean }> {
  const { workspacePath, tickCtx, maxWakeConsume, onWakeConsume, onTaskConsume } = params;

  // 1. 先执行 wake tick
  const wakeResult = await executeWakeTick(
    {
      workspacePath,
      maxConsumePerTick: maxWakeConsume,
      onWakeConsume,
    },
    tickCtx
  );

  // 2. 如果 wake 没有执行动作，检查 runnable tasks
  if (!wakeResult.hasActions && onTaskConsume) {
    await onTaskConsume();
  }

  // 3. 返回是否有动作
  return {
    hasActions: wakeResult.hasActions,
  };
}

/**
 * msgcode: Wake Heartbeat Integration - heartbeat 优先消费 wake record
 *
 * 对齐 spec: docs/plan/pl0210.tdo.runtime.wake-record-and-work-capsule-mainline.md
 *
 * 第三刀：heartbeat 优先检查 wake record，不只是泛泛巡检
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { logger } from "../logger/index.js";
import { getPendingWakeRecords } from "./wake-store.js";
import { claimWakeRecord, releaseWakeClaim } from "./wake-claim.js";
import { consumeWakeRecord, type WakeWorkCapsule } from "./wake-consume.js";
import type { WakeRecord } from "./wake-types.js";
import type { TaskRecord } from "./task-types.js";
import { TaskStore } from "./task-store.js";

/**
 * Wake Heartbeat 配置
 */
export interface WakeHeartbeatConfig {
  /** 最大一次 tick 消费的 wake 数量 */
  maxConsumePerTick?: number;
  /** 消费者标识 */
  consumerId?: string;
  /** 租约时长（毫秒） */
  leaseMs?: number;
}

/**
 * Wake 消费结果
 */
export interface WakeConsumeResult {
  /** 是否消费成功 */
  consumed: boolean;
  /** 被消费的 wake record ID */
  wakeRecordId?: string;
  /** 错误消息 */
  error?: string;
}

/**
 * Default 配置
 */
const DEFAULT_MAX_CONSUME = 3;
const DEFAULT_CONSUMER = "heartbeat-consumer";
const DEFAULT_LEASE_MS = 5 * 60 * 1000; // 5分钟

function getWorkspaceTaskDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "tasks");
}

async function loadRuntimeTaskForWake(
  workspacePath: string,
  wakeRecord: WakeRecord
): Promise<TaskRecord | null> {
  if (!wakeRecord.taskId) {
    return null;
  }

  const taskStore = new TaskStore({
    taskDir: getWorkspaceTaskDir(workspacePath),
  });

  return taskStore.getActiveTask(wakeRecord.taskId);
}

/**
 * 在 heartbeat tick 中消费 pending wake records
 *
 * 优先级：
 * 1. 先检查 pending wake records
 * 2. 按 scheduledAt 排序（最早的先消费）
 * 3. 尝试 claim（原子抢占）
 * 4. claim 成功后调用 consumer 回调
 * 5. 返回消费结果
 *
 * @param workspacePath 工作空间路径
 * @param consumer 消费回调函数
 * @param config 配置
 * @returns 消费结果数组
 */
export async function consumePendingWakes(
  workspacePath: string,
  consumer: (params: {
    wakeRecord: WakeRecord;
    capsule: WakeWorkCapsule | null;
    hint: string | null;
  }) => Promise<void>,
  config?: WakeHeartbeatConfig
): Promise<WakeConsumeResult[]> {
  const maxConsume = config?.maxConsumePerTick ?? DEFAULT_MAX_CONSUME;
  const consumerId = config?.consumerId ?? DEFAULT_CONSUMER;
  const leaseMs = config?.leaseMs ?? DEFAULT_LEASE_MS;
  const now = Date.now();

  // 1. 获取所有 pending/claimed records
  const pendingRecords = getPendingWakeRecords(workspacePath);

  // 2. 只处理 pending 状态且已到点的（scheduledAt <= now）
  // "到点才消费"是核心语义：未来时刻的 wake 不应被提前消费
  const actionableRecords = pendingRecords
    .filter((r) => r.status === "pending" && r.scheduledAt <= now)
    .sort((a, b) => a.scheduledAt - b.scheduledAt);

  if (actionableRecords.length === 0) {
    logger.debug("[WakeHeartbeat] 无到期的 pending wake records", { workspacePath });
    return [];
  }

  const results: WakeConsumeResult[] = [];

  // 3. 遍历消费
  for (const record of actionableRecords.slice(0, maxConsume)) {
    try {
      // 尝试原子 claim
      const claim = claimWakeRecord(workspacePath, record.id, consumerId, leaseMs);
      if (!claim) {
        // claim 失败（已被其他消费者抢走或状态已变）
        logger.debug("[WakeHeartbeat] claim 失败，跳过", {
          wakeId: record.id,
          workspacePath,
        });
        results.push({
          consumed: false,
          wakeRecordId: record.id,
          error: "claim failed",
        });
        continue;
      }

      // claim 成功，调用消费者
      logger.info("[WakeHeartbeat] 消费 wake", {
        wakeId: record.id,
        taskId: record.taskId,
        workspacePath,
      });

      const runtimeTask = await loadRuntimeTaskForWake(workspacePath, record);

      // 获取消费上下文并调用消费者
      const consumeResult = await consumeWakeRecord({
        workspacePath,
        wakeRecordId: record.id,
        runtimeTask,
      });

      // 调用消费者回调
      await consumer({
        wakeRecord: consumeResult.wakeRecord,
        capsule: consumeResult.capsule,
        hint: consumeResult.hint,
      });

      // 消费成功，推到终态
      const { updateWakeRecord } = await import("./wake-store.js");
      const now = Date.now();
      updateWakeRecord(workspacePath, record.id, {
        status: "done",
        completedAt: now,
        claimedAt: undefined,
      });

      // 释放 claim 文件
      releaseWakeClaim(workspacePath, record.id);

      // 消费成功
      results.push({
        consumed: true,
        wakeRecordId: record.id,
      });

      logger.info("[WakeHeartbeat] 消费完成，已推到 done", {
        wakeId: record.id,
        workspacePath,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("[WakeHeartbeat] 消费失败", {
        wakeId: record.id,
        error: errorMsg,
        workspacePath,
      });

      // 消费失败时释放 claim 并复位 record 状态
      try {
        releaseWakeClaim(workspacePath, record.id);
        // 把 record 改回 pending，允许下次重试
        const { updateWakeRecord } = await import("./wake-store.js");
        updateWakeRecord(workspacePath, record.id, {
          status: "pending",
          claimedAt: undefined,
        });
      } catch {}

      results.push({
        consumed: false,
        wakeRecordId: record.id,
        error: errorMsg,
      });
    }
  }

  return results;
}

/**
 * 检查是否有待处理的 wake records（用于判断是否需要触发额外 tick）
 *
 * 注意：只检查"已到点"的 wake（scheduledAt <= now）
 */
export function hasPendingWakes(workspacePath: string): boolean {
  const pending = getPendingWakeRecords(workspacePath);
  const now = Date.now();
  return pending.some((r) => r.status === "pending" && r.scheduledAt <= now);
}

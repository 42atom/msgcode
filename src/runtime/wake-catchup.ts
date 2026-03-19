/**
 * msgcode: Wake Startup Catch-up - 启动恢复逻辑
 *
 * 对齐 spec: docs/plan/pl0210.pss.runtime.wake-record-and-work-capsule-mainline.md
 */

import path from "node:path";
import { logger } from "../logger/index.js";
import type { WakeRecord } from "./wake-types.js";
import { WAKE_ERROR_CODES, WAKE_GC_CONFIG } from "./wake-types.js";
import {
  listWakeRecords,
  getPendingWakeRecords,
  getOverdueWakeRecords,
  gcTerminalWakeRecords,
  updateWakeRecord,
  getWakeRecord,
} from "./wake-store.js";
import { releaseWakeClaim, getStaleClaims } from "./wake-claim.js";
import { noteWakeFailure } from "./wake-failure.js";

// ============================================
// Startup Catch-up 主函数
// ============================================

export interface StartupCatchupResult {
  /** 清理的 stale claims 数量 */
  reclaimedClaims: number;
  /** 识别的 overdue wake records 数量 */
  overdueRecords: number;
  /** 处理的 overdue records 数量 */
  processedRecords: number;
  /** GC 的终态记录数量 */
  gcRecords: number;
  /** 错误列表 */
  errors: Array<{ code: string; message: string }>;
}

/**
 * 执行 startup catch-up
 *
 * 步骤：
 * 1. 清理 stale claims
 * 2. 识别 overdue wake records
 * 3. 按 latePolicy 处理 overdue records
 * 4. GC 终态记录
 */
export async function executeStartupCatchup(workspacePath: string): Promise<StartupCatchupResult> {
  const result: StartupCatchupResult = {
    reclaimedClaims: 0,
    overdueRecords: 0,
    processedRecords: 0,
    gcRecords: 0,
    errors: [],
  };

  logger.info(`[StartupCatchup] 开始`, { workspacePath });

  // 1. 清理 stale claims
  const staleClaims = getStaleClaims(workspacePath);
  for (const claim of staleClaims) {
    try {
      // 删除 claim 文件
      releaseWakeClaim(workspacePath, claim.wakeId);

      // 把对应的 record 从 claimed 改回 pending（允许重新 claim）
      const record = getWakeRecord(workspacePath, claim.wakeId);
      if (record && record.status === "claimed") {
        noteWakeFailure({
          workspacePath,
          recordId: claim.wakeId,
          code: "WAKE_STALE_RECLAIM",
          summary: `stale claim reclaimed from ${claim.owner}`,
          incrementReclaim: true,
        });
      }

      result.reclaimedClaims++;
      logger.info(`[StartupCatchup] 清理 stale claim 并复位 record`, { wakeId: claim.wakeId });
    } catch (error) {
      result.errors.push({
        code: WAKE_ERROR_CODES.WAKE_CLAIM_ERROR,
        message: `清理 stale claim 失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // 2. 识别 overdue wake records
  const overdueRecords = getOverdueWakeRecords(workspacePath);
  result.overdueRecords = overdueRecords.length;
  logger.info(`[StartupCatchup] 识别 overdue records`, { count: overdueRecords.length });

  // 3. 按 latePolicy 处理 overdue records
  for (const record of overdueRecords) {
    try {
      if (record.latePolicy === "skip-if-missed") {
        // 标记为 expired（同时设置 completedAt 以便 GC 正确计算保留期）
        updateWakeRecord(workspacePath, record.id, {
          status: "expired",
          completedAt: Date.now(),
          failedAt: undefined, // 清除 failedAt，保持一致性
        });
        logger.info(`[StartupCatchup] 标记 expired`, { recordId: record.id });
      } else if (record.latePolicy === "run-if-missed") {
        // 保持 pending 状态，等待 heartbeat 消费
        result.processedRecords++;
        logger.info(`[StartupCatchup] 保留 overdue（run-if-missed）`, { recordId: record.id });
      }
    } catch (error) {
      result.errors.push({
        code: WAKE_ERROR_CODES.WAKE_STORE_ERROR,
        message: `处理 overdue record 失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // 4. GC 终态记录
  result.gcRecords = gcTerminalWakeRecords(workspacePath);

  logger.info(`[StartupCatchup] 完成`, {
    workspacePath,
    reclaimedClaims: result.reclaimedClaims,
    overdueRecords: result.overdueRecords,
    processedRecords: result.processedRecords,
    gcRecords: result.gcRecords,
    errors: result.errors.length,
  });

  return result;
}

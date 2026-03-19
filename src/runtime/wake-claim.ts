/**
 * msgcode: Wake Claim - 原子抢占与租约管理
 *
 * 对齐 spec: docs/plan/pl0210.pss.runtime.wake-record-and-work-capsule-mainline.md
 */

import path from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, openSync, writeSync, closeSync } from "node:fs";
import type { WakeClaim } from "./wake-types.js";
import { WAKE_ERROR_CODES, WAKE_GC_CONFIG } from "./wake-types.js";
import { getClaimsDir, getRecordPath, updateWakeRecord } from "./wake-store.js";
import { logger } from "../logger/index.js";

// ============================================
// 常量
// ============================================

const DEFAULT_LEASE_MS = WAKE_GC_CONFIG.defaultLeaseMs;
const DEFAULT_SAFETY_MARGIN_SEC = WAKE_GC_CONFIG.defaultSafetyMarginSec;

/**
 * 原子文件创建（使用 open + O_EXCL）
 * 成功返回 fd，失败返回 null
 */
function tryAtomicCreate(filePath: string): number | null {
  try {
    // O_CREAT | O_EXCL = 创建并排他，如果文件已存在则失败
    const fd = openSync(filePath, "wx");
    return fd;
  } catch (error) {
    // 文件已存在或其他错误
    return null;
  }
}

/**
 * 尝试 claim wake record
 * @returns 成功返回 claim 对象，失败返回 null
 */
export function claimWakeRecord(
  workspacePath: string,
  recordId: string,
  owner: string,
  leaseMs: number = DEFAULT_LEASE_MS,
): WakeClaim | null {
  const recordPath = getRecordPath(workspacePath, recordId);
  const claimDir = getClaimsDir(workspacePath);
  const claimPath = path.join(claimDir, `${recordId}.claim`);

  // 确保目录存在
  if (!existsSync(claimDir)) {
    mkdirSync(claimDir, { recursive: true });
  }

  // 读取 record 检查状态
  if (!existsSync(recordPath)) {
    return null;
  }

  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as any;
    if (record.status !== "pending") {
      return null;
    }
  } catch {
    return null;
  }

  // 检查是否已有 claim
  if (existsSync(claimPath)) {
    try {
      const existingClaim = JSON.parse(readFileSync(claimPath, "utf8")) as WakeClaim;
      const now = Date.now();
      const safetyMargin = existingClaim.safetyMarginSec || DEFAULT_SAFETY_MARGIN_SEC;
      const safetyBoundary = safetyMargin * 1000;

      // 检查 claim 是否过期
      if (now <= existingClaim.leaseUntil + safetyBoundary) {
        // claim 仍然有效，不能抢
        return null;
      }

      // stale claim，删除旧文件后继续执行 reclaim
      try {
        unlinkSync(claimPath);
      } catch {
        // 删除失败，继续尝试（可能是权限问题）
      }
    } catch {
      // claim 文件损坏，视为无效，删除后继续执行
      try {
        unlinkSync(claimPath);
      } catch {}
    }
  }

  // 尝试原子创建 claim 文件
  const fd = tryAtomicCreate(claimPath);
  if (fd === null) {
    // 创建失败，说明被其他进程抢占
    return null;
  }

  const now = Date.now();
  const claim: WakeClaim = {
    wakeId: recordId,
    owner,
    claimedAt: now,
    leaseUntil: now + leaseMs,
    safetyMarginSec: DEFAULT_SAFETY_MARGIN_SEC,
  };

  // 写入 claim 内容并关闭
  try {
    writeSync(fd, JSON.stringify(claim, null, 2));
    closeSync(fd);

    // 更新 record 状态为 claimed（走原子写路径）
    updateWakeRecord(workspacePath, recordId, {
      status: "claimed",
      claimedAt: now,
    });

    logger.info(`[WakeClaim] 成功 claim`, { recordId, workspacePath, owner, leaseMs });
    return claim;
  } catch (error) {
    // 写入失败，清理 claim 文件
    try {
      unlinkSync(claimPath);
    } catch {}
    logger.error(`[WakeClaim] 写入失败`, { recordId, error });
    return null;
  }
}

/**
 * 释放 claim
 */
export function releaseWakeClaim(workspacePath: string, recordId: string): void {
  const claimPath = path.join(getClaimsDir(workspacePath), `${recordId}.claim`);
  if (!existsSync(claimPath)) {
    return;
  }
  try {
    unlinkSync(claimPath);
    logger.info(`[WakeClaim] 释放 claim`, { recordId, workspacePath });
  } catch (error) {
    logger.warn(`[WakeClaim] 释放失败`, { claimPath, error });
  }
}

/**
 * 获取 stale claims（超过租约时间 + 安全边界）
 */
export function getStaleClaims(workspacePath: string): WakeClaim[] {
  const claimDir = getClaimsDir(workspacePath);
  if (!existsSync(claimDir)) {
    return [];
  }
  try {
    const files = require("fs").readdirSync(claimDir);
    const now = Date.now();
    const staleClaims: WakeClaim[] = [];
    for (const file of files) {
      if (!file.endsWith(".claim")) continue;
      try {
        const claim = JSON.parse(readFileSync(path.join(claimDir, file), "utf8")) as WakeClaim;
        const safetyMargin = claim.safetyMarginSec || DEFAULT_SAFETY_MARGIN_SEC;
        const safetyBoundary = safetyMargin * 1000;
        if (now > claim.leaseUntil + safetyBoundary) {
          staleClaims.push(claim);
        }
      } catch {
        // 跳过损坏的文件
      }
    }
    return staleClaims;
  } catch {
    return [];
  }
}

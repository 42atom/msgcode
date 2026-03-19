/**
 * msgcode: Wake Store - 文件持久化与原子操作
 *
 * 对齐 spec: docs/plan/pl0210.pss.runtime.wake-record-and-work-capsule-mainline.md
 */

import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { WakeJob, WakeRecord, WakeClaim } from "./wake-types.js";
import {
  WAKE_ERROR_CODES,
  WAKE_GC_CONFIG,
  getDefaultWakeDir,
  getWakeJobsDir,
  getWakeRecordsDir,
  getWakeClaimsDir,
  isWakeClaim,
  isWakeJob,
  isWakeRecord,
} from "./wake-types.js";

import { logger } from "../logger/index.js";

// ============================================
// 常量
// ============================================

/** 终态记录保留时间（7天） */
const TERMINAL_RECORD_RETENTION_MS = WAKE_GC_CONFIG.defaultRetentionMs;

/** 失败记录保留时间（30天） */
const FAILED_RECORD_RETENTION_MS = WAKE_GC_CONFIG.failedRetentionMs;

// ============================================
// 辅助函数
// ============================================

/**
 * 获取默认 wake 基础路径
 */
export function getDefaultWakeBasePath(workspacePath: string): string {
  return getDefaultWakeDir(workspacePath);
}

/**
 * 获取 jobs 目录
 */
export function getJobsDir(workspacePath: string): string {
  return getWakeJobsDir(workspacePath);
}

/**
 * 获取 records 目录
 */
export function getRecordsDir(workspacePath: string): string {
  return getWakeRecordsDir(workspacePath);
}

/**
 * 获取 claims 目录
 */
export function getClaimsDir(workspacePath: string): string {
  return getWakeClaimsDir(workspacePath);
}

/**
 * 玷取 job 文件路径
 */
export function getJobPath(workspacePath: string, jobId: string): string {
  return path.join(getJobsDir(workspacePath), `${jobId}.json`);
}

/**
 * 获取 record 文件路径
 */
export function getRecordPath(workspacePath: string, recordId: string): string {
  return path.join(getRecordsDir(workspacePath), `${recordId}.json`);
}

/**
 * 获取 claim 文件路径
 */
export function getClaimPath(workspacePath: string, recordId: string): string {
  return path.join(getClaimsDir(workspacePath), `${recordId}.claim`);
}

/**
 * 磁盘读（带错误处理）
 */
function readJsonFile<T>(filePath: string, isValid?: (value: unknown) => value is T): T | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (isValid && !isValid(parsed)) {
      logger.warn(`[WakeStore] 文件合同不合法，忽略`, { filePath });
      return null;
    }
    return parsed as T;
  } catch (error) {
    logger.warn(`[WakeStore] 读取文件失败: ${filePath}`, { error });
    return null;
  }
}

/**
 * 磁盘写（原子操作）
 */
function writeJsonFile<T>(filePath: string, data: T): void {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmpPath, filePath);
  } catch (error) {
    // 清理临时文件
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {}
    throw error;
  }
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

// ============================================
// Wake Job API
// ============================================

/**
 * 创建 Wake Job
 */
export function createWakeJob(
  workspacePath: string,
  job: Omit<WakeJob, "createdAt" | "updatedAt">
): WakeJob {
  const now = Date.now();
  const fullJob: WakeJob = {
    ...job,
    createdAt: now,
    updatedAt: now,
  };

  const jobPath = getJobPath(workspacePath, fullJob.id);
  writeJsonFile(jobPath, fullJob);

  logger.info(`[WakeStore] 创建 Wake Job`, { jobId: fullJob.id, workspacePath });
  return fullJob;
}

/**
 * 获取 Wake Job
 */
export function getWakeJob(workspacePath: string, jobId: string): WakeJob | null {
  return readJsonFile<WakeJob>(getJobPath(workspacePath, jobId), isWakeJob);
}

/**
 * 更新 Wake Job
 */
export function updateWakeJob(
  workspacePath: string,
  jobId: string,
  updates: Partial<WakeJob>
): WakeJob | null {
  const job = getWakeJob(workspacePath, jobId);
  if (!job) {
    return null;
  }

  const updated: WakeJob = {
    ...job,
    ...updates,
    updatedAt: Date.now(),
  };

  writeJsonFile(getJobPath(workspacePath, jobId), updated);
  logger.info(`[WakeStore] 更新 Wake Job`, { jobId, workspacePath });
  return updated;
}

/**
 * 列出所有 Wake Jobs
 */
export function listWakeJobs(workspacePath: string): WakeJob[] {
  const jobsDir = getJobsDir(workspacePath);
  if (!existsSync(jobsDir)) {
    return [];
  }

  try {
    const files = readdirSync(jobsDir);
    const jobs: WakeJob[] = [];
    for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const job = readJsonFile<WakeJob>(path.join(jobsDir, file), isWakeJob);
    if (job) {
      jobs.push(job);
    }
  }
    return jobs;
  } catch (error) {
    logger.warn(`[WakeStore] 列出 jobs 夌败`, { workspacePath, error });
    return [];
  }
}

/**
 * 删除 Wake Job
 */
export function deleteWakeJob(workspacePath: string, jobId: string): boolean {
  const jobPath = getJobPath(workspacePath, jobId);
  if (!existsSync(jobPath)) {
    return false;
  }

  try {
    unlinkSync(jobPath);
    logger.info(`[WakeStore] 删除 Wake Job`, { jobId, workspacePath });
    return true;
  } catch (error) {
    logger.warn(`[WakeStore] 删除 job 失败`, { jobId, workspacePath, error });
    return false;
  }
}

/**
 * 删除 Wake Record
 */
export function deleteWakeRecord(workspacePath: string, recordId: string): boolean {
  const recordPath = getRecordPath(workspacePath, recordId);
  if (!existsSync(recordPath)) {
    return false;
  }

  try {
    unlinkSync(recordPath);
    logger.info(`[WakeStore] 删除 Wake Record`, { recordId, workspacePath });
    return true;
  } catch (error) {
    logger.warn(`[WakeStore] 删除 record 失败`, { recordId, workspacePath, error });
    return false;
  }
}

// ============================================
// Wake Record API
// ============================================

/**
 * 创建 Wake Record
 * @param scheduledAt 可选，默认为 Date.now()。允许传入过去的时刻来模拟"应该已触发"的场景
 */
export function createWakeRecord(
  workspacePath: string,
  record: Omit<WakeRecord, "scheduledAt" | "createdAt" | "updatedAt">,
  scheduledAt?: number
): WakeRecord {
  const now = Date.now();
  const fullRecord: WakeRecord = {
    ...record,
    scheduledAt: scheduledAt ?? now,
    createdAt: now,
    updatedAt: now,
  };

  const recordPath = getRecordPath(workspacePath, fullRecord.id);
  writeJsonFile(recordPath, fullRecord);

  logger.info(`[WakeStore] 创建 Wake Record`, { recordId: fullRecord.id, workspacePath });
  return fullRecord;
}

/**
 * 获取 Wake Record
 */
export function getWakeRecord(workspacePath: string, recordId: string): WakeRecord | null {
  return readJsonFile<WakeRecord>(getRecordPath(workspacePath, recordId), isWakeRecord);
}

/**
 * 更新 Wake Record
 */
export function updateWakeRecord(
  workspacePath: string,
  recordId: string,
  updates: Partial<WakeRecord>
): WakeRecord | null {
  const record = getWakeRecord(workspacePath, recordId);
  if (!record) {
    return null;
  }

  const updated: WakeRecord = {
    ...record,
    ...updates,
    updatedAt: Date.now(),
  };

  writeJsonFile(getRecordPath(workspacePath, recordId), updated);
  logger.info(`[WakeStore] 更新 Wake Record`, { recordId, workspacePath });
  return updated;
}

/**
 * 列出所有 Wake Records
 */
export function listWakeRecords(workspacePath: string): WakeRecord[] {
  const recordsDir = getRecordsDir(workspacePath);
  if (!existsSync(recordsDir)) {
    return [];
  }

  try {
    const files = readdirSync(recordsDir);
    const records: WakeRecord[] = [];
    for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const record = readJsonFile<WakeRecord>(path.join(recordsDir, file), isWakeRecord);
    if (record) {
      records.push(record);
    }
  }
    return records;
  } catch (error) {
    logger.warn(`[WakeStore] 列出 records 挡败`, { workspacePath, error });
    return [];
  }
}

/**
 * 获取 pending/claimed records
 */
export function getPendingWakeRecords(workspacePath: string): WakeRecord[] {
  const allRecords = listWakeRecords(workspacePath);
  return allRecords.filter(
    (r) => r.status === "pending" || r.status === "claimed"
  );
}

/**
 * 获取 overdue records
 */
export function getOverdueWakeRecords(workspacePath: string): WakeRecord[] {
  const pendingRecords = getPendingWakeRecords(workspacePath);
  const now = Date.now();
  return pendingRecords.filter((r) => r.scheduledAt <= now);
}

/**
 * GC 终态记录
 */
export function gcTerminalWakeRecords(workspacePath: string): number {
  const records = listWakeRecords(workspacePath);
  const now = Date.now();
  let deleted = 0;

  for (const record of records) {
    if (record.status === "done" || record.status === "expired") {
      if (now - record.completedAt! > TERMINAL_RECORD_RETENTION_MS) {
        deleteWakeRecord(workspacePath, record.id);
        deleted++;
      }
    } else if (record.status === "failed") {
      if (now - record.failedAt! > FAILED_RECORD_RETENTION_MS) {
        deleteWakeRecord(workspacePath, record.id);
        deleted++;
      }
    }
  }

  if (deleted > 0) {
    logger.info(`[WakeStore] GC 终态记录`, { workspacePath, deleted });
  }

  return deleted;
}

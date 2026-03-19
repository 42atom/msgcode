/**
 * msgcode: Wake Job / Wake Record / Claim 类型定义
 *
 * 对齐 spec: docs/plan/pl0210.pss.runtime.wake-record-and-work-capsule-mainline.md
 *
 * 职责：
 * - 定义 wake job（计划）
 * - 定义 wake record（触发事实）
 * - 定义 claim（原子抢占）
 */

import os from "node:os";
import path from "node:path";

// ============================================
// 路径常量
// ============================================

/**
 * 获取默认 wake 目录路径
 */
export function getDefaultWakeDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "wakeups");
}

/**
 * 获取 wake jobs 目录
 */
export function getWakeJobsDir(workspacePath: string): string {
  return path.join(getDefaultWakeDir(workspacePath), "jobs");
}

/**
 * 获取 wake records 目录
 */
export function getWakeRecordsDir(workspacePath: string): string {
  return path.join(getDefaultWakeDir(workspacePath), "records");
}

/**
 * 获取 wake claims 目录
 */
export function getWakeClaimsDir(workspacePath: string): string {
  return path.join(getDefaultWakeDir(workspacePath), "claims");
}

// ============================================
// Wake Job（计划）
// ============================================

/**
 * Wake Job Kind
 */
export type WakeJobKind = "once" | "recurring";
export const WAKE_JOB_KINDS = ["once", "recurring"] as const;

/**
 * Wake Mode
 */
export type WakeMode = "now" | "next-heartbeat";
export const WAKE_MODES = ["now", "next-heartbeat"] as const;

/**
 * Schedule（时间语义）
 */
export type WakeSchedule =
  | { kind: "at"; atMs: number }
  | { kind: "every"; everyMs: number; anchorMs: number }
  | { kind: "cron"; expr: string; tz?: string };

/**
 * Wake Job（计划）
 *
 * 文件路径：<workspace>/.msgcode/wakeups/jobs/<jobId>.json
 */
export interface WakeJob {
  /** Job ID（UUID） */
  id: string;

  /** Job 类型 */
  kind: WakeJobKind;

  /** 时间计划 */
  schedule: WakeSchedule;

  /** 唤醒模式 */
  mode: WakeMode;

  /** 绑定的任务 ID（可选，轻路径可为空） */
  taskId?: string;

  /** 是否启用 */
  enabled: boolean;

  /** 提示文本（可选） */
  hint?: string;

  /** 迟到策略 */
  latePolicy?: LatePolicy;

  /** 创建时间（毫秒） */
  createdAt: number;

  /** 更新时间（毫秒） */
  updatedAt: number;
}

// ============================================
// Wake Record（触发事实）
// ============================================

/**
 * Wake Record Status
 */
export type WakeRecordStatus =
  | "pending"   // 已到点，待消费
  | "claimed"   // 已被抢占，正在执行
  | "done"      // 已完成
  | "failed"    // 执行失败
  | "expired";  // 过期未执行
export const WAKE_RECORD_STATUSES = ["pending", "claimed", "done", "failed", "expired"] as const;

/**
 * Late Policy
 */
export type LatePolicy =
  | "run-if-missed"  // 错过也执行
  | "skip-if-missed"; // 错过就跳过
export const LATE_POLICIES = ["run-if-missed", "skip-if-missed"] as const;

/**
 * Request Path
 */
export type RequestPath = "run" | "task";
export const REQUEST_PATHS = ["run", "task"] as const;

/**
 * Wake Record（触发事实）
 *
 * 文件路径：<workspace>/.msgcode/wakeups/records/<recordId>.json
 */
export interface WakeRecord {
  /** Record ID（UUID） */
  id: string;

  /** 关联的 Job ID（可选，手动触发可为空） */
  jobId?: string;

  /** 状态 */
  status: WakeRecordStatus;

  /** 请求路径 */
  path: RequestPath;

  /** 绑定的任务 ID（可选） */
  taskId?: string;

  /** 提示文本 */
  hint?: string;

  /** 计划唤醒时间（毫秒） */
  scheduledAt: number;

  /** 抢占时间（毫秒，null 表示未抢占） */
  claimedAt?: number;

  /** 完成时间（毫秒，null 表示未完成） */
  completedAt?: number;

  /** 失败时间（毫秒，null 表示未失败） */
  failedAt?: number;

  /** 错误消息（可选） */
  errorMessage?: string;

  /** stale reclaim / 保守重试计数 */
  reclaimCount?: number;

  /** 最近一次失败代码 */
  lastFailureCode?: string;

  /** 最近一次失败时间（毫秒） */
  lastFailureAt?: number;

  /** 最近一次失败摘要 */
  lastFailureSummary?: string;

  /** 迟到策略 */
  latePolicy: LatePolicy;

  /** 创建时间（毫秒） */
  createdAt: number;

  /** 更新时间（毫秒） */
  updatedAt: number;
}

// ============================================
// Wake Claim（原子抢占）
// ============================================

/**
 * Wake Claim（原子抢占）
 *
 * 文件路径：<workspace>/.msgcode/wakeups/claims/<wakeId>.json
 */
export interface WakeClaim {
  /** Wake Record ID */
  wakeId: string;

  /** 抢占者标识 */
  owner: string;

  /** 抢占时间（毫秒） */
  claimedAt: number;

  /** 租约到期时间（毫秒） */
  leaseUntil: number;

  /** 安全边界（秒） */
  safetyMarginSec: number;
}

// ============================================
// GC 配置
// ============================================

/**
 * 终态 Wake Record 保留窗口
 */
export const WAKE_GC_CONFIG = {
  /** 终态记录默认保留时间（7天） */
  defaultRetentionMs: 7 * 24 * 60 * 60 * 1000,

  /** 失败记录保留时间（30天） */
  failedRetentionMs: 30 * 24 * 60 * 60 * 1000,

  /** 默认租约时长（5分钟） */
  defaultLeaseMs: 5 * 60 * 1000,

  /** 默认安全边界（10秒） */
  defaultSafetyMarginSec: 10,

  /** poison wake 升级阈值 */
  poisonThreshold: 3,
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWakeSchedule(value: unknown): value is WakeSchedule {
  if (!isObject(value) || typeof value.kind !== "string") return false;

  if (value.kind === "at") {
    return typeof value.atMs === "number";
  }

  if (value.kind === "every") {
    return typeof value.everyMs === "number" && typeof value.anchorMs === "number";
  }

  if (value.kind === "cron") {
    return typeof value.expr === "string" && (value.tz === undefined || typeof value.tz === "string");
  }

  return false;
}

export function isWakeJobKind(value: unknown): value is WakeJobKind {
  return typeof value === "string" && (WAKE_JOB_KINDS as readonly string[]).includes(value);
}

export function isWakeMode(value: unknown): value is WakeMode {
  return typeof value === "string" && (WAKE_MODES as readonly string[]).includes(value);
}

export function isWakeRecordStatus(value: unknown): value is WakeRecordStatus {
  return typeof value === "string" && (WAKE_RECORD_STATUSES as readonly string[]).includes(value);
}

export function isLatePolicy(value: unknown): value is LatePolicy {
  return typeof value === "string" && (LATE_POLICIES as readonly string[]).includes(value);
}

export function isRequestPath(value: unknown): value is RequestPath {
  return typeof value === "string" && (REQUEST_PATHS as readonly string[]).includes(value);
}

export function isWakeJob(value: unknown): value is WakeJob {
  if (!isObject(value)) return false;

  return (
    typeof value.id === "string" &&
    isWakeJobKind(value.kind) &&
    isWakeSchedule(value.schedule) &&
    isWakeMode(value.mode) &&
    (value.taskId === undefined || typeof value.taskId === "string") &&
    typeof value.enabled === "boolean" &&
    (value.hint === undefined || typeof value.hint === "string") &&
    (value.latePolicy === undefined || isLatePolicy(value.latePolicy)) &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

export function isWakeRecord(value: unknown): value is WakeRecord {
  if (!isObject(value)) return false;

  return (
    typeof value.id === "string" &&
    (value.jobId === undefined || typeof value.jobId === "string") &&
    isWakeRecordStatus(value.status) &&
    isRequestPath(value.path) &&
    (value.taskId === undefined || typeof value.taskId === "string") &&
    (value.hint === undefined || typeof value.hint === "string") &&
    typeof value.scheduledAt === "number" &&
    (value.claimedAt === undefined || typeof value.claimedAt === "number") &&
    (value.completedAt === undefined || typeof value.completedAt === "number") &&
    (value.failedAt === undefined || typeof value.failedAt === "number") &&
    (value.errorMessage === undefined || typeof value.errorMessage === "string") &&
    (value.reclaimCount === undefined || typeof value.reclaimCount === "number") &&
    (value.lastFailureCode === undefined || typeof value.lastFailureCode === "string") &&
    (value.lastFailureAt === undefined || typeof value.lastFailureAt === "number") &&
    (value.lastFailureSummary === undefined || typeof value.lastFailureSummary === "string") &&
    isLatePolicy(value.latePolicy) &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

export function isWakeClaim(value: unknown): value is WakeClaim {
  if (!isObject(value)) return false;

  return (
    typeof value.wakeId === "string" &&
    typeof value.owner === "string" &&
    typeof value.claimedAt === "number" &&
    typeof value.leaseUntil === "number" &&
    typeof value.safetyMarginSec === "number"
  );
}

// ============================================
// 错误码
// ============================================

export const WAKE_ERROR_CODES = {
  WAKE_NOT_FOUND: "WAKE_NOT_FOUND",
  WAKE_ALREADY_CLAIMED: "WAKE_ALREADY_CLAIMED",
  WAKE_CLAIM_EXPIRED: "WAKE_CLAIM_EXPIRED",
  WAKE_INVALID_STATUS: "WAKE_INVALID_STATUS",
  WAKE_STORE_ERROR: "WAKE_STORE_ERROR",
  WAKE_CLAIM_ERROR: "WAKE_CLAIM_ERROR",
} as const;

export type WakeErrorCode = typeof WAKE_ERROR_CODES[keyof typeof WAKE_ERROR_CODES];

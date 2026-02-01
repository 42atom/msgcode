/**
 * msgcode: Jobs 模块类型定义（v2.1）
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/job_spec_v2.1.md
 * CLI Contract: AIDOCS/msgcode-2.1/cli_contract_v2.1.md
 */

import os from "node:os";
import path from "node:path";
import type { Envelope, Diagnostic } from "../memory/types.js";

// ============================================
// Job Store 路径
// ============================================

/**
 * 获取默认 jobs.json 路径
 */
export function getDefaultJobsPath(): string {
  return path.join(os.homedir(), ".config/msgcode/cron/jobs.json");
}

/**
 * 获取默认 runs.jsonl 路径
 */
export function getDefaultRunsPath(): string {
  return path.join(os.homedir(), ".config/msgcode/cron/runs.jsonl");
}

// ============================================
// 数据模型（v1）
// ============================================

/**
 * CronStoreFile（jobs.json 根结构）
 */
export interface CronStoreFile {
  /** Schema 版本 */
  version: 1;
  /** Job 列表 */
  jobs: CronJob[];
}

/**
 * CronJob（job_spec_v2.1.md）
 */
export interface CronJob {
  /** Job ID（UUID） */
  id: string;
  /** 是否启用 */
  enabled: boolean;
  /** Job 名称（1~64 字符） */
  name: string;
  /** 可选描述 */
  description?: string;

  /** 路由：对齐 RouteStore 的 chatGuid（单一真相源） */
  route: {
    chatGuid: string;
  };

  /** 何时运行（schedule） */
  schedule: Schedule;

  /** 在哪运行（会话目标） */
  sessionTarget: SessionTarget;

  /** 做什么：2.1 仅允许 tmuxMessage */
  payload: Payload;

  /** 回发策略（iMessage only） */
  delivery: Delivery;

  /** 运行状态（可诊断、可恢复） */
  state: JobState;

  /** 创建时间（毫秒） */
  createdAtMs: number;
  /** 更新时间（毫秒） */
  updatedAtMs: number;
}

/**
 * Schedule（时间语义）
 */
export type Schedule =
  | { kind: "at"; atMs: number }
  | { kind: "every"; everyMs: number; anchorMs: number }
  | { kind: "cron"; expr: string; tz?: string };

/**
 * SessionTarget（会话目标）
 */
export type SessionTarget = "main" | "isolated";

/**
 * Payload（做什么）
 */
export type Payload = { kind: "tmuxMessage"; text: string };

/**
 * Delivery（回发策略）
 */
export interface Delivery {
  mode: "reply-to-same-chat" | "none";
  bestEffort: boolean;
  maxChars: number;
}

/**
 * JobState（运行状态）
 */
export interface JobState {
  /** 路由状态 */
  routeStatus: RouteStatus;
  /** 下次运行时间（毫秒） */
  nextRunAtMs: number | null;
  /** 当前运行开始时间（毫秒，null 表示未在运行） */
  runningAtMs: number | null;
  /** 最后运行时间（毫秒） */
  lastRunAtMs: number | null;
  /** 最后运行状态（允许 stuck） */
  lastStatus: LastStatus | "stuck";
  /** 最后错误码（稳定枚举或运行时错误） */
  lastErrorCode: JobErrorCode | RuntimeJobErrorCode | null;
  /** 最后错误（人类文本） */
  lastError: string | null;
  /** 最后运行耗时（毫秒） */
  lastDurationMs: number | null;
}

/**
 * RouteStatus（路由状态）
 */
export type RouteStatus = "valid" | "invalid" | "orphaned";

/**
 * LastStatus（最后运行状态）- 统一状态机（8.0）
 * 用于：job.state.lastStatus 和 runs.jsonl.status
 */
export type JobStatus =
  | "pending"   // 创建后尚未运行
  | "running"   // 正在执行（scheduler 临时标记，不会持久化到 lastStatus）
  | "ok"        // 成功完成
  | "error"     // 执行失败
  | "stuck"     // 卡死被清理
  | "skipped";  // 符合"不可运行条件"而跳过

// 向后兼容：LastStatus 是 JobStatus 的子集（不包含 running）
export type LastStatus = Exclude<JobStatus, "running">;

// ============================================
// Run Log（runs.jsonl）
// ============================================

/**
 * JobRun（runs.jsonl 每行格式）
 */
export interface JobRun {
  /** ISO 8601 时间戳 */
  ts: string;
  /** Job ID */
  jobId: string;
  /** 聊天 GUID */
  chatGuid: string;
  /** 会话目标 */
  sessionTarget: SessionTarget;
  /** 运行状态（允许完整的 JobStatus） */
  status: JobStatus;
  /** 运行耗时（毫秒） */
  durationMs: number;
  /** 错误码（稳定枚举，来自 JOBS_ERROR_CODES） */
  errorCode: JobsErrorCode | null;
  /** 错误消息（简短人类可读文本） */
  errorMessage: string | null;
  /** 额外详情（可选，不含敏感数据） */
  details?: Record<string, unknown>;
  /** 文本摘要（sha256，可选） */
  textDigest?: string;
}

// ============================================
// Jobs CLI 输出格式
// ============================================

/**
 * Job List 输出（data 字段）
 */
export interface JobListData {
  jobs: CronJob[];
  total: number;
  enabled: number;
  disabled: number;
}

/**
 * Job Status 输出（data 字段）
 */
export interface JobStatusData {
  job: CronJob | null;
  recentRuns: JobRun[];
}

/**
 * Job Add 输出（data 字段）
 */
export interface JobAddData {
  job: CronJob;
}

// ============================================
// Jobs 错误码（对齐 cli_contract_v2.1.md 4.9）
// ============================================

/**
 * Jobs 错误码
 */
export const JOBS_ERROR_CODES = {
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  JOB_INVALID_SCHEDULE: "JOB_INVALID_SCHEDULE",
  JOB_ROUTE_ORPHANED: "JOB_ROUTE_ORPHANED",
  JOB_STUCK: "JOB_STUCK",
  // 运行时错误（CLI 用）
  JOB_SAVE_FAILED: "JOB_SAVE_FAILED",
  JOB_LOAD_FAILED: "JOB_LOAD_FAILED",
  JOB_UPDATE_FAILED: "JOB_UPDATE_FAILED",
  JOB_DELETE_FAILED: "JOB_DELETE_FAILED",
  JOB_ALREADY_RUNNING: "JOB_ALREADY_RUNNING",
  JOB_EXECUTION_FAILED: "JOB_EXECUTION_FAILED",
} as const;

/**
 * Jobs 错误码类型
 */
export type JobsErrorCode = typeof JOBS_ERROR_CODES[keyof typeof JOBS_ERROR_CODES];

/**
 * 创建 Jobs 错误的 Diagnostic
 */
export function createJobsDiagnostic(
  code: JobsErrorCode,
  message: string,
  hint?: string,
  details?: Record<string, unknown>
): Diagnostic {
  return { code, message, hint, details };
}

// ============================================
// 运行时错误码（job_spec_v2.1.md 运行态）
// ============================================

/**
 * 运行时错误码（用于 lastErrorCode）
 */
export type JobErrorCode =
  | "ROUTE_NOT_FOUND"
  | "ROUTE_INACTIVE"
  | "SCHEDULE_INVALID"
  | "PAYLOAD_EMPTY"
  | "TMUX_MISSING"
  | "TMUX_SESSION_START_FAILED"
  | "TMUX_SESSION_DEAD"
  | "IMSG_SEND_FAILED"
  | "DELIVERY_TRUNCATED"
  | "JOB_STUCK_CLEARED"
  | "JOB_ABORTED_BY_RESTART";

/**
 * 额外的运行时错误码（scheduler 内部用）
 */
export type RuntimeJobErrorCode =
  | "JOB_EXECUTION_FAILED"
  | "JOB_SCHEDULE_FAILED";

// ============================================
// Scheduler 配置常量
// ============================================

/**
 * 默认 stuck 超时阈值（2 小时）
 *
 * 当 job 的 runningAtMs 超过此阈值时，scheduler 会在启动时将其标记为 stuck 并清理。
 */
export const DEFAULT_STUCK_TIMEOUT_MS = 2 * 60 * 60 * 1000;

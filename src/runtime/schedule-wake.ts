/**
 * msgcode: Schedule to Wake integration
 *
 * 对齐 spec: docs/protocol/SCHEDULE.md
 *
 * 职责：
 * - 读取 schedules/*.json
 * - 映射到 wakeups/jobs/*.json
 * - 从 wake job 生成 wake record（幂等）
 * - deterministic id 生成
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { logger } from "../logger/index.js";
import { getJobsDir, getRecordsDir, getJobPath, getRecordPath, listWakeJobs, createWakeJob, getWakeJob, updateWakeJob, listWakeRecords, createWakeRecord, updateWakeRecord } from "./wake-store.js";
import type { WakeJob, WakeRecord, WakeMode, LatePolicy, RequestPath, WakeSchedule } from "./wake-types.js";

// ============================================
// 可选注入：triggerNow 钩子
// ============================================

/**
 * triggerNow 钩子接口
 *
 * 当 wake.mode = "now" 时，record 创建后会尝试调用此钩子
 * 如果钩子不存在或调用失败，静默降级到 next-heartbeat
 */
export interface TriggerNowHook {
  (params: { workspacePath: string; record: WakeRecord }): Promise<boolean>;
}

/**
 * 全局 triggerNow 钩子配置
 *
 * 由调用方注入（如 scheduler runner）
 */
let globalTriggerNowHook: TriggerNowHook | null = null;

/**
 * 设置 triggerNow 钩子
 */
export function setTriggerNowHook(hook: TriggerNowHook | null): void {
  globalTriggerNowHook = hook;
  logger.info(`[Schedule] triggerNow 钩子已设置`, { available: !!hook });
}

/**
 * 尝试调用 triggerNow
 *
 * 失败时静默降级，不抛出错误
 */
async function tryTriggerNow(params: { workspacePath: string; record: WakeRecord }): Promise<void> {
  if (!globalTriggerNowHook) {
    logger.debug(`[Schedule] triggerNow 钩子未配置，跳过即时投递`);
    return;
  }

  try {
    const success = await globalTriggerNowHook(params);
    if (success) {
      logger.info(`[Schedule] triggerNow 投递成功`, { recordId: params.record.id });
    } else {
      logger.info(`[Schedule] triggerNow 投递失败（返回 false），降级到 next-heartbeat`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`[Schedule] triggerNow 投递异常，降级到 next-heartbeat`, { error: errorMsg });
  }
}

// ============================================
// Schedule 类型（对齐 SCHEDULE.md 协议）
// ============================================

/**
 * Schedule 时间语义
 */
export type ScheduleTime =
  | { kind: "at"; atMs: number }
  | { kind: "every"; everyMs: number; anchorMs: number }
  | { kind: "cron"; expr: string; tz?: string };

/**
 * Schedule Wake 配置
 */
export interface ScheduleWakeConfig {
  mode: WakeMode;
  taskId?: string;
  hint?: string;
  latePolicy: LatePolicy;
}

/**
 * Schedule 文件（v2，对齐 SCHEDULE.md 协议）
 */
export interface ScheduleFile {
  version: 2;
  enabled: boolean;
  schedule: ScheduleTime;
  wake: ScheduleWakeConfig;
  createdAt: number;
  updatedAt: number;
}

/**
 * Schedule 信息
 */
export interface ScheduleInfo extends ScheduleFile {
  id: string;
  workspacePath: string;
}

// ============================================
// 路径工具
// ============================================

/**
 * 获取 schedules 目录
 */
export function getSchedulesDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "schedules");
}

/**
 * 获取 schedule 文件路径
 */
export function getSchedulePath(workspacePath: string, scheduleId: string): string {
  return path.join(getSchedulesDir(workspacePath), `${scheduleId}.json`);
}

// ============================================
// Schedule 读取
// ============================================

/**
 * 读取单个 schedule
 */
export function getSchedule(workspacePath: string, scheduleId: string): ScheduleInfo | null {
  const schedulePath = getSchedulePath(workspacePath, scheduleId);
  try {
    if (!existsSync(schedulePath)) {
      return null;
    }
    const content = readFileSync(schedulePath, "utf-8");
    const schedule = JSON.parse(content) as ScheduleFile;

    // 只支持 v2
    if (schedule.version !== 2) {
      logger.warn(`[Schedule] 不支持的 schedule 版本: ${schedule.version}`, { scheduleId });
      return null;
    }

    return {
      ...schedule,
      id: scheduleId,
      workspacePath,
    };
  } catch (error) {
    logger.warn(`[Schedule] 读取 schedule 失败`, { scheduleId, error });
    return null;
  }
}

/**
 * 列出所有 schedules
 */
export function listSchedules(workspacePath: string): ScheduleInfo[] {
  const schedulesDir = getSchedulesDir(workspacePath);
  if (!existsSync(schedulesDir)) {
    return [];
  }

  try {
    const files = readdirSync(schedulesDir);
    const schedules: ScheduleInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const scheduleId = file.slice(0, -5);
      const schedule = getSchedule(workspacePath, scheduleId);
      if (schedule) {
        schedules.push(schedule);
      }
    }

    return schedules;
  } catch (error) {
    logger.warn(`[Schedule] 列出 schedules 失败`, { workspacePath, error });
    return [];
  }
}

// ============================================
// Deterministic ID 生成
// ============================================

/**
 * 生成 deterministic wake job ID
 *
 * 规则：同一 workspace + scheduleId 只能有一个 job
 */
export function generateWakeJobId(workspacePath: string, scheduleId: string): string {
  const input = `${workspacePath}:${scheduleId}`;
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 16);
  return `schedule:${hash}`;
}

/**
 * 生成 deterministic wake record ID
 *
 * 规则：同一 workspace + scheduleId + scheduledAt 必须得到同一个 record ID
 */
export function generateWakeRecordId(workspacePath: string, scheduleId: string, scheduledAt: number): string {
  const input = `${workspacePath}:${scheduleId}:${scheduledAt}`;
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 16);
  return `record:${hash}`;
}

// ============================================
// Schedule -> Wake Job 映射
// ============================================

/**
 * 从 schedule 创建/更新 wake job
 *
 * 幂等：同一 schedule 只创建一个 job
 */
export function syncScheduleToWakeJob(workspacePath: string, schedule: ScheduleInfo): WakeJob | null {
  if (!schedule.enabled) {
    // 如果 schedule 被禁用，检查是否需要删除已有的 job
    const jobId = generateWakeJobId(workspacePath, schedule.id);
    const existingJob = getWakeJob(workspacePath, jobId);
    if (existingJob) {
      // 不删除，只标记 disabled（保留历史真相）
      updateWakeJob(workspacePath, jobId, { enabled: false });
      logger.info(`[Schedule] Schedule 已禁用，更新 job 为 disabled`, { scheduleId: schedule.id, jobId });
    }
    return null;
  }

  const jobId = generateWakeJobId(workspacePath, schedule.id);
  const now = Date.now();

  // 计算下次触发时间
  const scheduledAt = computeScheduleNextTrigger(schedule.schedule, now);

  const job: Omit<WakeJob, "createdAt" | "updatedAt"> = {
    id: jobId,
    kind: schedule.schedule.kind === "at" ? "once" : "recurring",
    schedule: schedule.schedule as unknown as WakeSchedule,
    mode: schedule.wake.mode,
    taskId: schedule.wake.taskId,
    hint: schedule.wake.hint,
    latePolicy: schedule.wake.latePolicy,
    enabled: true,
  };

  // 检查是否已存在
  const existingJob = getWakeJob(workspacePath, jobId);
  if (existingJob) {
    // 更新（幂等：不重复创建）
    updateWakeJob(workspacePath, jobId, {
      ...job,
      enabled: true,
    });
    logger.info(`[Schedule] 更新 Wake Job`, { scheduleId: schedule.id, jobId });
    return getWakeJob(workspacePath, jobId);
  }

  // 创建新 job
  const newJob = createWakeJob(workspacePath, job);
  logger.info(`[Schedule] 创建 Wake Job`, { scheduleId: schedule.id, jobId, scheduledAt });
  return newJob;
}

/**
 * 计算 schedule 下次触发时间
 */
function computeScheduleNextTrigger(schedule: ScheduleTime, now: number): number {
  switch (schedule.kind) {
    case "at":
      // 一次性：直接返回 atMs
      return schedule.atMs;
    case "every":
      // 周期性：从 anchor 开始，按 everyMs 计算下一次
      const anchor = schedule.anchorMs || now;
      if (now <= anchor) {
        return anchor;
      }
      const elapsed = now - anchor;
      const cycles = Math.floor(elapsed / schedule.everyMs);
      return anchor + (cycles + 1) * schedule.everyMs;
    case "cron":
      // Cron 需要外部库计算，这里简化处理
      // 实际应该用 cron-parser 或类似库
      return now + 60 * 1000; // 默认 1 分钟后
    default:
      return now;
  }
}

/**
 * 同步所有 schedules 到 wake jobs
 *
 * 包括 orphan reconciliation：删除 schedule 后禁用关联的 wake job
 */
export function syncAllSchedules(workspacePath: string): number {
  const schedules = listSchedules(workspacePath);
  const scheduleMap = new Map(schedules.map(s => [s.id, s]));
  let synced = 0;

  // 1. 同步存在的 schedules
  for (const schedule of schedules) {
    const result = syncScheduleToWakeJob(workspacePath, schedule);
    if (result) synced++;
  }

  // 2. Orphan reconciliation：禁用已删除 schedule 的 wake job
  const jobs = listWakeJobs(workspacePath);
  for (const job of jobs) {
    // 只有 schedule: 前缀的 job 才需要 reconciliation
    if (!job.id.startsWith("schedule:")) continue;

    // 从 job ID 反推 schedule ID（取 hash 后缀）
    // jobId 格式：schedule:<hash>
    const jobHash = job.id.replace("schedule:", "");

    // 遍历所有 schedule，找匹配
    let found = false;
    for (const schedule of schedules) {
      const expectedHash = generateWakeJobId(workspacePath, schedule.id).replace("schedule:", "");
      if (jobHash === expectedHash) {
        found = true;
        break;
      }
    }

    // 如果没找到对应 schedule，禁用该 job
    if (!found && job.enabled) {
      updateWakeJob(workspacePath, job.id, { enabled: false });
      logger.info(`[Schedule] Schedule 已删除，禁用关联 wake job`, { jobId: job.id });
    }
  }

  logger.info(`[Schedule] 同步完成`, { workspacePath, total: schedules.length, synced });
  return synced;
}

// ============================================
// Wake Job -> Wake Record 幂等生成
// ============================================

/**
 * 从 wake job 幂等创建 wake record
 *
 * 规则：
 * - 同一 job + 同一 scheduledAt 只能生成一个 record
 * - 如果 record 已存在（任意状态），跳过不创建
 */
export function triggerWakeJob(workspacePath: string, jobId: string, scheduledAt?: number): WakeRecord | null {
  const job = getWakeJob(workspacePath, jobId);
  if (!job) {
    logger.warn(`[Schedule] Wake Job 不存在`, { jobId });
    return null;
  }

  if (!job.enabled) {
    logger.info(`[Schedule] Wake Job 已禁用，跳过触发`, { jobId });
    return null;
  }

  const triggerTime = scheduledAt ?? Date.now();

  // 生成 deterministic record ID
  const recordId = generateWakeRecordId(workspacePath, jobId, triggerTime);

  // 幂等检查：record 是否已存在
  const existingRecord = listWakeRecords(workspacePath).find(r => r.id === recordId);
  if (existingRecord) {
    logger.debug(`[Schedule] Wake Record 已存在，跳过创建`, { jobId, recordId, status: existingRecord.status });
    return existingRecord;
  }

  // 幂等检查：是否有其他 pending/claimed record 由同一 job 创建且时间相同
  const duplicateCheck = listWakeRecords(workspacePath).find(
    r => r.jobId === jobId && r.scheduledAt === triggerTime && (r.status === "pending" || r.status === "claimed")
  );
  if (duplicateCheck) {
    logger.debug(`[Schedule] 已有 pending/claimed record，跳过创建`, { jobId, scheduledAt: triggerTime });
    return duplicateCheck;
  }

  // 创建 record
  const record: Omit<WakeRecord, "scheduledAt" | "createdAt" | "updatedAt"> = {
    id: recordId,
    jobId,
    status: "pending",
    path: job.taskId ? "task" : "run",
    taskId: job.taskId,
    hint: job.hint,
    latePolicy: job.latePolicy || "run-if-missed", // 从 job 读取
  };

  // 使用 wake-store 的 createWakeRecord
  // 使用已导入的 createWakeRecord
  const newRecord = createWakeRecord(workspacePath, record, triggerTime);

  logger.info(`[Schedule] 创建 Wake Record`, { jobId, recordId, scheduledAt: triggerTime });

  // once/at job 触发后退场（禁用），避免重复触发
  if (job.kind === "once") {
    updateWakeJob(workspacePath, jobId, { enabled: false });
    logger.info(`[Schedule] Once job 触发后禁用`, { jobId });
  }

  // mode = now 时尝试即时投递
  if (job.mode === "now") {
    tryTriggerNow({ workspacePath, record: newRecord });
  }

  return newRecord;
}

/**
 * 扫描所有 wake jobs，触发已到期的 jobs
 *
 * @returns 触发的 record 数量
 */
export function triggerDueWakeJobs(workspacePath: string): number {
  const jobs = listWakeJobs(workspacePath);
  const now = Date.now();
  let triggered = 0;

  for (const job of jobs) {
    if (!job.enabled) continue;

    // 计算 job 下次触发时间
    const nextTrigger = computeJobNextTrigger(job);
    if (nextTrigger <= now) {
      const result = triggerWakeJob(workspacePath, job.id, nextTrigger);
      if (result) triggered++;
    }
  }

  if (triggered > 0) {
    logger.info(`[Schedule] 触发到期 jobs`, { workspacePath, triggered });
  }

  return triggered;
}

/**
 * 计算 wake job 下次触发时间
 */
function computeJobNextTrigger(job: WakeJob): number {
  const now = Date.now();

  // 从 job.schedule 提取触发时间
  const schedule = job.schedule as ScheduleTime;
  if (!schedule) {
    return now;
  }

  switch (schedule.kind) {
    case "at":
      return schedule.atMs;
    case "every": {
      const anchor = schedule.anchorMs || now;
      if (now < anchor) return anchor; // 还没到第一个触发点

      const elapsed = now - anchor;
      const cycles = Math.floor(elapsed / schedule.everyMs);

      // 返回最近一个应该触发的时间（可能已经过了，由 triggerDueWakeJobs 判断是否已存在）
      return anchor + cycles * schedule.everyMs;
    }
    case "cron":
      // 简单 cron 解析
      return parseCronNextTrigger(schedule.expr, now, schedule.tz);
    default:
      return now;
  }
}

// ============================================
// Startup Catch-Up
// ============================================

/**
 * Startup 时补扫过期的 wake records
 *
 * 对齐 SCHEDULE.md 的 catch-up 规则
 */
export function catchUpMissedWakes(workspacePath: string): number {
  const records = listWakeRecords(workspacePath);
  const now = Date.now();
  let caught = 0;

  for (const record of records) {
    // 只处理 pending 且已过期的
    if (record.status !== "pending") continue;
    if (record.scheduledAt > now) continue; // 未到期

    if (record.latePolicy === "run-if-missed") {
      // 仍然 pending，等待消费（不做额外处理）
      logger.debug(`[Schedule] 待消费 missed wake`, { recordId: record.id, scheduledAt: record.scheduledAt });
    } else if (record.latePolicy === "skip-if-missed") {
      // 标记为 expired
      // 使用已导入的 updateWakeRecord
      updateWakeRecord(workspacePath, record.id, {
        status: "expired",
        completedAt: now,
      });
      caught++;
      logger.info(`[Schedule] 标记过期`, { recordId: record.id });
    }
  }

  return caught;
}

// ============================================
// 目录初始化
// ============================================

/**
 * 确保 schedule 目录存在
 */
export function ensureScheduleDir(workspacePath: string): void {
  const dir = getSchedulesDir(workspacePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================
// Cron 解析（轻量实现）
// ============================================

type CronDateParts = {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
};

const zonedDateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedDateTimeFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    zonedDateTimeFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function floorToMinute(timestamp: number): number {
  return Math.floor(timestamp / 60_000) * 60_000;
}

function getLocalCronDateParts(timestamp: number): CronDateParts {
  const date = new Date(timestamp);
  return {
    minute: date.getMinutes(),
    hour: date.getHours(),
    dayOfMonth: date.getDate(),
    month: date.getMonth() + 1,
    dayOfWeek: date.getDay(),
  };
}

function getZonedCronDateParts(timestamp: number, timeZone: string): CronDateParts {
  const formatter = getZonedDateTimeFormatter(timeZone);
  const parts = formatter.formatToParts(new Date(timestamp));
  const raw = new Map(parts.map((part) => [part.type, part.value]));

  const year = Number(raw.get("year"));
  const month = Number(raw.get("month"));
  const day = Number(raw.get("day"));
  const hour = Number(raw.get("hour"));
  const minute = Number(raw.get("minute"));

  return {
    minute,
    hour,
    dayOfMonth: day,
    month,
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/**
 * 简单 Cron 解析
 *
 * 支持：minute hour day-of-month month day-of-week
 * 支持：* 逗号列表 单值 范围 步长
 * tz 使用 IANA 时区并实际参与计算
 */
function parseCronNextTrigger(expr: string, now: number, tz?: string): number {

  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    logger.warn(`[Schedule] 不支持的 cron 表达式（不是 5 段）`, { expr });
    return now + 60 * 60 * 1000; // 默认 1 小时
  }

  const [minuteExpr, hourExpr, dayOfMonthExpr, monthExpr, dayOfWeekExpr] = parts;
  const start = floorToMinute(now);

  let readDateParts: (timestamp: number) => CronDateParts = getLocalCronDateParts;
  if (tz) {
    try {
      getZonedDateTimeFormatter(tz);
      readDateParts = (timestamp) => getZonedCronDateParts(timestamp, tz);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[Schedule] 非法 cron tz，回退到本地时区解析`, { tz, expr, error: errorMsg });
    }
  }

  // 从当前分钟开始，最多扫描 1 年
  for (let i = 0; i < 525600; i++) {
    const candidate = start + i * 60_000;
    const date = readDateParts(candidate);

    if (!matchesCronField(date.minute, minuteExpr)) continue;
    if (!matchesCronField(date.hour, hourExpr)) continue;
    if (!matchesCronField(date.dayOfMonth, dayOfMonthExpr)) continue;
    if (!matchesCronField(date.month, monthExpr)) continue;
    if (!matchesCronField(date.dayOfWeek, dayOfWeekExpr)) continue;

    return candidate;
  }

  // 如果没找到，返回默认
  return now + 60 * 60 * 1000;
}

/**
 * 判断 cron 字段是否匹配
 */
function matchesCronField(value: number, expr: string): boolean {
  // 简化实现：支持 * 和 逗号分隔列表
  if (expr === "*") return true;

  const segments = expr.split(",").map((item) => item.trim()).filter(Boolean);
  for (const segment of segments) {
    if (matchesCronSegment(value, segment)) {
      return true;
    }
  }

  return false;
}

function matchesCronSegment(value: number, segment: string): boolean {
  if (segment === "*") {
    return true;
  }

  const [base, stepRaw] = segment.split("/");
  const step = stepRaw ? Number(stepRaw) : null;
  if (step !== null && (!Number.isInteger(step) || step <= 0)) {
    return false;
  }

  if (base === "*") {
    return step === null ? true : value % step === 0;
  }

  if (base.includes("-")) {
    const [start, end] = base.split("-").map(Number);
    if (!Number.isInteger(start) || !Number.isInteger(end) || value < start || value > end) {
      return false;
    }
    return step === null ? true : (value - start) % step === 0;
  }

  const exact = Number(base);
  if (!Number.isInteger(exact) || value !== exact) {
    return false;
  }

  return step === null || (value - exact) % step === 0;
}

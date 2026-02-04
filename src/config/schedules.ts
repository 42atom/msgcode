/**
 * msgcode: Schedule 管理（v2.2）
 *
 * 负责：
 * - 读取 <WORKSPACE>/.msgcode/schedules/*.json 文件
 * - 验证 schedule 格式（cron、tz 等）
 * - 将 schedules 映射到 jobs（基于当前 route）
 * - 提供启用/禁用功能
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { CronJob, Schedule, Delivery } from "../jobs/types.js";

// ============================================
// Schema（v1）
// ============================================

/**
 * Schedule 文件（v1）
 */
export interface ScheduleFile {
  /** Schema 版本 */
  version: 1;
  /** 是否启用 */
  enabled: boolean;
  /** 时区（IANA tz database 格式，如 "Asia/Shanghai"） */
  tz: string;
  /** Cron 表达式 */
  cron: string;
  /** 要发送的消息文本 */
  message: string;
  /** 发送配置 */
  delivery: {
    mode: "reply-to-same-chat";
    maxChars: number;
  };
}

/**
 * Schedule 信息（扩展，包含文件名等元信息）
 */
export interface ScheduleInfo extends ScheduleFile {
  /** Schedule ID（文件名，不含 .json 扩展名） */
  id: string;
}

// ============================================
// 路径工具
// ============================================

/**
 * 获取 schedules 目录路径
 */
function getSchedulesDir(projectDir: string): string {
  return join(projectDir, ".msgcode", "schedules");
}

/**
 * 获取 schedule 文件路径
 */
function getSchedulePath(projectDir: string, scheduleId: string): string {
  return join(getSchedulesDir(projectDir), `${scheduleId}.json`);
}

// ============================================
// 读取操作
// ============================================

/**
 * 列出所有 schedules
 *
 * @param projectDir 工作区路径
 * @returns Schedule 列表
 */
export async function listSchedules(projectDir: string): Promise<ScheduleInfo[]> {
  const schedulesDir = getSchedulesDir(projectDir);

  if (!existsSync(schedulesDir)) {
    return [];
  }

  try {
    const entries = await readdir(schedulesDir, { withFileTypes: true });
    const schedules: ScheduleInfo[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const scheduleId = entry.name.slice(0, -5); // 去掉 .json 扩展名
      const schedulePath = join(schedulesDir, entry.name);

      try {
        const content = await readFile(schedulePath, "utf-8");
        const schedule = JSON.parse(content) as ScheduleFile;

        // 验证 version
        if (schedule.version !== 1) {
          continue; // 跳过不支持的版本
        }

        schedules.push({
          ...schedule,
          id: scheduleId,
        });
      } catch {
        // 解析失败，跳过
        continue;
      }
    }

    return schedules.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

/**
 * 获取指定 schedule
 *
 * @param projectDir 工作区路径
 * @param scheduleId Schedule ID
 * @returns Schedule 对象，如果不存在返回 null
 */
export async function getSchedule(
  projectDir: string,
  scheduleId: string
): Promise<ScheduleInfo | null> {
  const schedulePath = getSchedulePath(projectDir, scheduleId);

  if (!existsSync(schedulePath)) {
    return null;
  }

  try {
    const content = await readFile(schedulePath, "utf-8");
    const schedule = JSON.parse(content) as ScheduleFile;

    if (schedule.version !== 1) {
      return null;
    }

    return {
      ...schedule,
      id: scheduleId,
    };
  } catch {
    return null;
  }
}

// ============================================
// 映射到 Job
// ============================================

/**
 * 将 Schedule 映射为 CronJob
 *
 * @param schedule Schedule 信息
 * @param chatGuid 当前群组的 chatGuid（从 route 获取）
 * @param projectDir 工作区路径（用于生成稳定的 jobId）
 * @returns CronJob 对象
 */
export function scheduleToJob(
  schedule: ScheduleInfo,
  chatGuid: string,
  projectDir: string
): CronJob {
  const now = Date.now();

  // 生成稳定的 jobId：schedule:<workspace hash>:<scheduleId>
  // 使用 SHA-256 hex 的前 12 位作为 workspace 标识（稳定、可读、无特殊字符）
  const workspaceHash = createHash("sha256").update(projectDir).digest("hex").slice(0, 12);
  const stableJobId = `schedule:${workspaceHash}:${schedule.id}`;

  const job: CronJob = {
    id: stableJobId,
    enabled: schedule.enabled,
    name: schedule.id,
    description: `Workspace schedule: ${schedule.id}`,
    route: {
      chatGuid,
    },
    schedule: {
      kind: "cron",
      expr: schedule.cron,
      tz: schedule.tz,
    } as Schedule,
    sessionTarget: "main",
    payload: {
      kind: "tmuxMessage",
      text: schedule.message,
    },
    delivery: {
      mode: schedule.delivery.mode,
      bestEffort: true,
      maxChars: schedule.delivery.maxChars,
    } as Delivery,
    state: {
      routeStatus: "valid",
      nextRunAtMs: null, // 由 scheduler 计算
      runningAtMs: null,
      lastRunAtMs: null,
      lastStatus: "pending",
      lastErrorCode: null,
      lastError: null,
      lastDurationMs: null,
    },
    createdAtMs: now,
    updatedAtMs: now,
  };

  return job;
}

/**
 * 将所有启用的 schedules 映射为 jobs
 *
 * @param projectDir 工作区路径
 * @param chatGuid 当前群组的 chatGuid
 * @returns CronJob 列表
 */
export async function mapSchedulesToJobs(
  projectDir: string,
  chatGuid: string
): Promise<CronJob[]> {
  const schedules = await listSchedules(projectDir);
  const jobs: CronJob[] = [];

  for (const schedule of schedules) {
    // 只映射启用的 schedules
    if (!schedule.enabled) {
      continue;
    }

    try {
      const job = scheduleToJob(schedule, chatGuid, projectDir);
      jobs.push(job);
    } catch {
      // 映射失败，跳过
      continue;
    }
  }

  return jobs;
}

// ============================================
// 启用/禁用
// ============================================

/**
 * 设置 schedule 启用状态
 *
 * 注意：这个操作直接修改文件（需要写权限）
 *
 * @param projectDir 工作区路径
 * @param scheduleId Schedule ID
 * @param enabled 是否启用
 * @returns 是否成功
 */
export async function setScheduleEnabled(
  projectDir: string,
  scheduleId: string,
  enabled: boolean
): Promise<boolean> {
  const schedule = await getSchedule(projectDir, scheduleId);
  if (!schedule) {
    return false;
  }

  // 如果状态相同，不需要修改
  if (schedule.enabled === enabled) {
    return true;
  }

  const schedulePath = getSchedulePath(projectDir, scheduleId);

  try {
    const { writeFile } = await import("node:fs/promises");
    const updated: ScheduleFile = {
      ...schedule,
      enabled,
    };
    await writeFile(schedulePath, JSON.stringify(updated, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ============================================
// 验证
// ============================================

/**
 * 验证 schedule 配置
 *
 * @param schedule Schedule 信息
 * @returns 验证结果 { valid: boolean, error?: string }
 */
export function validateSchedule(schedule: ScheduleInfo): { valid: boolean; error?: string } {
  // 验证 version
  if (schedule.version !== 1) {
    return { valid: false, error: `不支持的版本: ${schedule.version}` };
  }

  // 验证 cron 表达式（基本格式检查）
  if (!schedule.cron || schedule.cron.trim().length === 0) {
    return { valid: false, error: "cron 表达式不能为空" };
  }

  // cron 表达式应该是 5 或 6 个部分
  const cronParts = schedule.cron.trim().split(/\s+/);
  if (cronParts.length < 5 || cronParts.length > 6) {
    return { valid: false, error: "cron 表达式格式错误（应为 5 或 6 个部分）" };
  }

  // 验证 message
  if (!schedule.message || schedule.message.trim().length === 0) {
    return { valid: false, error: "message 不能为空" };
  }

  // 验证 maxChars
  if (schedule.delivery.maxChars <= 0) {
    return { valid: false, error: "maxChars 必须大于 0" };
  }

  return { valid: true };
}

/**
 * 验证所有 schedules
 *
 * @param projectDir 工作区路径
 * @returns 验证结果列表
 */
export async function validateAllSchedules(
  projectDir: string
): Promise<Array<{ id: string; valid: boolean; error?: string }>> {
  const schedules = await listSchedules(projectDir);
  const results: Array<{ id: string; valid: boolean; error?: string }> = [];

  for (const schedule of schedules) {
    const validation = validateSchedule(schedule);
    results.push({
      id: schedule.id,
      ...validation,
    });
  }

  return results;
}

/**
 * msgcode: Cron 计算工具
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/job_spec_v2.1.md
 *
 * 职责：
 * - computeNextRunAtMs(job, nowMs)：计算 cron 下次运行时间
 * - 支持 cron 表达式 + 时区
 * - tz 不支持时拒绝并报 JOB_INVALID_SCHEDULE
 */

import { Cron } from "croner";
import type { CronJob } from "./types.js";
import { JOBS_ERROR_CODES } from "./types.js";

// ============================================
// Cron 计算错误
// ============================================

/**
 * Cron 计算错误
 */
export class CronComputeError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "CronComputeError";
  }
}

// ============================================
// Cron 计算核心
// ============================================

/**
 * 计算 job 的下次运行时间（毫秒）
 *
 * @param job CronJob 对象
 * @param nowMs 当前时间（毫秒），默认 Date.now()
 * @returns 下次运行时间（毫秒），如果 schedule 不是 cron 则返回 null
 * @throws CronComputeError 如果 cron 表达式无效或时区无效
 */
export function computeNextRunAtMs(
  job: CronJob,
  nowMs: number = Date.now()
): number | null {
  // 只支持 cron schedule
  if (job.schedule.kind !== "cron") {
    return null;
  }

  const { expr, tz } = job.schedule;

  try {
    // 验证 cron 表达式格式（通过尝试解析）
    const cron = new Cron(expr);

    // 处理时区
    if (tz) {
      // 验证时区是否有效
      try {
        // 使用 Intl.DateTimeFormat 检查时区
        const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz });
        formatter.format(); // 如果时区无效会抛出错误
      } catch {
        throw new CronComputeError(
          "JOB_INVALID_SCHEDULE",
          `无效的时区: ${tz}`
        );
      }

      // 在指定时区下计算 next（创建新的 Cron 实例带 timezone 选项）
      const cronWithTz = new Cron(expr, { timezone: tz });
      const next = cronWithTz.nextRun(new Date(nowMs));
      if (next === null) {
        throw new CronComputeError(
          "JOB_INVALID_SCHEDULE",
          `cron 表达式无有效下次运行时间: ${expr}`
        );
      }
      return next.getTime();
    } else {
      // 无时区时：拒绝并报错（避免静默用本地时区）
      throw new CronComputeError(
        "JOB_INVALID_SCHEDULE",
        "必须指定时区（tz）以避免系统时区变化导致 schedule 漂移"
      );
    }
  } catch (err) {
    if (err instanceof CronComputeError) {
      throw err;
    }

    throw new CronComputeError(
      "JOB_INVALID_SCHEDULE",
      `无效的 cron 表达式: ${expr}${err instanceof Error ? ` (${err.message})` : ""}`
    );
  }
}

/**
 * 批量计算 jobs 的下次运行时间
 *
 * @param jobs CronJob 数组
 * @param nowMs 当前时间（毫秒）
 * @returns Map<jobId, nextRunAtMs>
 */
export function computeNextRunAtMsForJobs(
  jobs: CronJob[],
  nowMs: number = Date.now()
): Map<string, number> {
  const results = new Map<string, number>();

  for (const job of jobs) {
    try {
      const nextRunAtMs = computeNextRunAtMs(job, nowMs);
      if (nextRunAtMs !== null) {
        results.set(job.id, nextRunAtMs);
        // 更新 job 的 nextRunAtMs（用于持久化）
        job.state.nextRunAtMs = nextRunAtMs;
      }
    } catch (err) {
      // 记录错误但继续处理其他 job
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Cron] 计算 ${job.name} 下次运行时间失败: ${message}`);
      job.state.nextRunAtMs = null;
      job.state.lastErrorCode = "SCHEDULE_INVALID";
      job.state.lastError = message;
    }
  }

  return results;
}

/**
 * 计算 scheduler 的下次唤醒时间
 *
 * @param jobs CronJob 数组
 * @param nowMs 当前时间（毫秒）
 * @returns 下次唤醒时间（毫秒），如果没有有效 job 则返回 null
 */
export function computeNextWakeAtMs(
  jobs: CronJob[],
  nowMs: number = Date.now()
): number | null {
  let nextWakeAtMs: number | null = null;

  for (const job of jobs) {
    // 只考虑启用且路由有效的 job
    if (!job.enabled || job.state.routeStatus !== "valid") {
      continue;
    }

    // 只处理 cron schedule
    if (job.schedule.kind !== "cron") {
      continue;
    }

    try {
      const nextRunAtMs = computeNextRunAtMs(job, nowMs);
      if (nextRunAtMs !== null) {
        if (nextWakeAtMs === null || nextRunAtMs < nextWakeAtMs) {
          nextWakeAtMs = nextRunAtMs;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Cron] 计算 ${job.name} 下次运行时间失败: ${message}`);
    }
  }

  return nextWakeAtMs;
}

// ============================================
// 导出
// ============================================

/**
 * 创建 Cron 计算器实例（预留，未来可能需要状态管理）
 */
export function createCronCalculator() {
  return {
    computeNextRunAtMs,
    computeNextRunAtMsForJobs,
    computeNextWakeAtMs,
  };
}

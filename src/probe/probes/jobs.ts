/**
 * msgcode: Jobs 探针
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/job_spec_v2.1.md
 *
 * 探针内容：
 * - store 可读/可解析
 * - jobs 数量、enabled 数量
 * - nextWakeAtMs 是否存在（使用 computeNextWakeAtMs 与 scheduler 口径一致）
 * - 是否存在 stuck/running 超时的 job
 */

import type { ProbeResult, ProbeOptions } from "../types.js";
import type { CronJob } from "../../jobs/types.js";
import { createJobStore, getDefaultJobsPathSync, getDefaultRunsPathSync } from "../../jobs/store.js";
import { computeNextWakeAtMs } from "../../jobs/cron.js";
import { DEFAULT_STUCK_TIMEOUT_MS } from "../../jobs/types.js";

/**
 * Jobs 探针
 */
export async function probeJobs(options?: ProbeOptions): Promise<ProbeResult> {
  const jobsPath = getDefaultJobsPathSync();
  const runsPath = getDefaultRunsPathSync();

  // 1) 检查 jobs.json 是否存在
  const fs = await import("node:fs");
  if (!fs.existsSync(jobsPath)) {
    return {
      name: "jobs",
      status: "warning",
      message: "任务存储不存在（尚未创建任何任务）",
      details: {
        jobsPath,
        hint: "使用 'msgcode job add' 创建第一个任务",
      },
    };
  }

  // 2) 使用 JobStore 加载 jobs（与 scheduler 口径一致）
  const store = createJobStore();
  const loadedStore = store.loadJobs();

  if (!loadedStore) {
    return {
      name: "jobs",
      status: "error",
      message: "无法加载任务存储",
      details: { jobsPath },
      fixHint: "检查 jobs.json 格式，或删除后重新创建任务",
    };
  }

  if (loadedStore.version !== 1) {
    return {
      name: "jobs",
      status: "error",
      message: `不支持的任务存储版本: ${loadedStore.version}`,
      details: { jobsPath, version: loadedStore.version },
      fixHint: "升级到最新版本的 msgcode",
    };
  }

  // 3) 统计信息
  const jobs = store.listJobs();
  const totalJobs = jobs.length;
  const enabledJobs = jobs.filter((j) => j.enabled).length;
  const disabledJobs = totalJobs - enabledJobs;
  const runningJobs = jobs.filter((j) => j.state.runningAtMs !== null).length;

  // 4) 检查 stuck jobs（使用与 scheduler 相同的阈值）
  const now = Date.now();
  const stuckJobs = jobs.filter((j) => {
    if (j.state.runningAtMs === null) return false;
    return (now - j.state.runningAtMs) > DEFAULT_STUCK_TIMEOUT_MS;
  });
  const stuckCount = stuckJobs.length;

  // 5) 检查孤儿 jobs（routeStatus = orphaned）
  const orphanedJobs = jobs.filter((j) => j.state.routeStatus === "orphaned");
  const orphanedCount = orphanedJobs.length;

  // 6) 检查无效 jobs（routeStatus = invalid）
  const invalidJobs = jobs.filter((j) => j.state.routeStatus === "invalid");
  const invalidCount = invalidJobs.length;

  // 7) 使用 computeNextWakeAtMs 计算下次唤醒时间（与 scheduler 口径完全一致）
  let nextWakeAtMs: number | null = null;
  try {
    nextWakeAtMs = computeNextWakeAtMs(jobs, now);
  } catch (err) {
    // 计算失败时降级为 warning，不崩溃
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Jobs probe] 计算 nextWakeAtMs 失败: ${message}`);
  }

  // 8) 生成推荐操作
  let recommended: string | undefined;
  const issues: string[] = [];

  if (stuckCount > 0) {
    issues.push(`${stuckCount} 个任务卡死`);
  }
  if (orphanedCount > 0) {
    issues.push(`${orphanedCount} 个任务路由失效`);
  }
  if (invalidCount > 0) {
    issues.push(`${invalidCount} 个任务路由不可用`);
  }

  if (issues.length > 0) {
    recommended = `需要处理: ${issues.join("，")}`;
  } else if (totalJobs === 0) {
    recommended = "使用 'msgcode job add' 创建第一个任务";
  } else if (enabledJobs === 0) {
    recommended = "所有任务已禁用，使用 'msgcode job enable <id>' 启用";
  }

  // 9) 生成每个 job 的最小摘要
  const jobSummaries = jobs.map((job) => ({
    id: job.id,
    name: job.name,
    enabled: job.enabled,
    schedule: job.schedule.kind === "cron" ? job.schedule.expr : `${job.schedule.kind}`,
    nextRunAtMs: job.state.nextRunAtMs,
    lastRunAtMs: job.state.lastRunAtMs,
    lastStatus: job.state.lastStatus,
    lastErrorCode: job.state.lastErrorCode,
    routeStatus: job.state.routeStatus,
  }));

  return {
    name: "jobs",
    status:
      stuckCount > 0 || orphanedCount > 0 || invalidCount > 0
        ? "warning"
        : "pass",
    message: `任务统计: ${totalJobs} 个任务，${enabledJobs} 个启用`,
    details: {
      jobsPath,
      runsPath,
      totalJobs,
      enabledJobs,
      disabledJobs,
      runningJobs,
      stuckCount,
      orphanedCount,
      invalidCount,
      nextWakeAtMs,
      nextWakeAt: nextWakeAtMs ? new Date(nextWakeAtMs).toISOString() : null,
      jobSummaries,
    },
    fixHint: recommended,
  };
}

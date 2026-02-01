/**
 * msgcode: Jobs Scheduler（调度器）
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/job_spec_v2.1.md
 *
 * 核心原则：
 * - 单 timer + unref()（不阻塞进程退出）
 * - 每次 wake 只跑"到期的下一批 job"
 * - 防卡死阈值可配置
 */

import type { CronJob, JobRun, JobStatus, JobErrorCode, RuntimeJobErrorCode, JobsErrorCode } from "./types.js";
import type { RouteEntry } from "../routes/store.js";
import { createJobStore, type JobStore } from "./store.js";
import { computeNextRunAtMs, computeNextRunAtMsForJobs, computeNextWakeAtMs } from "./cron.js";
import { DEFAULT_STUCK_TIMEOUT_MS } from "./types.js";

// ============================================
// 配置
// ============================================

/**
 * Scheduler 配置
 */
export interface SchedulerConfig {
  /** jobs.json 路径 */
  jobsPath?: string;
  /** runs.jsonl 路径 */
  runsPath?: string;
  /** 防卡死阈值（毫秒），默认 2h */
  stuckTimeoutMs?: number;
  /** 获取 RouteEntry 的函数 */
  getRouteFn: (chatGuid: string) => RouteEntry | null;
  /** 执行 job 的函数 */
  executeJobFn: (job: CronJob) => Promise<{
    status: JobStatus;
    durationMs: number;
    error?: string;
    errorCode?: string;
  }>;
  /** tick 回调（用于调试/日志） */
  onTick?: (info: { dueJobs: CronJob[] }) => void;
}

// ============================================
// Scheduler 类
// ============================================

/**
 * Jobs Scheduler
 */
export class JobScheduler {
  private store: JobStore;
  private config: Required<
    Omit<SchedulerConfig, "onTick"> & { onTick?: SchedulerConfig["onTick"] }
  >;
  private timerId: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: SchedulerConfig) {
    this.store = createJobStore({
      jobsPath: config.jobsPath,
      runsPath: config.runsPath,
    });

    this.config = {
      jobsPath: config.jobsPath || this.store.getJobsPath(),
      runsPath: config.runsPath || this.store.getRunsPath(),
      stuckTimeoutMs: config.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS, // 默认 2h
      getRouteFn: config.getRouteFn,
      executeJobFn: config.executeJobFn,
      onTick: config.onTick,
    } as typeof this.config;
  }

  // ============================================
  // 启动/停止
  // ============================================

  /**
   * 启动调度器
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    // 1) 加载 jobs
    const store = this.store.loadJobs();
    if (!store) {
      console.log("[Scheduler] jobs.json 不存在，创建新文件");
      this.store.saveJobs({ version: 1, jobs: [] });
    } else {
      // 2) 校验并更新 routeStatus（对齐点 2）
      await this.validateAllRoutes();

      // 3) 清理 stuck jobs（启动恢复）
      await this.cleanupStuckJobs();

      // 4) 计算所有 jobs 的 nextRunAtMs（#8.2）
      const jobs = this.store.listJobs();
      computeNextRunAtMsForJobs(jobs);
      for (const job of jobs) {
        if (job.state.nextRunAtMs !== null) {
          this.store.upsertJob(job);
        }
      }

      // 5) 启动 timer
      this.armTimer();
    }

    console.log("[Scheduler] 已启动");
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    console.log("[Scheduler] 已停止");
  }

  // ============================================
  // Route 校验（对齐点 2）
  // ============================================

  /**
   * 批量校验 routeStatus 并更新
   */
  private async validateAllRoutes(): Promise<void> {
    const jobs = this.store.listJobs();
    let updated = false;

    for (const job of jobs) {
      const route = this.config.getRouteFn(job.route.chatGuid);
      let newStatus: "valid" | "invalid" | "orphaned";

      if (!route) {
        newStatus = "orphaned";
      } else if (route.status !== "active") {
        newStatus = "invalid";
      } else {
        newStatus = "valid";
      }

      if (job.state.routeStatus !== newStatus) {
        job.state.routeStatus = newStatus;
        job.updatedAtMs = Date.now();
        this.store.upsertJob(job);
        updated = true;
      }
    }

    if (updated) {
      console.log("[Scheduler] 已更新 routeStatus");
    }
  }

  // ============================================
  // Stuck 清理（启动恢复）
  // ============================================

  /**
   * 清理卡死的 job（runningAtMs 超过阈值）
   */
  private async cleanupStuckJobs(): Promise<void> {
    const jobs = this.store.listJobs();
    const now = Date.now();
    let cleaned = 0;

    for (const job of jobs) {
      if (job.state.runningAtMs !== null) {
        const elapsed = now - job.state.runningAtMs;

        if (elapsed > this.config.stuckTimeoutMs) {
          // 清理 stuck 标记
          job.state.runningAtMs = null;
          job.state.lastStatus = "stuck";
          job.state.lastErrorCode = "JOB_STUCK_CLEARED";
          job.state.lastError = `运行超过 ${this.config.stuckTimeoutMs}ms，已清理`;
          job.state.lastRunAtMs = job.state.runningAtMs; // 记录卡死前的开始时间
          job.updatedAtMs = Date.now();

          // 写入 run 记录
          const run: JobRun = {
            ts: new Date(now).toISOString(),
            jobId: job.id,
            chatGuid: job.route.chatGuid,
            sessionTarget: job.sessionTarget,
            status: "stuck",
            durationMs: elapsed,
            errorCode: "JOB_STUCK",
            errorMessage: job.state.lastError,
          };
          this.store.appendRun(run);

          this.store.upsertJob(job);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[Scheduler] 已清理 ${cleaned} 个卡死任务`);
    }
  }

  // ============================================
  // Timer 管理
  // ============================================

  /**
   * 启动下一个 timer
   */
  private armTimer(): void {
    if (!this.running) {
      return;
    }

    // 清除现有 timer
    if (this.timerId) {
      clearTimeout(this.timerId);
    }

    // 计算下次唤醒时间
    const { nextWakeAtMs, dueJobs } = this.calculateNextWake();

    if (nextWakeAtMs === null) {
      console.log("[Scheduler] 没有到期的 job，暂停调度");
      this.timerId = null;
      return;
    }

    const delayMs = Math.max(0, nextWakeAtMs - Date.now());

    // 防止远未来溢出（最大 2^31-1 ms，约 24.8 天）
    const clampedDelay = Math.min(delayMs, 2147483647);

    this.timerId = setTimeout(() => {
      this.tick().catch((err) => {
        console.error("[Scheduler] tick 错误:", err);
      });
    }, clampedDelay);

    // unref() 允许进程退出
    this.timerId.unref();

    console.log(`[Scheduler] 下次唤醒: ${new Date(nextWakeAtMs).toISOString()} (${dueJobs.length} 个任务)`);
  }

  /**
   * 计算下次唤醒时间
   */
  private calculateNextWake(): {
    nextWakeAtMs: number | null;
    dueJobs: CronJob[];
  } {
    const jobs = this.store.listJobs();
    const now = Date.now();
    const dueJobs: CronJob[] = [];

    for (const job of jobs) {
      // 跳过禁用和路由失效的 job
      if (!job.enabled || job.state.routeStatus !== "valid") {
        continue;
      }

      // 计算 nextRunAtMs（如果未计算或过期）
      if (job.state.nextRunAtMs === null || job.state.nextRunAtMs < now) {
        try {
          const nextRunAtMs = computeNextRunAtMs(job, now);
          job.state.nextRunAtMs = nextRunAtMs;
          this.store.upsertJob(job);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[Scheduler] 计算 ${job.name} 下次运行时间失败: ${message}`);
          job.state.nextRunAtMs = null;
          job.state.lastErrorCode = "SCHEDULE_INVALID";
          job.state.lastError = message;
          this.store.upsertJob(job);
          continue;
        }
      }

      // 收集到期的 job
      if (job.state.nextRunAtMs !== null && job.state.nextRunAtMs <= now) {
        dueJobs.push(job);
      }
    }

    // 使用 computeNextWakeAtMs 计算最小唤醒时间
    const nextWakeAtMs = computeNextWakeAtMs(jobs, now);

    return { nextWakeAtMs, dueJobs };
  }

  // ============================================
  // Tick（执行到期的 job）
  // ============================================

  /**
   * 执行 tick
   */
  private async tick(): Promise<void> {
    const { dueJobs } = this.calculateNextWake();

    if (dueJobs.length === 0) {
      this.armTimer();
      return;
    }

    // 回调
    if (this.config.onTick) {
      this.config.onTick({ dueJobs });
    }

    // 串行执行所有到期的 job（避免并发问题）
    for (const job of dueJobs) {
      await this.executeJob(job);
    }

    // 重新计算并启动 timer
    this.armTimer();
  }

  /**
   * 执行单个 job
   */
  private async executeJob(job: CronJob): Promise<void> {
    const startTime = Date.now();

    // 标记 running（内存中不持久化 lastStatus）
    job.state.runningAtMs = startTime;
    this.store.upsertJob(job);

    try {
      // 调用执行函数
      const result = await this.config.executeJobFn(job);

      // 更新状态
      job.state.runningAtMs = null;
      job.state.lastRunAtMs = startTime;
      // result.status is JobStatus, but lastStatus excludes "running"/"pending"
      // Since execution completes, result.status is always ok/error/skipped/stuck
      job.state.lastStatus = result.status as "ok" | "error" | "skipped" | "stuck";
      job.state.lastDurationMs = result.durationMs;
      job.state.lastErrorCode = (result.errorCode as JobErrorCode | RuntimeJobErrorCode | null) || null;
      job.state.lastError = result.error || null;
      job.updatedAtMs = Date.now();

      // 写入 run 记录
      const run: JobRun = {
        ts: new Date(startTime).toISOString(),
        jobId: job.id,
        chatGuid: job.route.chatGuid,
        sessionTarget: job.sessionTarget,
        status: result.status,
        durationMs: result.durationMs,
        errorCode: (result.errorCode || null) as JobsErrorCode | null,
        errorMessage: result.error || null,
      };
      this.store.appendRun(run);

      // 执行成功后重新计算 nextRunAtMs（避免漂移）
      try {
        const nextRunAtMs = computeNextRunAtMs(job, Date.now());
        job.state.nextRunAtMs = nextRunAtMs;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[Scheduler] 计算 ${job.name} 下次运行时间失败: ${message}`);
        job.state.nextRunAtMs = null;
        job.state.lastErrorCode = "SCHEDULE_INVALID";
        job.state.lastError = message;
      }

      this.store.upsertJob(job);
    } catch (err) {
      // 执行异常
      const message = err instanceof Error ? err.message : String(err);

      job.state.runningAtMs = null;
      job.state.lastRunAtMs = startTime;
      job.state.lastStatus = "error";
      job.state.lastDurationMs = Date.now() - startTime;
      job.state.lastErrorCode = "JOB_EXECUTION_FAILED";
      job.state.lastError = message;
      job.updatedAtMs = Date.now();

      // 写入 run 记录
      const run: JobRun = {
        ts: new Date(startTime).toISOString(),
        jobId: job.id,
        chatGuid: job.route.chatGuid,
        sessionTarget: job.sessionTarget,
        status: "error",
        durationMs: Date.now() - startTime,
        errorCode: "JOB_EXECUTION_FAILED",
        errorMessage: message,
      };
      this.store.appendRun(run);

      this.store.upsertJob(job);
    }
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 JobScheduler 实例
 */
export function createJobScheduler(config: SchedulerConfig): JobScheduler {
  return new JobScheduler(config);
}

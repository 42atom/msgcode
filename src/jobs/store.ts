/**
 * msgcode: Jobs Store（持久化层）
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/job_spec_v2.1.md
 *
 * 提供纯 IO 模块（不掺 scheduler）：
 * - loadJobs() / saveJobs()（原子）
 * - appendRun()（jsonl 追加）
 * - getJobById() / listJobs()（读）
 */

import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  CronStoreFile,
  CronJob,
  JobRun,
  Schedule,
  SessionTarget,
  Payload,
  Delivery,
  RouteStatus,
  LastStatus,
} from "./types.js";
import { getDefaultJobsPath, getDefaultRunsPath, JOBS_ERROR_CODES, createJobsDiagnostic } from "./types.js";

// ============================================
// 错误类
// ============================================

/**
 * Jobs Store 错误
 */
export class JobsStoreError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "JobsStoreError";
  }
}

// ============================================
// 路径与目录管理
// ============================================

/**
 * 确保目录存在
 */
function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 原子写入文件（写入临时文件后 rename）
 */
function atomicWrite(filePath: string, content: string): void {
  ensureDir(filePath);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;

  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    // 清理临时文件
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {}
    throw err;
  }
}

// ============================================
// Jobs Store API
// ============================================

/**
 * JobStore 配置
 */
export interface JobStoreConfig {
  /** jobs.json 路径 */
  jobsPath?: string;
  /** runs.jsonl 路径 */
  runsPath?: string;
}

/**
 * JobStore 类
 */
export class JobStore {
  private jobsPath: string;
  private runsPath: string;

  constructor(config?: JobStoreConfig) {
    this.jobsPath = config?.jobsPath || getDefaultJobsPath();
    this.runsPath = config?.runsPath || getDefaultRunsPath();
  }

  // ============================================
  // Store 路径访问
  // ============================================

  /** 获取 jobs.json 路径 */
  getJobsPath(): string {
    return this.jobsPath;
  }

  /** 获取 runs.jsonl 路径 */
  getRunsPath(): string {
    return this.runsPath;
  }

  // ============================================
  // loadJobs() / saveJobs()（原子）
  // ============================================

  /**
   * 从 jobs.json 加载所有 jobs
   * @returns CronStoreFile 或 null（文件不存在时返回 null）
   * @throws JobsStoreError 当 JSON 解析失败或格式错误时
   */
  loadJobs(): CronStoreFile | null {
    if (!existsSync(this.jobsPath)) {
      return null;
    }

    try {
      const content = readFileSync(this.jobsPath, "utf8");
      const store = JSON.parse(content) as CronStoreFile;

      // 验证版本
      if (store.version !== 1) {
        throw new JobsStoreError(
          "JOB_INVALID_VERSION",
          `不支持的任务存储版本: ${store.version}`
        );
      }

      // 验证 jobs 是数组
      if (!Array.isArray(store.jobs)) {
        throw new JobsStoreError(
          "JOB_INVALID_FORMAT",
          "jobs 字段必须是数组"
        );
      }

      return store;
    } catch (err) {
      if (err instanceof JobsStoreError) {
        throw err;
      }
      throw new JobsStoreError(
        "JOB_INVALID_JSON",
        `无法解析 jobs.json: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * 原子写入 jobs.json
   * @param store CronStoreFile 对象
   * @throws JobsStoreError 当写入失败时
   */
  saveJobs(store: CronStoreFile): void {
    try {
      const content = JSON.stringify(store, null, 2);
      atomicWrite(this.jobsPath, content);
    } catch (err) {
      throw new JobsStoreError(
        "JOB_SAVE_FAILED",
        `写入 jobs.json 失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ============================================
  // appendRun()（jsonl 追加）
  // ============================================

  /**
   * 追加一行到 runs.jsonl
   * @param run JobRun 对象
   * @throws JobsStoreError 当追加失败时
   */
  appendRun(run: JobRun): void {
    try {
      ensureDir(this.runsPath);
      const line = JSON.stringify(run) + "\n";
      appendFileSync(this.runsPath, line, "utf8");
    } catch (err) {
      // 追加失败不应抛出错误（best-effort）
      console.warn(`[JobStore] 追加 runs.jsonl 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================
  // getJobById() / listJobs()（读）
  // ============================================

  /**
   * 按 ID 查询 job
   * @param id Job ID
   * @returns CronJob 或 null（不存在时返回 null）
   */
  getJobById(id: string): CronJob | null {
    const store = this.loadJobs();
    if (!store) {
      return null;
    }
    return store.jobs.find((job) => job.id === id) || null;
  }

  /**
   * 列出所有 jobs
   * @returns CronJob 数组
   */
  listJobs(): CronJob[] {
    const store = this.loadJobs();
    if (!store) {
      return [];
    }
    return store.jobs;
  }

  // ============================================
  // 高级操作
  // ============================================

  /**
   * 添加或更新 job（upsert）
   * @param job CronJob 对象
   */
  upsertJob(job: CronJob): void {
    const store = this.loadJobs() || { version: 1, jobs: [] };
    const existingIndex = store.jobs.findIndex((j) => j.id === job.id);

    if (existingIndex >= 0) {
      store.jobs[existingIndex] = job;
    } else {
      store.jobs.push(job);
    }

    this.saveJobs(store);
  }

  /**
   * 删除 job
   * @param id Job ID
   * @returns 是否删除成功
   */
  deleteJob(id: string): boolean {
    const store = this.loadJobs();
    if (!store) {
      return false;
    }

    const initialLength = store.jobs.length;
    store.jobs = store.jobs.filter((job) => job.id !== id);

    if (store.jobs.length < initialLength) {
      this.saveJobs(store);
      return true;
    }

    return false;
  }

  /**
   * 读取最近的 runs（可选：按 jobId 过滤）
   * @param jobId 可选的 Job ID 过滤器
   * @param limit 最多读取行数（默认 100）
   * @returns JobRun 数组（从新到旧）
   */
  readRecentRuns(jobId?: string, limit: number = 100): JobRun[] {
    if (!existsSync(this.runsPath)) {
      return [];
    }

    try {
      const content = readFileSync(this.runsPath, "utf8");
      const lines = content.trim().split("\n").reverse(); // 从新到旧

      const runs: JobRun[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const run = JSON.parse(line) as JobRun;

          // 可选：按 jobId 过滤
          if (jobId && run.jobId !== jobId) {
            continue;
          }

          runs.push(run);

          if (runs.length >= limit) {
            break;
          }
        } catch {
          // 跳过无效行
          continue;
        }
      }

      return runs;
    } catch {
      return [];
    }
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 JobStore 实例
 */
export function createJobStore(config?: JobStoreConfig): JobStore {
  return new JobStore(config);
}

/**
 * 获取默认 jobs.json 路径（同步版本）
 */
export function getDefaultJobsPathSync(): string {
  return path.join(os.homedir(), ".config/msgcode/cron/jobs.json");
}

/**
 * 获取默认 runs.jsonl 路径（同步版本）
 */
export function getDefaultRunsPathSync(): string {
  return path.join(os.homedir(), ".config/msgcode/cron/runs.jsonl");
}

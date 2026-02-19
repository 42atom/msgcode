/**
 * msgcode: Jobs CLI 命令
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/job_spec_v2.1.md
 * CLI Contract: AIDOCS/msgcode-2.1/cli_contract_v2.1.md
 *
 * 命令：
 * - msgcode job add --name <n> --cron <expr> --text <t> --workspace <id> [--json]
 * - msgcode job list [--json]
 * - msgcode job status <id> [--json]
 * - msgcode job enable|disable <id> [--json]
 * - msgcode job delete <id> [--json]
 */

import { Command } from "commander";
import type { Diagnostic } from "../memory/types.js";
import type {
  CronJob,
  JobListData,
  JobStatusData,
  JobAddData,
  JobRun,
} from "../jobs/types.js";
import { createJobStore } from "../jobs/store.js";
import {
  JOBS_ERROR_CODES,
  createJobsDiagnostic,
} from "../jobs/types.js";
import { computeNextRunAtMs } from "../jobs/cron.js";
import { executeJob } from "../jobs/runner.js";
import { createEnvelope } from "./command-runner.js";
import { randomUUID } from "node:crypto";

// ============================================
// 辅助函数
// ============================================

/**
 * 创建默认 CronJob
 */
function createDefaultJob(params: {
  name: string;
  cron: string;
  text: string;
  chatGuid: string;
  tz: string;
}): CronJob {
  const now = Date.now();
  return {
    id: randomUUID(),
    enabled: true,
    name: params.name,
    description: "",
    route: {
      chatGuid: params.chatGuid,
    },
    schedule: {
      kind: "cron",
      expr: params.cron,
      tz: params.tz,
    },
    sessionTarget: "main",
    payload: {
      kind: "tmuxMessage",
      text: params.text,
    },
    delivery: {
      mode: "reply-to-same-chat",
      bestEffort: true,
      maxChars: 2000,
    },
    state: {
      routeStatus: "valid",
      nextRunAtMs: null,
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
}

// ============================================
// 命令实现
// ============================================

/**
 * job add 命令
 */
export function createJobAddCommand(): Command {
  const cmd = new Command("add");

  cmd
    .description("添加定时任务")
    .requiredOption("--name <n>", "任务名称")
    .requiredOption("--cron <expr>", "Cron 表达式（如 '0 7 * * *'）")
    .requiredOption("--text <t>", "要发送的消息文本")
    .requiredOption("--chat-guid <guid>", "目标群 chatGuid")
    .requiredOption("--tz <iana>", "时区（如 Asia/Shanghai, America/New_York）- 必填，不允许使用系统时区")
    .option("--dry-run", "只打印计划，不实际写入")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode job add";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 创建 job 对象
        const job = createDefaultJob({
          name: options.name,
          cron: options.cron,
          text: options.text,
          chatGuid: options.chatGuid,
          tz: options.tz,
        });

        // 计算 nextRunAtMs（#8.2 验收要求）
        try {
          const nextRunAtMs = computeNextRunAtMs(job);
          job.state.nextRunAtMs = nextRunAtMs;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(
            createJobsDiagnostic(
              JOBS_ERROR_CODES.JOB_INVALID_SCHEDULE,
              `计算下次运行时间失败: ${message}`
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误:", message);
          }
          process.exit(1);
          return;
        }

        if (options.dryRun) {
          // Dry run：只打印计划
          const data: JobAddData = {
            job,
          };
          const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.log(`[计划] 将创建任务: ${job.name} (${job.id})`);
            const schedule = job.schedule.kind === "cron" ? job.schedule.expr : `${job.schedule.kind}`;
            console.log(`  Cron: ${schedule}`);
            console.log(`  文本: ${job.payload.text.slice(0, 50)}...`);
          }
          return;
        }

        // 写入 store
        const store = createJobStore();
        store.upsertJob(job);

        const data: JobAddData = {
          job,
        };
        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已创建任务: ${job.name} (${job.id})`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createJobsDiagnostic(
            "JOB_SAVE_FAILED",
            `创建任务失败: ${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * job list 命令
 */
export function createJobListCommand(): Command {
  const cmd = new Command("list");

  cmd
    .description("列出所有定时任务")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode job list";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const store = createJobStore();
        const jobs = store.listJobs();

        const enabled = jobs.filter((j) => j.enabled).length;
        const disabled = jobs.filter((j) => !j.enabled).length;

        const data: JobListData = {
          jobs,
          total: jobs.length,
          enabled,
          disabled,
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`任务列表 (${jobs.length} 个):`);
          console.log(`  已启用: ${enabled}`);
          console.log(`  已禁用: ${disabled}`);
          for (const job of jobs) {
            const status = job.enabled ? "✓" : "✗";
            const schedule = job.schedule.kind === "cron" ? job.schedule.expr : `${job.schedule.kind}`;
            console.log(`  ${status} ${job.name} (${job.id})`);
            console.log(`      Cron: ${schedule}`);
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createJobsDiagnostic(
            "JOB_LOAD_FAILED",
            `加载任务列表失败: ${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * job status 命令
 */
export function createJobStatusCommand(): Command {
  const cmd = new Command("status");

  cmd
    .description("查看任务详情")
    .argument("<id>", "任务 ID")
    .option("--json", "JSON 格式输出")
    .action(async (id, options) => {
      const startTime = Date.now();
      const command = `msgcode job status ${id}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const store = createJobStore();
        const job = store.getJobById(id);

        if (!job) {
          errors.push(
            createJobsDiagnostic(
              JOBS_ERROR_CODES.JOB_NOT_FOUND,
              `任务不存在: ${id}`,
              "使用 'msgcode job list' 查看所有任务"
            )
          );

          const envelope = createEnvelope(command, startTime, "error", { job: null }, warnings, errors);

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 任务不存在");
          }

          process.exit(1);
          return;
        }

        // 读取最近的 runs
        const recentRuns = store.readRecentRuns(id, 10);

        const data: JobStatusData = {
          job,
          recentRuns,
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`任务: ${job.name} (${job.id})`);
          console.log(`  状态: ${job.enabled ? "已启用" : "已禁用"}`);
          console.log(`  路由状态: ${job.state.routeStatus}`);
          console.log(`  最后运行: ${job.state.lastRunAtMs ? new Date(job.state.lastRunAtMs).toISOString() : "未运行"}`);
          console.log(`  最近执行 (${recentRuns.length} 条):`);
          for (const run of recentRuns) {
            console.log(`    ${run.ts}: ${run.status} (${run.durationMs}ms)`);
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createJobsDiagnostic(
            "JOB_LOAD_FAILED",
            `加载任务失败: ${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", { job: null }, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * job enable 命令
 */
export function createJobEnableCommand(): Command {
  const cmd = new Command("enable");

  cmd
    .description("启用任务")
    .argument("<id>", "任务 ID")
    .option("--json", "JSON 格式输出")
    .action(async (id, options) => {
      const startTime = Date.now();
      const command = `msgcode job enable ${id}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const store = createJobStore();
        const job = store.getJobById(id);

        if (!job) {
          errors.push(
            createJobsDiagnostic(
              JOBS_ERROR_CODES.JOB_NOT_FOUND,
              `任务不存在: ${id}`
            )
          );

          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 任务不存在");
          }

          process.exit(1);
          return;
        }

        job.enabled = true;
        job.updatedAtMs = Date.now();
        store.upsertJob(job);

        const envelope = createEnvelope(command, startTime, "pass", { job }, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已启用任务: ${job.name} (${job.id})`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createJobsDiagnostic(
            "JOB_UPDATE_FAILED",
            `启用任务失败: ${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * job disable 命令
 */
export function createJobDisableCommand(): Command {
  const cmd = new Command("disable");

  cmd
    .description("禁用任务")
    .argument("<id>", "任务 ID")
    .option("--json", "JSON 格式输出")
    .action(async (id, options) => {
      const startTime = Date.now();
      const command = `msgcode job disable ${id}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const store = createJobStore();
        const job = store.getJobById(id);

        if (!job) {
          errors.push(
            createJobsDiagnostic(
              JOBS_ERROR_CODES.JOB_NOT_FOUND,
              `任务不存在: ${id}`
            )
          );

          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 任务不存在");
          }

          process.exit(1);
          return;
        }

        job.enabled = false;
        job.updatedAtMs = Date.now();
        store.upsertJob(job);

        const envelope = createEnvelope(command, startTime, "pass", { job }, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已禁用任务: ${job.name} (${job.id})`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createJobsDiagnostic(
            "JOB_UPDATE_FAILED",
            `禁用任务失败: ${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * job delete 命令
 */
export function createJobDeleteCommand(): Command {
  const cmd = new Command("delete");

  cmd
    .description("删除任务")
    .argument("<id>", "任务 ID")
    .option("--json", "JSON 格式输出")
    .action(async (id, options) => {
      const startTime = Date.now();
      const command = `msgcode job delete ${id}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const store = createJobStore();
        const deleted = store.deleteJob(id);

        if (!deleted) {
          errors.push(
            createJobsDiagnostic(
              JOBS_ERROR_CODES.JOB_NOT_FOUND,
              `任务不存在: ${id}`
            )
          );

          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 任务不存在");
          }

          process.exit(1);
          return;
        }

        const envelope = createEnvelope(command, startTime, "pass", { deleted: true, id }, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已删除任务: ${id}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createJobsDiagnostic(
            "JOB_DELETE_FAILED",
            `删除任务失败: ${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * job run 命令
 */
export function createJobRunCommand(): Command {
  const cmd = new Command("run");

  cmd
    .description("立即执行任务（不改变 schedule）")
    .argument("<id>", "任务 ID")
    .option("--json", "JSON 格式输出")
    .option("--no-delivery", "不发送消息回 iMessage（用于测试）")
    .action(async (id, options) => {
      const startTime = Date.now();
      const command = `msgcode job run ${id}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const store = createJobStore();
        const job = store.getJobById(id);

        if (!job) {
          errors.push(
            createJobsDiagnostic(
              JOBS_ERROR_CODES.JOB_NOT_FOUND,
              `任务不存在: ${id}`
            )
          );

          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 任务不存在");
          }

          process.exit(1);
          return;
        }

        // 检查是否已经在运行
        if (job.state.runningAtMs !== null) {
          errors.push(
            createJobsDiagnostic(
              "JOB_ALREADY_RUNNING",
              `任务正在运行中`,
              "等待当前执行完成"
            )
          );

          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 任务正在运行中");
          }

          process.exit(1);
          return;
        }

        // 标记 running
        job.state.runningAtMs = Date.now();
        store.upsertJob(job);

        // M3.2-3: 使用真实执行器
        const result = await executeJob(job, {
          delivery: options.delivery !== false, // --no-delivery 时为 false
          // CLI 手动 run 暂不支持回发（需要 imsg client，但 CLI 是一次性执行）
          // 可以通过 --no-delivery 跳过回发
          imsgSend: options.delivery === false ? undefined : async (chatGuid, text) => {
            // TODO: CLI 模式下需要启动临时 imsg client 来发送消息
            // 暂时只打印不发送
            console.log(`[回发] ${chatGuid}: ${text.slice(0, 50)}...`);
          },
        });

        // 更新状态
        job.state.runningAtMs = null;
        job.state.lastRunAtMs = Date.now();
        // result.status 是 JobStatus，但 lastStatus 排除 "running"/"pending"
        // 执行完成后，result.status 总是 ok/error/skipped/stuck
        job.state.lastStatus = result.status as "ok" | "error" | "skipped" | "stuck";
        job.state.lastDurationMs = result.durationMs;
        job.state.lastErrorCode = (result.errorCode as import("../jobs/types.js").JobErrorCode | null) || null;
        job.state.lastError = result.error || null;
        job.updatedAtMs = Date.now();

        // 写入 run 记录
        const run: JobRun = {
          ts: new Date().toISOString(),
          jobId: job.id,
          chatGuid: job.route.chatGuid,
          sessionTarget: job.sessionTarget,
          status: result.status,
          durationMs: result.durationMs,
          errorCode: (result.errorCode || null) as import("../jobs/types.js").JobsErrorCode | null,
          errorMessage: result.error || null,
          details: result.details,
        };
        store.appendRun(run);

        store.upsertJob(job);

        const envelope = createEnvelope(command, startTime, "pass", { job, run }, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已执行任务: ${job.name} (${job.id})`);
          console.log(`  状态: ${result.status}`);
          console.log(`  耗时: ${result.durationMs}ms`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createJobsDiagnostic(
            "JOB_EXECUTION_FAILED",
            `执行任务失败: ${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// Job 命令组
// ============================================

export function createJobCommand(): Command {
  const cmd = new Command("job");

  cmd.description("Jobs 管理（定时任务 + 可恢复调度）");

  cmd.addCommand(createJobAddCommand());
  cmd.addCommand(createJobListCommand());
  cmd.addCommand(createJobStatusCommand());
  cmd.addCommand(createJobRunCommand());
  cmd.addCommand(createJobEnableCommand());
  cmd.addCommand(createJobDisableCommand());
  cmd.addCommand(createJobDeleteCommand());

  return cmd;
}

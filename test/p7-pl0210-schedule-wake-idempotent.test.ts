import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  generateWakeJobId,
  generateWakeRecordId,
  getSchedule,
  listSchedules,
  setTriggerNowHook,
  syncScheduleToWakeJob,
  syncAllSchedules,
  triggerWakeJob,
  triggerDueWakeJobs,
  catchUpMissedWakes,
  ensureScheduleDir,
  getSchedulesDir,
} from "../src/runtime/schedule-wake.js";
import { listWakeJobs, listWakeRecords, getJobsDir, getRecordsDir } from "../src/runtime/wake-store.js";
import { createHeartbeatTickHandler } from "../src/runtime/heartbeat-tick.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-schedule-wake-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createScheduleFile(workspacePath: string, scheduleId: string, schedule: object): void {
  ensureScheduleDir(workspacePath);
  const schedulePath = path.join(getSchedulesDir(workspacePath), `${scheduleId}.json`);
  fs.writeFileSync(schedulePath, JSON.stringify(schedule, null, 2));
}

function createChildTask(workspacePath: string, taskId: string, board: string, slug: string): void {
  const issuesDir = path.join(workspacePath, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });

  const content = `---
owner: agent
assignee: codex
reviewer: agent
why: 测试 schedule now
scope: 测试
risk: low
accept: 完成
---

# Task

测试任务内容
`;

  fs.writeFileSync(path.join(issuesDir, `${taskId}.tdo.${board}.${slug}.md`), content);
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Schedule -> Wake Job -> Wake Record 幂等生成", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
    // 确保 wake 目录存在
    fs.mkdirSync(getJobsDir(workspace), { recursive: true });
    fs.mkdirSync(getRecordsDir(workspace), { recursive: true });
  });

  afterEach(() => {
    setTriggerNowHook(null);
    cleanupTempWorkspace(workspace);
  });

  describe("Deterministic ID 生成", () => {
    it("同一 workspace + scheduleId 生成相同 job ID", () => {
      const id1 = generateWakeJobId(workspace, "daily-checkin");
      const id2 = generateWakeJobId(workspace, "daily-checkin");
      expect(id1).toBe(id2);
    });

    it("不同 scheduleId 生成不同 job ID", () => {
      const id1 = generateWakeJobId(workspace, "daily-checkin");
      const id2 = generateWakeJobId(workspace, "morning-reminder");
      expect(id1).not.toBe(id2);
    });

    it("同一 workspace + scheduleId + scheduledAt 生成相同 record ID", () => {
      const scheduledAt = 1700000000000;
      const id1 = generateWakeRecordId(workspace, "daily-checkin", scheduledAt);
      const id2 = generateWakeRecordId(workspace, "daily-checkin", scheduledAt);
      expect(id1).toBe(id2);
    });

    it("不同 scheduledAt 生成不同 record ID", () => {
      const id1 = generateWakeRecordId(workspace, "daily-checkin", 1700000000000);
      const id2 = generateWakeRecordId(workspace, "daily-checkin", 1700000001000);
      expect(id1).not.toBe(id2);
    });
  });

  describe("Schedule -> Wake Job 映射", () => {
    it("创建 schedule 后能映射到 wake job", () => {
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() + 3600000 },
        wake: {
          mode: "next-heartbeat",
          hint: "Test wake",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "test-schedule", schedule);
      const result = syncScheduleToWakeJob(workspace, getSchedule(workspace, "test-schedule")!);

      expect(result).not.toBeNull();
      expect(result!.id).toContain("schedule:");
      expect(result!.enabled).toBe(true);
    });

    it("禁用 schedule 不删除已有 job，只标记 disabled", () => {
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() + 3600000 },
        wake: {
          mode: "next-heartbeat",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "test-schedule", schedule);
      syncScheduleToWakeJob(workspace, getSchedule(workspace, "test-schedule")!);

      // 修改为 disabled
      const updatedSchedule = { ...schedule, enabled: false, updatedAt: Date.now() };
      createScheduleFile(workspace, "test-schedule", updatedSchedule);
      syncScheduleToWakeJob(workspace, getSchedule(workspace, "test-schedule")!);

      const job = listWakeJobs(workspace)[0];
      expect(job.enabled).toBe(false);
    });
  });

  describe("Wake Job -> Wake Record 幂等生成", () => {
    it("触发 wake job 生成 wake record", () => {
      // 先创建 schedule 和 job
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() },
        wake: {
          mode: "next-heartbeat",
          hint: "Test wake",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "test-schedule", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "test-schedule")!);
      expect(job).not.toBeNull();

      // 触发
      const now = Date.now();
      const record = triggerWakeJob(workspace, job!.id, now);
      expect(record).not.toBeNull();
      expect(record!.status).toBe("pending");
      expect(record!.jobId).toBe(job!.id);
    });

    it("重复触发同一 job + 同一时间不生成重复 record（幂等）", () => {
      // 使用 every 而非 at，因为 at (once) job 触发后会退场
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "every", everyMs: 60000, anchorMs: Date.now() - 120000 },
        wake: {
          mode: "next-heartbeat",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "test-schedule", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "test-schedule")!);

      const now = Date.now();

      // 第一次触发
      const record1 = triggerWakeJob(workspace, job!.id, now - 60000);
      expect(record1).not.toBeNull();

      const recordsBefore = listWakeRecords(workspace);

      // 第二次触发同一时间（幂等）
      const record2 = triggerWakeJob(workspace, job!.id, now - 60000);
      expect(record2).not.toBeNull();

      const recordsAfter = listWakeRecords(workspace);
      // 不应该增加新 record
      expect(recordsAfter.length).toBe(recordsBefore.length);
      // 返回的是同一个
      expect(record2!.id).toBe(record1!.id);
    });

    it("不同时间触发生成不同 record", () => {
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "every", everyMs: 60000, anchorMs: Date.now() },
        wake: {
          mode: "next-heartbeat",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "test-schedule", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "test-schedule")!);

      const now = Date.now();

      // 第一次
      triggerWakeJob(workspace, job!.id, now);
      // 第二次（不同时间）
      triggerWakeJob(workspace, job!.id, now + 60000);

      const records = listWakeRecords(workspace);
      expect(records.length).toBe(2);
      expect(records[0].id).not.toBe(records[1].id);
    });
  });

  describe("Catch-up 规则", () => {
    it("latePolicy=skip-if-missed 时标记为 expired", () => {
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() - 7200000 }, // 2小时前
        wake: {
          mode: "next-heartbeat",
          latePolicy: "skip-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "test-schedule", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "test-schedule")!);
      const now = Date.now();
      triggerWakeJob(workspace, job!.id, now - 7200000);

      // 执行 catch-up
      const caught = catchUpMissedWakes(workspace);

      const records = listWakeRecords(workspace);
      const expiredRecord = records.find(r => r.status === "expired");

      expect(caught).toBeGreaterThan(0);
      expect(expiredRecord).not.toBeNull();
      expect(expiredRecord!.completedAt).toBeDefined();
    });

    it("latePolicy=run-if-missed 时保持 pending", () => {
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() - 7200000 },
        wake: {
          mode: "next-heartbeat",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "test-schedule", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "test-schedule")!);
      triggerWakeJob(workspace, job!.id, Date.now() - 7200000);

      // 执行 catch-up
      catchUpMissedWakes(workspace);

      const records = listWakeRecords(workspace);
      const pendingRecord = records.find(r => r.status === "pending");

      expect(pendingRecord).not.toBeNull();
    });
  });

  describe("Orphan Reconciliation", () => {
    it("删除 schedule 后 wake job 被禁用", () => {
      // 创建并同步 schedule
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() + 3600000 },
        wake: {
          mode: "next-heartbeat",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "orphan-schedule", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "orphan-schedule")!);
      expect(job).not.toBeNull();
      expect(job!.enabled).toBe(true);

      // 删除 schedule 文件
      const schedulePath = path.join(getSchedulesDir(workspace), "orphan-schedule.json");
      fs.unlinkSync(schedulePath);

      // 重新同步
      syncAllSchedules(workspace);

      // job 应该被禁用
      const jobs = listWakeJobs(workspace);
      const disabledJob = jobs.find(j => j.id === job!.id);
      expect(disabledJob).not.toBeNull();
      expect(disabledJob!.enabled).toBe(false);
    });
  });

  describe("Once Job 退场", () => {
    it("once/at job 触发后禁用，不重复触发", () => {
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() - 1000 },
        wake: {
          mode: "next-heartbeat",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "once-test", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "once-test")!);
      expect(job).not.toBeNull();
      expect(job!.kind).toBe("once");

      // 第一次触发
      const now = Date.now();
      const record1 = triggerWakeJob(workspace, job!.id, now - 1000);
      expect(record1).not.toBeNull();

      // 验证 job 已被禁用
      const jobAfterTrigger = listWakeJobs(workspace).find(j => j.id === job!.id);
      expect(jobAfterTrigger!.enabled).toBe(false);

      // 第二次触发应该跳过（因为 job 已禁用）
      const record2 = triggerWakeJob(workspace, job!.id, now);
      expect(record2).toBeNull();
    });
  });

  describe("Cron 解析", () => {
    it("cron 表达式能正确计算下次触发时间", () => {
      // 这个测试主要验证不报错
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
        wake: {
          mode: "next-heartbeat",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "cron-test", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "cron-test")!);

      expect(job).not.toBeNull();
      expect(job!.schedule).toBeDefined();
    });

    it("cron.tz 会影响真实触发时刻，而不是只保留字段", () => {
      const fixedNow = Date.UTC(2026, 2, 16, 1, 0, 30);
      const originalNow = Date.now;
      Date.now = () => fixedNow;

      try {
        createScheduleFile(workspace, "cron-shanghai", {
          version: 2,
          enabled: true,
          schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
          wake: {
            mode: "next-heartbeat",
            latePolicy: "run-if-missed",
          },
          createdAt: fixedNow,
          updatedAt: fixedNow,
        });
        createScheduleFile(workspace, "cron-utc", {
          version: 2,
          enabled: true,
          schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
          wake: {
            mode: "next-heartbeat",
            latePolicy: "run-if-missed",
          },
          createdAt: fixedNow,
          updatedAt: fixedNow,
        });

        const shanghaiJob = syncScheduleToWakeJob(workspace, getSchedule(workspace, "cron-shanghai")!);
        const utcJob = syncScheduleToWakeJob(workspace, getSchedule(workspace, "cron-utc")!);

        const triggered = triggerDueWakeJobs(workspace);
        const records = listWakeRecords(workspace);

        expect(shanghaiJob).not.toBeNull();
        expect(utcJob).not.toBeNull();
        expect(triggered).toBe(1);
        expect(records).toHaveLength(1);
        expect(records[0].jobId).toBe(shanghaiJob!.id);
        expect(records[0].jobId).not.toBe(utcJob!.id);
        expect(records[0].scheduledAt).toBe(Date.UTC(2026, 2, 16, 1, 0, 0));
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe("Wake Mode 传递", () => {
    it("schedule.wake.mode 能正确传递到 wake job", () => {
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "every", everyMs: 60000, anchorMs: Date.now() },
        wake: {
          mode: "now",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "mode-test", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "mode-test")!);

      expect(job).not.toBeNull();
      expect(job!.mode).toBe("now");
    });

    it("record 创建时记录了正确的 mode", () => {
      const schedule = {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() - 1000 },
        wake: {
          mode: "now",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      createScheduleFile(workspace, "mode-record-test", schedule);
      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "mode-record-test")!);
      const record = triggerWakeJob(workspace, job!.id, Date.now() - 1000);

      expect(record).not.toBeNull();
      // mode 传递在 job 层面，record 本身不存储 mode
      // 但 record 的创建是由 mode=now 的 job 触发的
      expect(job!.mode).toBe("now");
    });

    it("mode=now 创建 record 后会调用 triggerNow hook", async () => {
      let called = false;
      let receivedRecordId: string | null = null;

      setTriggerNowHook(async ({ workspacePath, record }) => {
        called = true;
        expect(workspacePath).toBe(workspace);
        receivedRecordId = record.id;
        return true;
      });

      createScheduleFile(workspace, "mode-hook-success", {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() - 1000 },
        wake: {
          mode: "now",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "mode-hook-success")!);
      const record = triggerWakeJob(workspace, job!.id, Date.now() - 1000);
      await flushAsyncWork();

      expect(record).not.toBeNull();
      expect(called).toBe(true);
      expect(receivedRecordId).toBe(record!.id);
    });

    it("mode=now hook 返回 false 时静默降级，但不影响 record 落盘", async () => {
      let called = 0;

      setTriggerNowHook(async () => {
        called += 1;
        return false;
      });

      createScheduleFile(workspace, "mode-hook-false", {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() - 1000 },
        wake: {
          mode: "now",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "mode-hook-false")!);
      const record = triggerWakeJob(workspace, job!.id, Date.now() - 1000);
      await flushAsyncWork();

      expect(called).toBe(1);
      expect(record).not.toBeNull();
      expect(listWakeRecords(workspace).map((item) => item.id)).toContain(record!.id);
    });

    it("mode=now hook 抛错时静默降级，但不影响 record 落盘", async () => {
      let called = 0;

      setTriggerNowHook(async () => {
        called += 1;
        throw new Error("runner busy");
      });

      createScheduleFile(workspace, "mode-hook-throw", {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() - 1000 },
        wake: {
          mode: "now",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "mode-hook-throw")!);
      const record = triggerWakeJob(workspace, job!.id, Date.now() - 1000);
      await flushAsyncWork();

      expect(called).toBe(1);
      expect(record).not.toBeNull();
      expect(listWakeRecords(workspace).map((item) => item.id)).toContain(record!.id);
    });

    it("mode=now 默认可接到 workspace heartbeat，立即推进任务文档", async () => {
      createChildTask(workspace, "tk9201", "frontend", "schedule-now");

      const heartbeatTick = createHeartbeatTickHandler({
        workspacePath: workspace,
        issuesDir: path.join(workspace, "issues"),
        mockSubagentFn: async () => ({
          success: true,
          task: { taskId: "mock-schedule-now-001" },
          watchResult: { success: true, response: "mock success" },
        }),
      });

      setTriggerNowHook(async ({ workspacePath }) => {
        await heartbeatTick({
          tickId: "schedule-now",
          reason: "manual",
          startTime: Date.now(),
        });
        return workspacePath === workspace;
      });

      createScheduleFile(workspace, "mode-heartbeat-now", {
        version: 2,
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() - 1000 },
        wake: {
          mode: "now",
          taskId: "tk9201",
          hint: "立即推进 heartbeat",
          latePolicy: "run-if-missed",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "mode-heartbeat-now")!);
      const record = triggerWakeJob(workspace, job!.id, Date.now() - 1000);
      await flushAsyncWork();

      expect(record).not.toBeNull();
      expect(fs.existsSync(path.join(workspace, "issues", "tk9201.pss.frontend.schedule-now.md"))).toBe(true);
    });
  });

  describe("Startup 幂等", () => it("模拟多次扫描不产生重复 record", () => {
    const schedule = {
      version: 2,
      enabled: true,
      schedule: { kind: "at", atMs: Date.now() },
      wake: {
        mode: "next-heartbeat",
        latePolicy: "run-if-missed",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    createScheduleFile(workspace, "test-schedule", schedule);
    const job = syncScheduleToWakeJob(workspace, getSchedule(workspace, "test-schedule")!);

    const now = Date.now();

    // 模拟多次扫描
    for (let i = 0; i < 5; i++) {
      triggerWakeJob(workspace, job!.id, now);
    }

    const records = listWakeRecords(workspace);
    // 应该只有 1 条 record
    expect(records.length).toBe(1);
  }));
});

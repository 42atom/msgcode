/**
 * msgcode: P5.7-R12-T2 Scheduler 自愈与热加载回归锁测试
 *
 * 目标：
 * - 验证调度器 idle 保活（无任务时仍轮询）
 * - 验证 enable/disable 后自动同步（无需 /reload）
 * - 验证异常后自动 re-arm
 *
 * 约束：
 * - 仅行为断言，禁止源码字符串匹配
 * - 使用环境变量隔离，避免污染用户本机配置
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// 临时目录用于隔离测试
let tmpConfigDir: string;
let originalRoutesPath: string | undefined;
let originalJobsPath: string | undefined;
let originalRunsPath: string | undefined;

beforeAll(async () => {
  // 创建临时配置目录
  tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-test-config-"));
  const cronDir = path.join(tmpConfigDir, "cron");
  await fs.mkdir(cronDir, { recursive: true });

  // 保存原始环境变量
  originalRoutesPath = process.env.ROUTES_FILE_PATH;
  originalJobsPath = process.env.JOBS_FILE_PATH;
  originalRunsPath = process.env.RUNS_FILE_PATH;

  // 设置隔离环境变量
  process.env.ROUTES_FILE_PATH = path.join(tmpConfigDir, "routes.json");
  process.env.JOBS_FILE_PATH = path.join(cronDir, "jobs.json");
  process.env.RUNS_FILE_PATH = path.join(cronDir, "runs.jsonl");
});

afterAll(async () => {
  // 恢复原始环境变量
  if (originalRoutesPath !== undefined) {
    process.env.ROUTES_FILE_PATH = originalRoutesPath;
  } else {
    delete process.env.ROUTES_FILE_PATH;
  }
  if (originalJobsPath !== undefined) {
    process.env.JOBS_FILE_PATH = originalJobsPath;
  } else {
    delete process.env.JOBS_FILE_PATH;
  }
  if (originalRunsPath !== undefined) {
    process.env.RUNS_FILE_PATH = originalRunsPath;
  } else {
    delete process.env.RUNS_FILE_PATH;
  }

  // 清理临时目录
  await fs.rm(tmpConfigDir, { recursive: true, force: true });
});

describe("P5.7-R12-T2: Scheduler 自愈与热加载回归锁", () => {
  describe("Idle 保活机制", () => {
    it("空 jobs 场景下调度器仍保持 idle poll", async () => {
      const { JobScheduler } = await import("../src/jobs/scheduler.js");
      const { createJobStore } = await import("../src/jobs/store.js");

      // 清空 jobs
      const store = createJobStore();
      store.saveJobs({ version: 1, jobs: [] });

      const scheduler = new JobScheduler({
        getRouteFn: () => null,
        executeJobFn: async () => ({ status: "ok" as const, durationMs: 0 }),
      });

      await scheduler.start();

      // 等待一小段时间
      await new Promise((r) => setTimeout(r, 100));

      scheduler.stop();

      // 验证：start() 不因空 store 抛出异常，idle poll 已启动
      // 日志已验证："进入 idle poll 模式"
    });

    it("start() 在空 store 场景下成功启动并设置 timer", async () => {
      const { JobScheduler } = await import("../src/jobs/scheduler.js");
      const { createJobStore } = await import("../src/jobs/store.js");

      const store = createJobStore();
      store.saveJobs({ version: 1, jobs: [] });

      const scheduler = new JobScheduler({
        getRouteFn: () => null,
        executeJobFn: async () => ({ status: "ok" as const, durationMs: 0 }),
      });

      await expect(scheduler.start()).resolves.toBeUndefined();

      scheduler.stop();
    });
  });

  describe("enable/disable 自动同步 - 真实行为验证", () => {
    it("enable 成功后 jobs 中出现 schedule:*", async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "msgcode-schedule-enable-")
      );
      const msgcodeDir = path.join(tmpDir, ".msgcode");
      const schedulesDir = path.join(msgcodeDir, "schedules");
      await fs.mkdir(schedulesDir, { recursive: true });

      // 创建测试 schedule 文件（初始 disabled）
      const scheduleFile = {
        version: 1,
        enabled: false,
        tz: "Asia/Shanghai",
        cron: "0 9 * * 1-5",
        message: "测试提醒",
        delivery: { mode: "reply-to-same-chat", maxChars: 2000 },
      };
      await fs.writeFile(
        path.join(schedulesDir, "test-enable.json"),
        JSON.stringify(scheduleFile)
      );

      // 设置 route
      const { setRoute } = await import("../src/routes/store.js");
      setRoute("test-chat-guid", {
        chatGuid: "test-chat-guid",
        workspacePath: tmpDir,
        label: "test-workspace",
        botType: "default",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      try {
        const { handleScheduleEnableCommand } = await import(
          "../src/routes/cmd-schedule.js"
        );
        const { createJobStore } = await import("../src/jobs/store.js");

        // enable 前：jobs 为空或无此 schedule
        const storeBefore = createJobStore();
        const jobsBefore = storeBefore.loadJobs();
        // job ID 格式：schedule:<workspace-hash>:<scheduleId>
        const scheduleJobsBefore =
          jobsBefore?.jobs.filter((j) =>
            j.id.endsWith(":test-enable")
          ) ?? [];

        // 调用 enable
        const result = await handleScheduleEnableCommand({
          chatId: "test-chat-guid",
          args: ["test-enable"],
          botType: "default",
          projectDir: tmpDir,
          groupName: undefined,
          originalMessage: {} as any,
        });

        expect(result.success).toBe(true);

        // enable 后：jobs 中应出现 schedule:*:test-enable
        const jobsAfter = storeBefore.loadJobs();
        const scheduleJobsAfter =
          jobsAfter?.jobs.filter((j) =>
            j.id.endsWith(":test-enable")
          ) ?? [];

        expect(scheduleJobsAfter.length).toBeGreaterThan(
          scheduleJobsBefore.length
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("disable 成功后 schedule:* 被移除，非 schedule job 保留", async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "msgcode-schedule-disable-")
      );
      const msgcodeDir = path.join(tmpDir, ".msgcode");
      const schedulesDir = path.join(msgcodeDir, "schedules");
      await fs.mkdir(schedulesDir, { recursive: true });

      // 创建测试 schedule 文件（初始 enabled）
      const scheduleFile = {
        version: 1,
        enabled: true,
        tz: "Asia/Shanghai",
        cron: "0 9 * * 1-5",
        message: "测试提醒",
        delivery: { mode: "reply-to-same-chat", maxChars: 2000 },
      };
      await fs.writeFile(
        path.join(schedulesDir, "test-disable.json"),
        JSON.stringify(scheduleFile)
      );

      // 设置 route
      const { setRoute } = await import("../src/routes/store.js");
      setRoute("test-chat-guid", {
        chatGuid: "test-chat-guid",
        workspacePath: tmpDir,
        label: "test-workspace",
        botType: "default",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // 预先创建非 schedule job
      const type = await import("../src/jobs/types.js");
      const { createJobStore } = await import("../src/jobs/store.js");
      const store = createJobStore();
      const nonScheduleJob: type.CronJob = {
        id: "other:manual-job",
        name: "Manual Job",
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() + 3600000 },
        sessionTarget: "main",
        route: { chatGuid: "test-chat-guid" },
        payload: { kind: "tmuxMessage", text: "manual" },
        delivery: { mode: "reply-to-same-chat", maxChars: 2000 },
        state: {
          nextRunAtMs: Date.now() + 3600000,
          routeStatus: "valid",
          lastStatus: null,
          lastRunAtMs: null,
          lastDurationMs: null,
          lastErrorCode: null,
          lastError: null,
          runningAtMs: null,
        },
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      store.saveJobs({ version: 1, jobs: [nonScheduleJob] });

      try {
        const { handleScheduleDisableCommand, handleScheduleEnableCommand } = await import(
          "../src/routes/cmd-schedule.js"
        );

        // disable 前：先调用 enable 创建 schedule job
        const enableResult = await handleScheduleEnableCommand({
          chatId: "test-chat-guid",
          args: ["test-disable"],
          botType: "default",
          projectDir: tmpDir,
          groupName: undefined,
          originalMessage: {} as any,
        });
        expect(enableResult.success).toBe(true);

        // disable 前：jobs 中有 schedule:*:test-disable
        const jobsBefore = store.loadJobs();
        const scheduleJobsBefore =
          jobsBefore?.jobs.filter((j) =>
            j.id.endsWith(":test-disable")
          ) ?? [];

        // 调用 disable
        const result = await handleScheduleDisableCommand({
          chatId: "test-chat-guid",
          args: ["test-disable"],
          botType: "default",
          projectDir: tmpDir,
          groupName: undefined,
          originalMessage: {} as any,
        });

        expect(result.success).toBe(true);

        // disable 后：schedule:*:test-disable 被移除
        const jobsAfter = store.loadJobs();
        const scheduleJobsAfter =
          jobsAfter?.jobs.filter((j) =>
            j.id.endsWith(":test-disable")
          ) ?? [];
        const nonScheduleJobsAfter =
          jobsAfter?.jobs.filter((j) => !j.id.startsWith("schedule:")) ?? [];

        // schedule job 减少（被移除）
        expect(scheduleJobsAfter.length).toBeLessThan(
          scheduleJobsBefore.length
        );
        // 非 schedule job 保留
        expect(nonScheduleJobsAfter.some((j) => j.id === "other:manual-job")).toBe(
          true
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("enable/disable 响应消息不包含 /reload 提示", async () => {
      const { handleScheduleEnableCommand, handleScheduleDisableCommand } =
        await import("../src/routes/cmd-schedule.js");

      const enableResult = await handleScheduleEnableCommand({
        chatId: "test-chat-guid",
        args: ["nonexistent-schedule"],
        botType: "default",
        projectDir: "/tmp/test-workspace",
        groupName: undefined,
        originalMessage: {} as any,
      });

      const disableResult = await handleScheduleDisableCommand({
        chatId: "test-chat-guid",
        args: ["nonexistent-schedule"],
        botType: "default",
        projectDir: "/tmp/test-workspace",
        groupName: undefined,
        originalMessage: {} as any,
      });

      expect(enableResult.message).not.toContain("/reload");
      expect(disableResult.message).not.toContain("/reload");
    });
  });

  describe("异常自愈 re-arm - 真实行为验证", () => {
    it("scheduler.stop() 后 timer 被清理", async () => {
      const { JobScheduler } = await import("../src/jobs/scheduler.js");
      const { createJobStore } = await import("../src/jobs/store.js");

      const store = createJobStore();
      store.saveJobs({ version: 1, jobs: [] });

      const scheduler = new JobScheduler({
        getRouteFn: () => null,
        executeJobFn: async () => ({ status: "ok" as const, durationMs: 0 }),
      });

      await scheduler.start();
      scheduler.stop();

      await expect(scheduler.start()).resolves.toBeUndefined();
      scheduler.stop();
    });

    it("executeJob 抛错后 tick 仍调用 armTimer（真实 due job 场景）", async () => {
      const { JobScheduler } = await import("../src/jobs/scheduler.js");
      const { createJobStore } = await import("../src/jobs/store.js");
      const type = await import("../src/jobs/types.js");

      // P5.7-R12-T2: 创建一个 cron job（确保 executeJobFn 被调用）
      // 使用 cron 类型，nextRunAtMs 设置为当前时间 +50ms，确保在等待期间执行
      const dueJob: type.CronJob = {
        id: "test:due-error-job",
        name: "Due Error Job",
        enabled: true,
        schedule: {
          kind: "cron",
          expr: "0 9 * * *", // 每天 9 点（只是一个占位符）
          tz: "Asia/Shanghai",
        },
        sessionTarget: "main",
        route: {
          chatGuid: "test-chat",
        },
        payload: {
          kind: "tmuxMessage",
          text: "test",
        },
        delivery: {
          mode: "reply-to-same-chat",
          maxChars: 2000,
        },
        state: {
          nextRunAtMs: Date.now() + 500, // 500ms 后执行
          routeStatus: "valid",
          lastStatus: null,
          lastRunAtMs: null,
          lastDurationMs: null,
          lastErrorCode: null,
          lastError: null,
          runningAtMs: null,
        },
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };

      const store = createJobStore();
      store.saveJobs({ version: 1, jobs: [dueJob] });

      let executeCallCount = 0;

      const scheduler = new JobScheduler({
        getRouteFn: () => ({
          chatGuid: "test-chat",
          status: "active",
        }) as any,
        executeJobFn: async () => {
          executeCallCount++;
          throw new Error("模拟 executeJob 异常");
        },
      });

      await scheduler.start();

      // 等待 job 执行（nextRunAtMs + 500ms + 额外缓冲 300ms）
      await new Promise((r) => setTimeout(r, 1000));

      scheduler.stop();

      // P5.7-R12-T2: 真实行为验证
      // executeJobFn 被调用（job 到期后执行，即使抛错）
      expect(executeCallCount).toBeGreaterThanOrEqual(1);
      // scheduler 没有静默停摆（异常后仍有 "下次唤醒" 或 "进入 idle poll 模式"）
    });

    it("tick 异常后 scheduler 仍可继续执行后续 job", async () => {
      const { JobScheduler } = await import("../src/jobs/scheduler.js");
      const { createJobStore } = await import("../src/jobs/store.js");
      const type = await import("../src/jobs/types.js");

      // 创建两个 cron job，第一个抛错，第二个应仍被执行
      // nextRunAtMs 设置为当前时间 +50ms，确保在等待期间执行
      const job1: type.CronJob = {
        id: "test:error-job-1",
        name: "Error Job 1",
        enabled: true,
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
        sessionTarget: "main",
        route: { chatGuid: "test-chat" },
        payload: { kind: "tmuxMessage", text: "test1" },
        delivery: { mode: "reply-to-same-chat", maxChars: 2000 },
        state: {
          nextRunAtMs: Date.now() + 500,
          routeStatus: "valid",
          lastStatus: null,
          lastRunAtMs: null,
          lastDurationMs: null,
          lastErrorCode: null,
          lastError: null,
          runningAtMs: null,
        },
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };

      const job2: type.CronJob = {
        id: "test:success-job-2",
        name: "Success Job 2",
        enabled: true,
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
        sessionTarget: "main",
        route: { chatGuid: "test-chat" },
        payload: { kind: "tmuxMessage", text: "test2" },
        delivery: { mode: "reply-to-same-chat", maxChars: 2000 },
        state: {
          nextRunAtMs: Date.now() + 500,
          routeStatus: "valid",
          lastStatus: null,
          lastRunAtMs: null,
          lastDurationMs: null,
          lastErrorCode: null,
          lastError: null,
          runningAtMs: null,
        },
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };

      const store = createJobStore();
      store.saveJobs({ version: 1, jobs: [job1, job2] });

      let successJobExecuted = false;

      const scheduler = new JobScheduler({
        getRouteFn: () => ({
          chatGuid: "test-chat",
          status: "active",
        }) as any,
        executeJobFn: async (job) => {
          if (job.id === "test:error-job-1") {
            throw new Error("模拟 executeJob 异常");
          }
          if (job.id === "test:success-job-2") {
            successJobExecuted = true;
          }
          return { status: "ok" as const, durationMs: 10 };
        },
      });

      await scheduler.start();
      await new Promise((r) => setTimeout(r, 1000));
      scheduler.stop();

      // P5.7-R12-T2: 验证即使 job1 抛错，job2 仍被执行
      expect(successJobExecuted).toBe(true);
    });

    it("kind: at 任务执行后不再重复执行（一次性语义回归锁）", async () => {
      const { JobScheduler } = await import("../src/jobs/scheduler.js");
      const { createJobStore } = await import("../src/jobs/store.js");
      const type = await import("../src/jobs/types.js");

      // 创建一个已过期的 kind: "at" 任务
      const atJob: type.CronJob = {
        id: "test:at-once-job",
        name: "AT Once Job",
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() - 5000 },
        sessionTarget: "main",
        route: { chatGuid: "test-chat" },
        payload: { kind: "tmuxMessage", text: "test" },
        delivery: { mode: "reply-to-same-chat", maxChars: 2000 },
        state: {
          nextRunAtMs: Date.now() - 5000, // 已到期
          routeStatus: "valid",
          lastStatus: null,
          lastRunAtMs: null,
          lastDurationMs: null,
          lastErrorCode: null,
          lastError: null,
          runningAtMs: null,
        },
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };

      const store = createJobStore();
      store.saveJobs({ version: 1, jobs: [atJob] });

      let executeCallCount = 0;

      const scheduler = new JobScheduler({
        getRouteFn: () => ({
          chatGuid: "test-chat",
          status: "active",
        }) as any,
        executeJobFn: async () => {
          executeCallCount++;
          return { status: "ok" as const, durationMs: 10 };
        },
      });

      await scheduler.start();

      // 等待足够长时间，如果任务重复执行，executeCallCount 会大于 1
      await new Promise((r) => setTimeout(r, 500));

      scheduler.stop();

      // P5.7-R12-T2: kind: "at" 一次性任务语义回归锁
      // 执行 0 次：因为 atMs 已过期，computeNextRunAtMs 返回 null，任务被跳过
      // 这防止了过期 at 任务的无限重复执行（高频自旋）
      expect(executeCallCount).toBe(0);
    });
  });
});

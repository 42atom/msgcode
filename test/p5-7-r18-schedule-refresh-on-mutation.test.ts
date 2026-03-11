/**
 * msgcode: schedule mutation -> jobs -> scheduler 主链回归锁
 *
 * 目标：
 * - add/enable 后 jobs 投影立即带 nextRunAtMs
 * - mutation 后本进程 scheduler 立即 refresh，无需重启
 * - remove/disable 后停止继续触发
 * - workspace 级投影不会误删其他 workspace 的 schedule jobs
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpRoot = "";
let originalRoutesPath: string | undefined;
let originalJobsPath: string | undefined;
let originalRunsPath: string | undefined;
let originalWorkspaceRoot: string | undefined;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-schedule-refresh-"));
  const cronDir = path.join(tmpRoot, "config", "cron");
  await fs.mkdir(cronDir, { recursive: true });

  originalRoutesPath = process.env.ROUTES_FILE_PATH;
  originalJobsPath = process.env.JOBS_FILE_PATH;
  originalRunsPath = process.env.RUNS_FILE_PATH;
  originalWorkspaceRoot = process.env.WORKSPACE_ROOT;

  process.env.ROUTES_FILE_PATH = path.join(tmpRoot, "config", "routes.json");
  process.env.JOBS_FILE_PATH = path.join(cronDir, "jobs.json");
  process.env.RUNS_FILE_PATH = path.join(cronDir, "runs.jsonl");
  process.env.WORKSPACE_ROOT = path.join(tmpRoot, "workspaces");
});

afterEach(async () => {
  const { registerActiveJobScheduler } = await import("../src/jobs/scheduler.js");
  registerActiveJobScheduler(null);

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
  if (originalWorkspaceRoot !== undefined) {
    process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
  } else {
    delete process.env.WORKSPACE_ROOT;
  }

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function createWorkspace(name: string): Promise<string> {
  const workspacePath = path.join(tmpRoot, "workspaces", name);
  await fs.mkdir(path.join(workspacePath, ".msgcode", "schedules"), { recursive: true });
  return workspacePath;
}

async function writeSchedule(
  workspacePath: string,
  scheduleId: string,
  enabled: boolean,
  message: string = "live cron"
): Promise<void> {
  const schedule = {
    version: 1,
    enabled,
    tz: "Asia/Singapore",
    cron: "*/1 * * * * *",
    message,
    delivery: {
      mode: "reply-to-same-chat" as const,
      maxChars: 2000,
    },
  };

  await fs.writeFile(
    path.join(workspacePath, ".msgcode", "schedules", `${scheduleId}.json`),
    JSON.stringify(schedule, null, 2),
    "utf-8"
  );
}

async function readRuns(): Promise<string[]> {
  try {
    const content = await fs.readFile(process.env.RUNS_FILE_PATH!, "utf-8");
    return content.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("P5.7-R18: schedule mutation refresh 主链", () => {
  it("workspace 级投影会保留其他 workspace 的 schedule jobs，且 nextRunAtMs 立即存在", async () => {
    const workspaceA = await createWorkspace("ws-a");
    const workspaceB = await createWorkspace("ws-b");

    await writeSchedule(workspaceA, "cron-a", true, "from a");
    await writeSchedule(workspaceB, "cron-b", true, "from b");

    const { setRoute } = await import("../src/routes/store.js");
    setRoute("chat-a", {
      chatGuid: "chat-a",
      workspacePath: workspaceA,
      label: "ws-a",
      botType: "default",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setRoute("chat-b", {
      chatGuid: "chat-b",
      workspacePath: workspaceB,
      label: "ws-b",
      botType: "default",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { syncWorkspaceSchedulesToJobs } = await import("../src/jobs/schedule-sync.js");
    const { createJobStore } = await import("../src/jobs/store.js");

    await syncWorkspaceSchedulesToJobs(workspaceA, "chat-a");
    await syncWorkspaceSchedulesToJobs(workspaceB, "chat-b");

    const jobs = createJobStore().listJobs();
    const jobA = jobs.find((job) => job.name === "cron-a");
    const jobB = jobs.find((job) => job.name === "cron-b");

    expect(jobA?.state.nextRunAtMs).not.toBeNull();
    expect(jobB?.state.nextRunAtMs).not.toBeNull();

    await writeSchedule(workspaceA, "cron-a-2", true, "from a 2");
    await syncWorkspaceSchedulesToJobs(workspaceA, "chat-a");

    const jobsAfter = createJobStore().listJobs();
    expect(jobsAfter.some((job) => job.name === "cron-b")).toBe(true);
    expect(jobsAfter.some((job) => job.name === "cron-a-2")).toBe(true);
  });

  it("add 后会本地 refresh scheduler，并在下一秒真实执行", async () => {
    const workspacePath = await createWorkspace("ws-add");
    const { setRoute, getRouteByChatId } = await import("../src/routes/store.js");
    const { JobScheduler, registerActiveJobScheduler } = await import("../src/jobs/scheduler.js");
    const { createJobStore } = await import("../src/jobs/store.js");
    const { handleScheduleAddCommand } = await import("../src/routes/cmd-schedule.js");

    setRoute("chat-add", {
      chatGuid: "chat-add",
      workspacePath,
      label: "ws-add",
      botType: "default",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let executeCount = 0;
    const scheduler = new JobScheduler({
      getRouteFn: getRouteByChatId,
      executeJobFn: async () => {
        executeCount += 1;
        return { status: "ok" as const, durationMs: 1 };
      },
    });
    registerActiveJobScheduler(scheduler);
    await scheduler.start();

    try {
      const result = await handleScheduleAddCommand({
        chatId: "chat-add",
        args: [
          "live-cron",
          "--workspace",
          workspacePath,
          "--cron",
          "*/1 * * * * *",
          "--tz",
          "Asia/Singapore",
          "--message",
          "live cron",
        ],
        botType: "default",
        projectDir: workspacePath,
        groupName: undefined,
        originalMessage: {} as any,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("调度刷新：local");

      const job = createJobStore().listJobs().find((item) => item.name === "live-cron");
      expect(job?.state.nextRunAtMs).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 1600));
      expect(executeCount).toBeGreaterThan(0);

      const runs = await readRuns();
      expect(runs.some((line) => line.includes("\"jobId\"") && line.includes("live-cron"))).toBe(true);
    } finally {
      scheduler.stop();
      registerActiveJobScheduler(null);
    }
  });

  it("enable/disable 会触发同一条 refresh 主链，disable 后不再继续执行", async () => {
    const workspacePath = await createWorkspace("ws-toggle");
    await writeSchedule(workspacePath, "toggle-cron", false, "toggle cron");

    const { setRoute, getRouteByChatId } = await import("../src/routes/store.js");
    const { JobScheduler, registerActiveJobScheduler } = await import("../src/jobs/scheduler.js");
    const { createJobStore } = await import("../src/jobs/store.js");
    const {
      handleScheduleEnableCommand,
      handleScheduleDisableCommand,
    } = await import("../src/routes/cmd-schedule.js");

    setRoute("chat-toggle", {
      chatGuid: "chat-toggle",
      workspacePath,
      label: "ws-toggle",
      botType: "default",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let executeCount = 0;
    const scheduler = new JobScheduler({
      getRouteFn: getRouteByChatId,
      executeJobFn: async () => {
        executeCount += 1;
        return { status: "ok" as const, durationMs: 1 };
      },
    });
    registerActiveJobScheduler(scheduler);
    await scheduler.start();

    try {
      const enableResult = await handleScheduleEnableCommand({
        chatId: "chat-toggle",
        args: ["toggle-cron"],
        botType: "default",
        projectDir: workspacePath,
        groupName: undefined,
        originalMessage: {} as any,
      });

      expect(enableResult.success).toBe(true);
      expect(enableResult.message).toContain("调度刷新：local");

      const jobAfterEnable = createJobStore().listJobs().find((item) => item.name === "toggle-cron");
      expect(jobAfterEnable?.state.nextRunAtMs).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 1600));
      expect(executeCount).toBeGreaterThan(0);

      const disableResult = await handleScheduleDisableCommand({
        chatId: "chat-toggle",
        args: ["toggle-cron"],
        botType: "default",
        projectDir: workspacePath,
        groupName: undefined,
        originalMessage: {} as any,
      });

      expect(disableResult.success).toBe(true);
      expect(disableResult.message).toContain("调度刷新：local");
      expect(createJobStore().listJobs().some((item) => item.name === "toggle-cron")).toBe(false);

      const executedBeforeWait = executeCount;
      await new Promise((resolve) => setTimeout(resolve, 1600));
      expect(executeCount).toBe(executedBeforeWait);
    } finally {
      scheduler.stop();
      registerActiveJobScheduler(null);
    }
  });

  it("remove 后投影立即消失，下一秒不再继续触发", async () => {
    const workspacePath = await createWorkspace("ws-remove");
    const { setRoute, getRouteByChatId } = await import("../src/routes/store.js");
    const { JobScheduler, registerActiveJobScheduler } = await import("../src/jobs/scheduler.js");
    const { createJobStore } = await import("../src/jobs/store.js");
    const {
      handleScheduleAddCommand,
      handleScheduleRemoveCommand,
    } = await import("../src/routes/cmd-schedule.js");

    setRoute("chat-remove", {
      chatGuid: "chat-remove",
      workspacePath,
      label: "ws-remove",
      botType: "default",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let executeCount = 0;
    const scheduler = new JobScheduler({
      getRouteFn: getRouteByChatId,
      executeJobFn: async () => {
        executeCount += 1;
        return { status: "ok" as const, durationMs: 1 };
      },
    });
    registerActiveJobScheduler(scheduler);
    await scheduler.start();

    try {
      const addResult = await handleScheduleAddCommand({
        chatId: "chat-remove",
        args: [
          "remove-cron",
          "--workspace",
          workspacePath,
          "--cron",
          "*/1 * * * * *",
          "--tz",
          "Asia/Singapore",
          "--message",
          "remove cron",
        ],
        botType: "default",
        projectDir: workspacePath,
        groupName: undefined,
        originalMessage: {} as any,
      });
      expect(addResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 1600));
      expect(executeCount).toBeGreaterThan(0);

      const removeResult = await handleScheduleRemoveCommand({
        chatId: "chat-remove",
        args: ["remove-cron", "--workspace", workspacePath],
        botType: "default",
        projectDir: workspacePath,
        groupName: undefined,
        originalMessage: {} as any,
      });

      expect(removeResult.success).toBe(true);
      expect(removeResult.message).toContain("调度刷新：local");
      expect(createJobStore().listJobs().some((item) => item.name === "remove-cron")).toBe(false);

      const executedBeforeWait = executeCount;
      await new Promise((resolve) => setTimeout(resolve, 1600));
      expect(executeCount).toBe(executedBeforeWait);
    } finally {
      scheduler.stop();
      registerActiveJobScheduler(null);
    }
  });
});

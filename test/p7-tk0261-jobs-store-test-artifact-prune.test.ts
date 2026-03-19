import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpRoot = "";
let originalRoutesPath: string | undefined;
let originalJobsPath: string | undefined;
let originalRunsPath: string | undefined;
let originalWorkspaceRoot: string | undefined;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-tk0261-"));
  const configDir = path.join(tmpRoot, "config");
  const cronDir = path.join(configDir, "cron");
  const workspacesDir = path.join(tmpRoot, "workspaces");
  await fs.mkdir(cronDir, { recursive: true });
  await fs.mkdir(workspacesDir, { recursive: true });

  originalRoutesPath = process.env.ROUTES_FILE_PATH;
  originalJobsPath = process.env.JOBS_FILE_PATH;
  originalRunsPath = process.env.RUNS_FILE_PATH;
  originalWorkspaceRoot = process.env.WORKSPACE_ROOT;

  process.env.ROUTES_FILE_PATH = path.join(configDir, "routes.json");
  process.env.JOBS_FILE_PATH = path.join(cronDir, "jobs.json");
  process.env.RUNS_FILE_PATH = path.join(cronDir, "runs.jsonl");
  process.env.WORKSPACE_ROOT = workspacesDir;
});

afterEach(async () => {
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

describe("tk0261: jobs store test artifact prune", () => {
  it("会删除没有 route 真相的明显测试 job", async () => {
    const { createJobStore, pruneObviousTestOnlyJobs } = await import("../src/jobs/store.js");

    const store = createJobStore();
    store.saveJobs({
      version: 1,
      jobs: [
        {
          id: "test:job",
          name: "Test Job",
          enabled: true,
          schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
          route: { chatGuid: "test-chat" },
          sessionTarget: "main",
          payload: { kind: "tmuxMessage", text: "test" },
          delivery: { mode: "reply-to-same-chat", maxChars: 2000 },
          state: {
            routeStatus: "orphaned",
            nextRunAtMs: null,
            runningAtMs: null,
            lastRunAtMs: null,
            lastStatus: "pending",
            lastErrorCode: null,
            lastError: null,
            lastDurationMs: null,
          },
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        },
        {
          id: "schedule:keep-me",
          name: "Real Job",
          enabled: true,
          schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
          route: { chatGuid: "feishu:oc_real" },
          sessionTarget: "main",
          payload: { kind: "chatMessage", text: "keep" },
          delivery: { mode: "reply-to-same-chat", maxChars: 2000 },
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
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        },
      ],
    });

    const removed = pruneObviousTestOnlyJobs();
    const jobsAfter = store.listJobs();

    expect(removed).toBe(1);
    expect(jobsAfter.map((job) => job.id)).toEqual(["schedule:keep-me"]);
  });

  it("不会删除仍有 route 真相的测试 job", async () => {
    const workspacePath = path.join(tmpRoot, "workspaces", "test");
    await fs.mkdir(workspacePath, { recursive: true });

    const { setRoute } = await import("../src/routes/store.js");
    const { createJobStore, pruneObviousTestOnlyJobs } = await import("../src/jobs/store.js");

    setRoute("test-chat", {
      chatGuid: "test-chat",
      workspacePath,
      label: "test",
      botType: "default",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const store = createJobStore();
    store.saveJobs({
      version: 1,
      jobs: [
        {
          id: "test:job",
          name: "Test Job",
          enabled: true,
          schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
          route: { chatGuid: "test-chat" },
          sessionTarget: "main",
          payload: { kind: "tmuxMessage", text: "test" },
          delivery: { mode: "reply-to-same-chat", maxChars: 2000 },
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
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        },
      ],
    });

    const removed = pruneObviousTestOnlyJobs();
    const jobsAfter = store.listJobs();

    expect(removed).toBe(0);
    expect(jobsAfter.map((job) => job.id)).toEqual(["test:job"]);
  });
});

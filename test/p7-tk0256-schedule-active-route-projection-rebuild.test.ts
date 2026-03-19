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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-tk0256-"));
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

describe("tk0256: schedule active route projection rebuild", () => {
  it("会按 active route 真相重建 schedule jobs，并清掉错误 workspace hash 的旧投影", async () => {
    const familyWorkspace = await createWorkspace("family");
    const defaultWorkspace = await createWorkspace("default");

    await fs.writeFile(
      path.join(familyWorkspace, ".msgcode", "schedules", "pick-up-kids.json"),
      JSON.stringify(
        {
          version: 1,
          enabled: true,
          tz: "Asia/Shanghai",
          cron: "0 45 11 ? * MON-FRI",
          message: "1:45了该接小孩了",
          delivery: {
            mode: "reply-to-same-chat",
            maxChars: 2000,
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const { setRoute } = await import("../src/routes/store.js");
    const {
      createJobStore,
    } = await import("../src/jobs/store.js");
    const {
      getWorkspaceScheduleJobId,
      rebuildActiveRouteScheduleJobs,
    } = await import("../src/jobs/schedule-sync.js");

    setRoute("feishu:oc_family", {
      chatGuid: "feishu:oc_family",
      workspacePath: familyWorkspace,
      label: "family",
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
          id: getWorkspaceScheduleJobId(defaultWorkspace, "pick-up-kids"),
          enabled: true,
          name: "pick-up-kids",
          description: "stale wrong hash job",
          route: { chatGuid: "feishu:oc_family" },
          schedule: {
            kind: "cron",
            expr: "0 45 11 ? * MON-FRI",
            tz: "Asia/Shanghai",
          },
          sessionTarget: "main",
          payload: {
            kind: "agentPrompt",
            text: "stale prompt",
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
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        },
        {
          id: "manual:keep-me",
          enabled: true,
          name: "manual-keep",
          route: { chatGuid: "feishu:oc_family" },
          schedule: {
            kind: "cron",
            expr: "0 9 * * *",
            tz: "UTC",
          },
          sessionTarget: "main",
          payload: {
            kind: "tmuxMessage",
            text: "keep me",
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
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        },
      ],
    });

    const rebuiltJobs = await rebuildActiveRouteScheduleJobs();
    const allJobs = store.listJobs();
    const correctJobId = getWorkspaceScheduleJobId(familyWorkspace, "pick-up-kids");
    const staleJobId = getWorkspaceScheduleJobId(defaultWorkspace, "pick-up-kids");

    expect(rebuiltJobs.map((job) => job.id)).toEqual([correctJobId]);
    expect(allJobs.some((job) => job.id === staleJobId)).toBe(false);
    expect(allJobs.some((job) => job.id === "manual:keep-me")).toBe(true);

    const rebuiltJob = allJobs.find((job) => job.id === correctJobId);
    expect(rebuiltJob?.payload.kind).toBe("chatMessage");
    expect(rebuiltJob?.route.chatGuid).toBe("feishu:oc_family");
  });
});

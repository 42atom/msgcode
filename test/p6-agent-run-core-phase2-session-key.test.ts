import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readRunRecords(runsPath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(runsPath)) {
    return [];
  }

  const content = fs.readFileSync(runsPath, "utf-8").trim();
  if (!content) {
    return [];
  }

  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function writeActiveRoute(routePath: string, chatGuid: string, workspacePath: string): void {
  fs.mkdirSync(path.dirname(routePath), { recursive: true });
  fs.writeFileSync(
    routePath,
    JSON.stringify(
      {
        version: 1,
        routes: {
          [chatGuid]: {
            chatGuid,
            workspacePath,
            botType: "default",
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      null,
      2
    ),
    "utf-8"
  );
}

describe("Phase 2: Run Core Session Key", () => {
  let tmpDir = "";
  let runsPath = "";
  let routePath = "";

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-session-key-");
    runsPath = path.join(tmpDir, "run-core", "runs.jsonl");
    routePath = path.join(tmpDir, "routes.json");

    process.env.MSGCODE_RUNS_FILE_PATH = runsPath;
    process.env.ROUTES_FILE_PATH = routePath;

    const { resetRunStoreForTest } = await import("../src/runtime/run-store.js");
    resetRunStoreForTest();
  });

  afterEach(async () => {
    const { resetRunStoreForTest } = await import("../src/runtime/run-store.js");
    resetRunStoreForTest();

    delete process.env.MSGCODE_RUNS_FILE_PATH;
    delete process.env.ROUTES_FILE_PATH;

    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("session resolver 应把 chatId/workspace/source 收口为稳定 sessionKey，而不是 chatId 别名", async () => {
    const { resolveSession } = await import("../src/runtime/session-key.js");

    const workspacePath = path.join(tmpDir, "workspace-stable");
    fs.mkdirSync(workspacePath, { recursive: true });

    const messageSession = resolveSession({
      source: "message",
      chatId: "any;+;chat-session-stable-1",
      workspacePath,
    });
    const heartbeatSession = resolveSession({
      source: "heartbeat",
      chatId: "chat-session-stable-1",
      workspacePath,
    });

    expect(messageSession.sessionKey).toBe(heartbeatSession.sessionKey);
    expect(messageSession.sessionKey).not.toBe("any;+;chat-session-stable-1");
    expect(messageSession.sessionKey).toContain("session:v1:imessage:");
  });

  it("每条 run lifecycle 记录都应包含稳定 sessionKey", async () => {
    const { beginRun } = await import("../src/runtime/run-store.js");

    const workspacePath = path.join(tmpDir, "workspace-light");
    fs.mkdirSync(workspacePath, { recursive: true });

    const run = beginRun({
      source: "message",
      kind: "light",
      chatId: "any;+;chat-light-session-1",
      workspacePath,
    });
    run.finish({ status: "completed" });

    const records = readRunRecords(runsPath);
    expect(records).toHaveLength(3);
    expect(records.every((record) => typeof record.sessionKey === "string" && String(record.sessionKey).length > 0)).toBe(true);
    expect(new Set(records.map((record) => record.sessionKey)).size).toBe(1);
    expect(records[0]?.sessionKey).not.toBe("any;+;chat-light-session-1");
  });

  it("同一 chat 的 message/task/heartbeat/schedule 应关联到同一 sessionKey", async () => {
    const { beginRun } = await import("../src/runtime/run-store.js");
    const { handleTaskRun } = await import("../src/routes/cmd-task-impl.js");
    const { TaskSupervisor } = await import("../src/runtime/task-supervisor.js");
    const { executeJob } = await import("../src/jobs/runner.js");

    const chatGuid = "any;+;chat-session-main-1";
    const workspacePath = path.join(tmpDir, "workspace-main");
    fs.mkdirSync(workspacePath, { recursive: true });
    writeActiveRoute(routePath, chatGuid, workspacePath);

    const messageRun = beginRun({
      source: "message",
      kind: "light",
      chatId: chatGuid,
      workspacePath,
    });
    messageRun.finish({ status: "completed" });

    const taskRoute = {
      chatGuid,
      workspacePath,
      botType: "default" as const,
      status: "active" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await handleTaskRun(
      "整理项目状态",
      taskRoute,
      {
        createTask: async () => ({
          ok: true as const,
          task: {
            taskId: "task-session-001",
            goal: "整理项目状态",
            status: "pending",
          },
        }),
      } as unknown as import("../src/runtime/task-supervisor.js").TaskSupervisor
    );

    const supervisor = new TaskSupervisor({
      taskDir: path.join(tmpDir, "tasks"),
      eventQueueDir: path.join(tmpDir, "events"),
      heartbeatIntervalMs: 0,
      executeTaskTurn: async () => ({
        answer: "任务已完成",
        actionJournal: [],
        verifyResult: {
          ok: true,
          evidence: JSON.stringify({ ok: true }),
        },
      }),
    });

    await supervisor.start();
    const created = await supervisor.createTask(chatGuid, workspacePath, "继续推进");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error);
    }
    await supervisor.handleHeartbeatTick({
      tickId: "tick-session-main-1",
      reason: "manual",
      startTime: Date.now(),
    });
    await supervisor.stop();

    const result = await executeJob(
      {
        id: "job-session-main-1",
        enabled: true,
        name: "main-session",
        route: { chatGuid },
        schedule: { kind: "cron" as const, expr: "*/5 * * * *", tz: "Asia/Singapore" },
        sessionTarget: "main" as const,
        payload: {
          kind: "chatMessage" as const,
          text: "早上好",
          chatGuid,
        },
        delivery: {
          mode: "reply-to-same-chat" as const,
          bestEffort: true,
          maxChars: 200,
        },
        state: {
          routeStatus: "valid" as const,
          nextRunAtMs: null,
          runningAtMs: null,
          lastRunAtMs: null,
          lastStatus: "pending" as const,
          lastErrorCode: null,
          lastError: null,
          lastDurationMs: null,
        },
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
      {
        imsgSend: async () => undefined,
      }
    );

    expect(result.status).toBe("ok");

    const completedBySource = new Map(
      readRunRecords(runsPath)
        .filter((record) => record.status === "completed")
        .map((record) => [String(record.source), record])
    );

    expect(completedBySource.size).toBe(4);
    expect(new Set([...completedBySource.values()].map((record) => record.sessionKey)).size).toBe(1);
    expect(completedBySource.get("message")?.sessionKey).toBe(completedBySource.get("task")?.sessionKey);
    expect(completedBySource.get("task")?.sessionKey).toBe(completedBySource.get("heartbeat")?.sessionKey);
    expect(completedBySource.get("heartbeat")?.sessionKey).toBe(completedBySource.get("schedule")?.sessionKey);
  });

  it("schedule 缺 route 时应使用 orphan sessionKey fail-closed，而不是猜工作区", async () => {
    const { executeJob } = await import("../src/jobs/runner.js");

    const job = {
      id: "job-session-orphan-1",
      enabled: true,
      name: "missing-route",
      route: { chatGuid: "any;+;chat-session-orphan-1" },
      schedule: { kind: "cron" as const, expr: "*/5 * * * *", tz: "Asia/Singapore" },
      sessionTarget: "main" as const,
      payload: {
        kind: "chatMessage" as const,
        text: "不会真正发送",
        chatGuid: "any;+;chat-session-orphan-1",
      },
      delivery: {
        mode: "reply-to-same-chat" as const,
        bestEffort: true,
        maxChars: 200,
      },
      state: {
        routeStatus: "valid" as const,
        nextRunAtMs: null,
        runningAtMs: null,
        lastRunAtMs: null,
        lastStatus: "pending" as const,
        lastErrorCode: null,
        lastError: null,
        lastDurationMs: null,
      },
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };

    const result = await executeJob(job, {
      imsgSend: async () => undefined,
    });

    expect(result.status).toBe("skipped");

    const scheduleRecords = readRunRecords(runsPath).filter(
      (record) => record.triggerId === "job-session-orphan-1"
    );

    expect(scheduleRecords.map((record) => record.status)).toEqual([
      "accepted",
      "running",
      "failed",
    ]);
    expect(new Set(scheduleRecords.map((record) => record.sessionKey)).size).toBe(1);
    expect(String(scheduleRecords[0]?.sessionKey)).toEndWith(":orphan");
  });
});

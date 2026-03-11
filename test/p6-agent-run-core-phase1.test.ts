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

describe("Phase 1: Run Core", () => {
  let tmpDir = "";
  let runsPath = "";

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-run-core-");
    runsPath = path.join(tmpDir, "run-core", "runs.jsonl");
    process.env.MSGCODE_RUNS_FILE_PATH = runsPath;
    delete process.env.ROUTES_FILE_PATH;

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

  it("RunStore 应为一次轻量执行写入 accepted/running/completed", async () => {
    const { beginRun } = await import("../src/runtime/run-store.js");

    const run = beginRun({
      source: "message",
      kind: "light",
      chatId: "chat-light-1",
    });
    run.finish({ status: "completed" });

    const records = readRunRecords(runsPath);
    expect(records.map((record) => record.status)).toEqual([
      "accepted",
      "running",
      "completed",
    ]);
    expect(records[0]?.runId).toBe(records[2]?.runId);
    expect(records[2]?.source).toBe("message");
    expect(records[2]?.kind).toBe("light");
    expect(Number(records[2]?.endedAt)).toBeGreaterThanOrEqual(Number(records[2]?.startedAt));
  });

  it("/task run 应创建 source=task 的 run 记录", async () => {
    const { handleTaskRun } = await import("../src/routes/cmd-task-impl.js");

    const route = {
      chatGuid: "chat-task-1",
      workspacePath: path.join(tmpDir, "workspace-task"),
      botType: "default" as const,
      status: "active" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const supervisor = {
      createTask: async () => ({
        ok: true as const,
        task: {
          taskId: "task-001",
          goal: "整理日报",
          status: "pending",
        },
      }),
    };

    const result = await handleTaskRun(
      "整理日报",
      route,
      supervisor as unknown as import("../src/runtime/task-supervisor.js").TaskSupervisor
    );

    expect(result.ok).toBe(true);

    const records = readRunRecords(runsPath).filter((record) => record.source === "task");
    expect(records.map((record) => record.status)).toEqual([
      "accepted",
      "running",
      "completed",
    ]);
    expect(records[2]?.taskId).toBe("task-001");
  });

  it("heartbeat 续跑任务时应创建 source=heartbeat 的 run，并把 runId 透传给执行器", async () => {
    const { TaskSupervisor } = await import("../src/runtime/task-supervisor.js");

    let observedContext:
      | import("../src/runtime/task-types.js").TaskTurnContext
      | undefined;

    const workspacePath = path.join(tmpDir, "workspace-heartbeat");
    fs.mkdirSync(workspacePath, { recursive: true });

    const supervisor = new TaskSupervisor({
      taskDir: path.join(tmpDir, "tasks"),
      eventQueueDir: path.join(tmpDir, "events"),
      heartbeatIntervalMs: 0,
      executeTaskTurn: async (_task, context) => {
        observedContext = context;
        return {
          answer: "任务已完成",
          actionJournal: [],
          verifyResult: {
            ok: true,
            evidence: JSON.stringify({ ok: true }),
          },
        };
      },
    });

    await supervisor.start();
    const created = await supervisor.createTask("chat-heartbeat-1", workspacePath, "继续推进任务");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error);
    }

    await supervisor.handleHeartbeatTick({
      tickId: "tick-heartbeat-1",
      reason: "manual",
      startTime: Date.now(),
    });

    const heartbeatRecords = readRunRecords(runsPath).filter((record) => record.source === "heartbeat");
    expect(heartbeatRecords.map((record) => record.status)).toEqual([
      "accepted",
      "running",
      "completed",
    ]);
    expect(observedContext?.source).toBe("heartbeat");
    expect(observedContext?.runId).toBe(heartbeatRecords[0]?.runId);
    expect(observedContext?.sessionKey).toBe(heartbeatRecords[0]?.sessionKey);
    expect(heartbeatRecords[0]?.taskId).toBe(created.task.taskId);
    expect(heartbeatRecords[0]?.triggerId).toBe("tick-heartbeat-1");
  });

  it("schedule 执行应创建 source=schedule 的 run 记录", async () => {
    const routePath = path.join(tmpDir, "routes.json");
    process.env.ROUTES_FILE_PATH = routePath;

    const workspacePath = path.join(tmpDir, "workspace-schedule");
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(
      routePath,
      JSON.stringify({
        version: 1,
        routes: {
          "chat-schedule-1": {
            chatGuid: "chat-schedule-1",
            workspacePath,
            botType: "default",
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      }),
      "utf-8"
    );

    const { executeJob } = await import("../src/jobs/runner.js");

    const job = {
      id: "job-schedule-1",
      enabled: true,
      name: "morning-summary",
      route: { chatGuid: "chat-schedule-1" },
      schedule: { kind: "cron" as const, expr: "*/5 * * * *", tz: "Asia/Singapore" },
      sessionTarget: "main" as const,
      payload: {
        kind: "chatMessage" as const,
        text: "早上九点提醒",
        chatGuid: "chat-schedule-1",
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
      sendReply: async () => undefined,
    });

    expect(result.status).toBe("ok");

    const scheduleRecords = readRunRecords(runsPath).filter((record) => record.source === "schedule");
    expect(scheduleRecords.map((record) => record.status)).toEqual([
      "accepted",
      "running",
      "completed",
    ]);
    expect(scheduleRecords[0]?.triggerId).toBe("job-schedule-1");
  });

  it("schedule skipped 不应伪装成 completed", async () => {
    const { executeJob } = await import("../src/jobs/runner.js");

    const job = {
      id: "job-schedule-missing-route",
      enabled: true,
      name: "missing-route",
      route: { chatGuid: "chat-schedule-missing" },
      schedule: { kind: "cron" as const, expr: "*/5 * * * *", tz: "Asia/Singapore" },
      sessionTarget: "main" as const,
      payload: {
        kind: "chatMessage" as const,
        text: "不会真正发送",
        chatGuid: "chat-schedule-missing",
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
      sendReply: async () => undefined,
    });

    expect(result.status).toBe("skipped");

    const scheduleRecords = readRunRecords(runsPath).filter(
      (record) => record.triggerId === "job-schedule-missing-route"
    );
    expect(scheduleRecords.map((record) => record.status)).toEqual([
      "accepted",
      "running",
      "failed",
    ]);
    expect(scheduleRecords[2]?.error).toBe("路由不存在: chat-schedule-missing");
  });

  it("普通消息链应在 handlers 中创建 light run，并把 runId 收口为 traceId", () => {
    const handlersCode = fs.readFileSync(
      path.join(process.cwd(), "src/handlers.ts"),
      "utf-8"
    );

    expect(handlersCode).toContain("const run = beginRun({");
    expect(handlersCode).toContain('source: "message"');
    expect(handlersCode).toContain("const traceId = run.runId;");
  });
});

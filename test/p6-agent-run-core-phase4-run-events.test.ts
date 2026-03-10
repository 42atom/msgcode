import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJsonlRecords(filePath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8").trim();
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

describe("Phase 4: Run Events", () => {
  let tmpDir = "";
  let runsPath = "";
  let eventsPath = "";
  let routePath = "";

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-run-events-");
    runsPath = path.join(tmpDir, "run-core", "runs.jsonl");
    eventsPath = path.join(tmpDir, "run-core", "run-events.jsonl");
    routePath = path.join(tmpDir, "routes.json");

    process.env.MSGCODE_RUNS_FILE_PATH = runsPath;
    process.env.MSGCODE_RUN_EVENTS_FILE_PATH = eventsPath;
    process.env.ROUTES_FILE_PATH = routePath;

    const { resetRunStoreForTest } = await import("../src/runtime/run-store.js");
    const { resetRunEventStoreForTest } = await import("../src/runtime/run-events.js");
    resetRunStoreForTest();
    resetRunEventStoreForTest();
  });

  afterEach(async () => {
    const { resetRunStoreForTest } = await import("../src/runtime/run-store.js");
    const { resetRunEventStoreForTest } = await import("../src/runtime/run-events.js");
    resetRunStoreForTest();
    resetRunEventStoreForTest();

    delete process.env.MSGCODE_RUNS_FILE_PATH;
    delete process.env.MSGCODE_RUN_EVENTS_FILE_PATH;
    delete process.env.ROUTES_FILE_PATH;

    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("RunStore 应自动发 run:start / run:end，失败时补 run:error", async () => {
    const { beginRun } = await import("../src/runtime/run-store.js");

    const completedRun = beginRun({
      source: "message",
      kind: "light",
      chatId: "chat-phase4-completed",
    });
    completedRun.finish({ status: "completed" });

    const failedRun = beginRun({
      source: "schedule",
      kind: "light",
      chatId: "chat-phase4-failed",
      triggerId: "job-phase4-failed",
    });
    failedRun.finish({
      status: "failed",
      error: "route missing",
    });

    const eventTypes = readJsonlRecords(eventsPath).map((record) => record.type);
    expect(eventTypes).toEqual([
      "run:start",
      "run:end",
      "run:start",
      "run:error",
      "run:end",
    ]);
  });

  it("message / task / heartbeat / schedule 应进入同一个 run events 文件，并带最小字段", async () => {
    const { beginRun } = await import("../src/runtime/run-store.js");
    const { handleTaskRun } = await import("../src/routes/cmd-task-impl.js");
    const { TaskSupervisor } = await import("../src/runtime/task-supervisor.js");
    const { executeJob } = await import("../src/jobs/runner.js");

    const workspacePath = path.join(tmpDir, "workspace-main");
    fs.mkdirSync(workspacePath, { recursive: true });
    writeActiveRoute(routePath, "chat-phase4-main", workspacePath);

    const messageRun = beginRun({
      source: "message",
      kind: "light",
      chatId: "chat-phase4-main",
      workspacePath,
    });
    messageRun.finish({ status: "completed" });

    await handleTaskRun(
      "整理 Phase 4 事件",
      {
        chatGuid: "chat-phase4-main",
        workspacePath,
        botType: "default" as const,
        status: "active" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        createTask: async () => ({
          ok: true as const,
          task: {
            taskId: "task-phase4-main",
            goal: "整理 Phase 4 事件",
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
    const created = await supervisor.createTask("chat-phase4-main", workspacePath, "继续推进");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error);
    }
    await supervisor.handleHeartbeatTick({
      tickId: "tick-phase4-main",
      reason: "manual",
      startTime: Date.now(),
    });
    await supervisor.stop();

    const result = await executeJob(
      {
        id: "job-phase4-main",
        enabled: true,
        name: "phase4-main",
        route: { chatGuid: "chat-phase4-main" },
        schedule: { kind: "cron" as const, expr: "*/5 * * * *", tz: "Asia/Singapore" },
        sessionTarget: "main" as const,
        payload: {
          kind: "chatMessage" as const,
          text: "早上好",
          chatGuid: "chat-phase4-main",
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

    const events = readJsonlRecords(eventsPath);
    expect(events.every((record) =>
      typeof record.runId === "string" &&
      typeof record.sessionKey === "string" &&
      typeof record.source === "string" &&
      typeof record.type === "string" &&
      typeof record.timestamp === "number"
    )).toBe(true);

    const startSources = new Set(
      events
        .filter((record) => record.type === "run:start")
        .map((record) => String(record.source))
    );

    expect(startSources).toEqual(new Set(["message", "task", "heartbeat", "schedule"]));
  });

  it("tool-loop 事件应统一发 run:tool / run:assistant / run:block", async () => {
    const { emitToolLoopRunEvents } = await import("../src/runtime/run-events.js");

    emitToolLoopRunEvents({
      runId: "run-phase4-tool-loop",
      sessionKey: "session:v1:test:tool-loop",
      source: "task",
      answer: "工具执行完毕，但 verify 要求人工复核。",
      route: "tool",
      actionJournal: [
        {
          traceId: "run-phase4-tool-loop",
          stepId: 1,
          phase: "act",
          timestamp: Date.now(),
          route: "tool",
          tool: "read_file",
          ok: true,
          durationMs: 12,
        },
        {
          traceId: "run-phase4-tool-loop",
          stepId: 2,
          phase: "act",
          timestamp: Date.now() + 1,
          route: "tool",
          tool: "bash",
          ok: false,
          durationMs: 18,
          errorCode: "TOOL_TIMEOUT",
          exitCode: 124,
        },
      ],
      verifyResult: {
        ok: false,
        failureReason: "验证证据不足",
        errorCode: "TOOL_VERIFY_FAILED",
      },
    });

    const types = readJsonlRecords(eventsPath).map((record) => record.type);
    expect(types).toEqual([
      "run:tool",
      "run:tool",
      "run:assistant",
      "run:block",
    ]);

    const blockEvent = readJsonlRecords(eventsPath).find((record) => record.type === "run:block");
    expect(blockEvent?.errorCode).toBe("TOOL_VERIFY_FAILED");
  });

  it("handlers.ts 与 commands.ts 必须把 runContext 透传给 executeAgentTurn", () => {
    const handlersCode = fs.readFileSync(
      path.join(process.cwd(), "src/handlers.ts"),
      "utf-8"
    );
    const commandsCode = fs.readFileSync(
      path.join(process.cwd(), "src/commands.ts"),
      "utf-8"
    );

    expect(handlersCode).toContain("runContext: {");
    expect(handlersCode).toContain("runId: run.runId");
    expect(handlersCode).toContain("sessionKey: run.sessionKey");
    expect(handlersCode).toContain('source: "message"');

    expect(commandsCode).toContain("runContext: {");
    expect(commandsCode).toContain("runId: runContext.runId");
    expect(commandsCode).toContain("sessionKey: runContext.sessionKey");
    expect(commandsCode).toContain("source: runContext.source");
  });
});

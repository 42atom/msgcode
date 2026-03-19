import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { RouteEntry } from "../src/routes/store.js";
import { handleTaskRun } from "../src/routes/cmd-task-impl.js";
import { TaskSupervisor } from "../src/runtime/task-supervisor.js";
import type { TickContext } from "../src/runtime/heartbeat.js";
import { assembleAgentContext } from "../src/runtime/context-policy.js";
import { executeAgentTurn } from "../src/agent-backend/index.js";
import { appendWindow } from "../src/session-window.js";
import { saveSummary } from "../src/summary.js";

function asJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createTempDir(): string {
  const dir = path.join(tmpdir(), `msgcode-workstate-smoke-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeRoute(workspacePath: string, chatGuid = `chat-${randomUUID()}`): RouteEntry {
  const now = new Date().toISOString();
  return {
    chatGuid,
    workspacePath,
    status: "active",
    createdAt: now,
    updatedAt: now,
    botType: "agent-backend",
    label: "workstate-smoke",
  };
}

function makeTick(reason: "manual" | "interval" = "manual"): TickContext {
  return {
    tickId: randomUUID().slice(0, 8),
    reason,
    startTime: Date.now(),
  };
}

describe("tk0278: workstate task-heartbeat smoke", () => {
  let tmpDir = "";
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tmpDir = createTempDir();
    originalFetch = globalThis.fetch;
    process.env.AGENT_MODEL = "unit-test-model";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.AGENT_MODEL;
    cleanupTempDir(tmpDir);
  });

  it("/task run -> continuable -> heartbeat 下一轮 应通过真实主链读回 WORKSTATE", async () => {
    const workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(path.join(workspacePath, ".msgcode", "workstates"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["bash", "read_file"],
        "tooling.require_confirm": [],
      }, null, 2),
      "utf8"
    );

    let callCount = 0;
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return asJsonResponse({
        choices: [{
          message: {
            role: "assistant",
            content: "heartbeat 已按 workstate 恢复。",
          },
        }],
      });
    }) as typeof fetch;

    const executeTaskTurn = async (task: { taskId: string; chatId: string; workspacePath: string; goal: string; checkpoint?: any }, ctx: { runId: string; sessionKey: string; source: "task" | "heartbeat" }) => {
      callCount += 1;

      if (callCount === 1) {
        fs.writeFileSync(
          path.join(task.workspacePath, ".msgcode", "workstates", `${task.taskId}.md`),
          [
            "# Current Intent",
            "先恢复当前工作骨架，再决定是否继续执行。",
            "",
            "# Rejected Hypotheses",
            "- 只靠 summary 就够了。",
            "",
            "# Next Step",
            "- heartbeat 下一轮优先读取 WORKSTATE。",
            "",
          ].join("\n"),
          "utf8"
        );

        await appendWindow(task.workspacePath, task.chatId, {
          role: "user",
          content: "上一轮已经进入长任务恢复阶段。",
        });
        await saveSummary(task.workspacePath, task.chatId, {
          goal: ["验证 heartbeat 续跑会真实读回 WORKSTATE"],
          constraints: ["不要猜 taskId"],
          decisions: [],
          openItems: [],
          toolFacts: [],
        });

        return {
          answer: "本轮写下 WORKSTATE，下一轮继续",
          actionJournal: [],
          continuable: true,
          quotaProfile: "balanced" as const,
          perTurnToolCallLimit: 16,
          perTurnToolStepLimit: 48,
          remainingToolCalls: 0,
          remainingSteps: 12,
          continuationReason: "reached_profile_limit_tool_calls_16_limit_16",
          toolCall: {
            name: "bash",
            args: { command: "printf workstate-written" },
            result: { exitCode: 0 },
          },
        };
      }

      const assembled = await assembleAgentContext({
        source: ctx.source,
        chatId: task.chatId,
        prompt: task.goal,
        workspacePath: task.workspacePath,
        taskId: task.taskId,
        taskGoal: task.goal,
        checkpoint: task.checkpoint,
        runId: ctx.runId,
        sessionKey: ctx.sessionKey,
      });

      const result = await executeAgentTurn({
        prompt: assembled.prompt,
        workspacePath: task.workspacePath,
        agentProvider: "openai",
        windowMessages: assembled.windowMessages,
        workstateContext: assembled.workstateContext,
        summaryContext: assembled.summaryContext,
        runContext: {
          runId: ctx.runId,
          sessionKey: ctx.sessionKey,
          source: ctx.source,
        },
      });

      return {
        answer: result.answer,
        actionJournal: result.actionJournal,
        verifyResult: {
          ok: true,
          evidence: JSON.stringify({ usedWorkstate: true }),
        },
      };
    };

    const supervisor = new TaskSupervisor({
      taskDir: path.join(tmpDir, "tasks"),
      eventQueueDir: path.join(tmpDir, "events"),
      heartbeatIntervalMs: 0,
      defaultMaxAttempts: 5,
      executeTaskTurn,
    });
    await supervisor.start();

    const route = makeRoute(workspacePath);
    const runResult = await handleTaskRun("验证 WORKSTATE 在 heartbeat 续跑时被读回", route, supervisor);
    expect(runResult.ok).toBe(true);
    expect(runResult.task).toBeDefined();

    const taskId = runResult.task!.taskId;

    await supervisor.handleHeartbeatTick(makeTick("manual"));
    const afterFirstTick = await supervisor.getTaskStatus(taskId);
    expect(afterFirstTick?.status).toBe("pending");
    expect(fs.existsSync(path.join(workspacePath, ".msgcode", "workstates", `${taskId}.md`))).toBe(true);

    await supervisor.handleHeartbeatTick(makeTick("manual"));
    const afterSecondTick = await supervisor.getTaskStatus(taskId);

    const messages = Array.isArray(capturedBody.messages)
      ? (capturedBody.messages as Array<{ role?: string; content?: string }>)
      : [];
    const finalPrompt = messages[1]?.content ?? "";
    const workstateIndex = finalPrompt.indexOf("[当前工作态骨架]");
    const summaryIndex = finalPrompt.indexOf("[历史对话摘要]");
    const windowIndex = finalPrompt.indexOf("[最近对话窗口]");
    const userIndex = finalPrompt.indexOf("[当前用户问题]");

    expect(afterSecondTick?.status).toBe("completed");
    expect(afterSecondTick?.verifyEvidence).toContain("usedWorkstate");
    expect(callCount).toBe(2);
    expect(finalPrompt).toContain("[当前工作态骨架]");
    expect(finalPrompt).toContain("先恢复当前工作骨架");
    expect(finalPrompt).toContain("[历史对话摘要]");
    expect(finalPrompt).toContain("上一轮已经进入长任务恢复阶段。");
    expect(workstateIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThan(workstateIndex);
    expect(windowIndex).toBeGreaterThan(summaryIndex);
    expect(userIndex).toBeGreaterThan(windowIndex);
  });
});

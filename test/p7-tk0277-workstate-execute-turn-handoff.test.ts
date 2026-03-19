import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendWindow } from "../src/session-window.js";
import { saveSummary } from "../src/summary.js";
import { assembleAgentContext } from "../src/runtime/context-policy.js";
import { executeAgentTurn } from "../src/agent-backend/index.js";

function asJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("tk0277: workstate handoff into executeAgentTurn", () => {
  let workspacePath = "";
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "msgcode-tk0277-handoff-"));
    process.env.AGENT_MODEL = "unit-test-model";
    await mkdir(join(workspacePath, ".msgcode", "workstates"), { recursive: true });
    await writeFile(
      join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["bash", "read_file"],
        "tooling.require_confirm": [],
      }, null, 2),
      "utf8"
    );
    await writeFile(
      join(workspacePath, ".msgcode", "workstates", "tk0277.md"),
      [
        "# Current Intent",
        "先恢复工作骨架，再决定是否继续推进。",
        "",
        "# Next Step",
        "- 先看 WORKSTATE，再看 summary。",
        "",
      ].join("\n"),
      "utf8"
    );
    await appendWindow(workspacePath, "chat-tk0277-handoff", {
      role: "user",
      content: "上一轮已经进入长任务恢复阶段。",
    });
    await saveSummary(workspacePath, "chat-tk0277-handoff", {
      goal: ["验证 WORKSTATE 真实进入模型请求体"],
      constraints: ["不要猜 taskId"],
      decisions: [],
      openItems: [],
      toolFacts: [],
    });
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.AGENT_MODEL;
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("task 续跑经 executeAgentTurn 时应把 WORKSTATE 放在 summary 前交给模型", async () => {
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return asJsonResponse({
        choices: [{
          message: {
            role: "assistant",
            content: "已恢复工作态并继续。",
          },
        }],
      });
    }) as typeof fetch;

    const assembled = await assembleAgentContext({
      source: "task",
      chatId: "chat-tk0277-handoff",
      prompt: "继续推进当前任务",
      workspacePath,
      taskId: "tk0277",
      taskGoal: "验证 WORKSTATE handoff",
      checkpoint: {
        currentPhase: "running",
        summary: "已经进入任务恢复阶段",
        nextAction: "把当前工作态交给模型",
        updatedAt: Date.now(),
      },
      runId: "run-tk0277-handoff",
      sessionKey: "session:v1:tk0277:handoff",
    });

    const result = await executeAgentTurn({
      prompt: assembled.prompt,
      workspacePath,
      agentProvider: "openai",
      windowMessages: assembled.windowMessages,
      workstateContext: assembled.workstateContext,
      summaryContext: assembled.summaryContext,
      runContext: {
        runId: "run-tk0277-handoff",
        sessionKey: "session:v1:tk0277:handoff",
        source: "task",
      },
    });

    const messages = Array.isArray(capturedBody.messages)
      ? (capturedBody.messages as Array<{ role?: string; content?: string }>)
      : [];
    const finalPrompt = messages[1]?.content ?? "";
    const workstateIndex = finalPrompt.indexOf("[当前工作态骨架]");
    const summaryIndex = finalPrompt.indexOf("[历史对话摘要]");
    const windowIndex = finalPrompt.indexOf("[最近对话窗口]");
    const userIndex = finalPrompt.indexOf("[当前用户问题]");

    expect(result.answer).toBe("已恢复工作态并继续。");
    expect(assembled.workstateContext).toContain("先恢复工作骨架");
    expect(messages[1]?.role).toBe("user");
    expect(finalPrompt).toContain("[当前工作态骨架]");
    expect(finalPrompt).toContain("先恢复工作骨架");
    expect(finalPrompt).toContain("[历史对话摘要]");
    expect(finalPrompt).toContain("上一轮已经进入长任务恢复阶段。");
    expect(finalPrompt).toContain("[长期任务目标]");
    expect(finalPrompt).toContain("验证 WORKSTATE handoff");
    expect(finalPrompt).toContain("[任务检查点]");
    expect(workstateIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThan(workstateIndex);
    expect(windowIndex).toBeGreaterThan(summaryIndex);
    expect(userIndex).toBeGreaterThan(windowIndex);
  });
});

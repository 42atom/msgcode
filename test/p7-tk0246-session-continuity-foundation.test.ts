import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendWindow, loadWindow } from "../src/session-window.js";
import { loadSummary } from "../src/summary.js";
import { assembleAgentContext } from "../src/runtime/context-policy.js";
import { buildWorkRecoverySnapshot, writeDispatchRecord } from "../src/runtime/work-continuity.js";

function createTempWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-session-continuity-"));
  fs.mkdirSync(path.join(root, "issues"), { recursive: true });
  fs.mkdirSync(path.join(root, ".msgcode", "dispatch"), { recursive: true });
  return root;
}

function writeTaskDoc(workspace: string, fileName: string, content = "# task\n"): string {
  const filePath = path.join(workspace, "issues", fileName);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

describe("tk0246: session continuity foundation", () => {
  let workspacePath = "";

  beforeEach(async () => {
    workspacePath = createTempWorkspace();
    process.env.AGENT_CONTEXT_WINDOW_TOKENS = "4096";
    process.env.AGENT_RESERVED_OUTPUT_TOKENS = "1024";
    process.env.AGENT_CHARS_PER_TOKEN = "2";

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    clearRuntimeCapabilityCache();
  });

  afterEach(async () => {
    delete process.env.AGENT_CONTEXT_WINDOW_TOKENS;
    delete process.env.AGENT_RESERVED_OUTPUT_TOKENS;
    delete process.env.AGENT_CHARS_PER_TOKEN;

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    clearRuntimeCapabilityCache();

    if (workspacePath && fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("没有 session 也能先凭 work truth 重建最小恢复面", async () => {
    writeTaskDoc(workspacePath, "tk6100.doi.runtime.parent-task.md");
    writeTaskDoc(workspacePath, "tk6101.bkd.runtime.child-task.md");

    await writeDispatchRecord({
      workspacePath,
      parentTaskId: "tk6100",
      childTaskId: "tk6101",
      client: "codex",
      goal: "恢复父任务",
      cwd: workspacePath,
      acceptance: ["done"],
      checkpoint: {
        summary: "子任务仍未完成",
        nextAction: "继续跟进 tk6101",
        updatedAt: Date.now(),
      },
    });

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath,
      parentTaskId: "tk6100",
    });

    expect(snapshot.workCapsule.taskId).toBe("tk6100");
    expect(snapshot.workCapsule.nextAction.type).toBe("resume");
    expect(snapshot.workCapsule.checkpoint.nextAction).toBe("继续跟进 tk6101");
    expect(snapshot.workCapsule.childTasks?.some((task) => task.taskId === "tk6101")).toBe(true);
  });

  it("transcript 缺失或截断时不阻塞恢复", async () => {
    writeTaskDoc(workspacePath, "tk6200.doi.runtime.parent-task.md");
    writeTaskDoc(workspacePath, "tk6201.tdo.runtime.child-task.md");

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath,
      parentTaskId: "tk6200",
    });

    const context = await assembleAgentContext({
      source: "task",
      chatId: "chat-tk0246-missing-window",
      prompt: "继续推进 tk6200",
      workspacePath,
      taskGoal: "继续推进 tk6200",
      checkpoint: {
        summary: snapshot.workCapsule.checkpoint.summary,
        nextAction: snapshot.workCapsule.checkpoint.nextAction,
        updatedAt: Date.now(),
      },
      runId: "run-tk0246-missing-window",
    });

    expect(context.windowMessages).toHaveLength(0);
    expect(context.prompt).toContain("[长期任务目标]");
    expect(context.prompt).toContain("继续推进 tk6200");
    expect(context.prompt).toContain("检查任务文档与派单记录");
  });

  it("transcript 说完成了但 truth 未终态时，仍按 truth 恢复", async () => {
    writeTaskDoc(
      workspacePath,
      "tk6300.doi.runtime.parent-task.md",
      `---
implicit:
  waiting_for: "tk6301"
---

# Goal

parent

## Child Tasks

- \`tk6301\`
`,
    );
    writeTaskDoc(workspacePath, "tk6301.tdo.runtime.child-task.md");

    await appendWindow(workspacePath, "chat-tk0246-truth-first", {
      role: "assistant",
      content: "这个任务已经完成了，不需要继续。",
    });

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath,
      parentTaskId: "tk6300",
    });

    expect(snapshot.workCapsule.taskId).toBe("tk6300");
    expect(snapshot.workCapsule.childTasks?.find((task) => task.taskId === "tk6301")?.workStatus).toBe("pending");
    expect(snapshot.workCapsule.nextAction.type).toBe("dispatch");
    expect(snapshot.workCapsule.checkpoint.nextAction).toBe("派发子任务 tk6301");
  });

  it("compaction 后仍以 work truth 为主，session 只提供更顺续接", async () => {
    process.env.AGENT_CONTEXT_WINDOW_TOKENS = "20";
    process.env.AGENT_RESERVED_OUTPUT_TOKENS = "10";
    process.env.AGENT_CHARS_PER_TOKEN = "1";

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    clearRuntimeCapabilityCache();

    writeTaskDoc(workspacePath, "tk6400.doi.runtime.parent-task.md");
    writeTaskDoc(workspacePath, "tk6401.bkd.runtime.child-task.md");

    await writeDispatchRecord({
      workspacePath,
      parentTaskId: "tk6400",
      childTaskId: "tk6401",
      client: "codex",
      goal: "继续父任务",
      cwd: workspacePath,
      acceptance: ["done"],
      checkpoint: {
        summary: "子任务仍待恢复",
        nextAction: "继续恢复 tk6401",
        updatedAt: Date.now(),
      },
    });

    for (let index = 0; index < 20; index += 1) {
      await appendWindow(workspacePath, "chat-tk0246-compact", {
        role: index % 2 === 0 ? "user" : "assistant",
        content: `第 ${index} 条长消息，用来触发 compaction。`.repeat(3),
      });
    }

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath,
      parentTaskId: "tk6400",
    });

    const context = await assembleAgentContext({
      source: "task",
      chatId: "chat-tk0246-compact",
      prompt: "继续推进 tk6400",
      workspacePath,
      taskGoal: "继续推进 tk6400",
      checkpoint: {
        summary: snapshot.workCapsule.checkpoint.summary,
        nextAction: snapshot.workCapsule.checkpoint.nextAction,
        updatedAt: Date.now(),
      },
      runId: "run-tk0246-compact",
    });

    const persistedWindow = await loadWindow(workspacePath, "chat-tk0246-compact");
    const persistedSummary = await loadSummary(workspacePath, "chat-tk0246-compact");

    expect(context.compactionTriggered).toBe(true);
    expect(persistedWindow.length).toBeLessThan(20);
    expect(persistedSummary.goal.length).toBeGreaterThan(0);
    expect(snapshot.workCapsule.checkpoint.nextAction).toBe("继续恢复 tk6401");
    expect(context.prompt).toContain("继续恢复 tk6401");
  });
});

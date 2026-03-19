import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("tk0277: workstate read path at context rebuild boundary", () => {
  let tmpDir = "";
  let workspacePath = "";

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-tk0277-");
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(path.join(workspacePath, ".msgcode", "workstates"), { recursive: true });
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

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("task/heartbeat 链路提供 taskId 时应注入 WORKSTATE", async () => {
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");
    fs.writeFileSync(
      path.join(workspacePath, ".msgcode", "workstates", "tk0277.md"),
      "# Current Intent\n先恢复工作骨架，再决定是否继续重试。\n",
      "utf8"
    );

    const result = await assembleAgentContext({
      source: "task",
      chatId: "chat-tk0277-task",
      prompt: "继续推进",
      workspacePath,
      taskId: "tk0277",
      checkpoint: {
        currentPhase: "running",
        summary: "正在恢复任务上下文",
        nextAction: "优先读取 workstate",
        updatedAt: Date.now(),
      },
      runId: "run-tk0277-task",
      sessionKey: "session:v1:tk0277:task",
    });

    expect(result.workstateContext).toContain("先恢复工作骨架");
  });

  it("没有 taskId 的消息链不应猜测注入 WORKSTATE", async () => {
    const { assembleAgentContext, buildDialogPromptWithContext } = await import("../src/runtime/context-policy.js");
    fs.writeFileSync(
      path.join(workspacePath, ".msgcode", "workstates", "tk0277.md"),
      "# Current Intent\n这份文件不该被 message 链误读。\n",
      "utf8"
    );

    const result = await assembleAgentContext({
      source: "message",
      chatId: "chat-tk0277-message",
      prompt: "继续普通消息对话",
      workspacePath,
      runId: "run-tk0277-message",
      sessionKey: "session:v1:tk0277:message",
    });

    expect(result.workstateContext).toBeUndefined();

    const prompt = buildDialogPromptWithContext({
      prompt: "继续普通消息对话",
      workstateContext: result.workstateContext,
      summaryContext: result.summaryContext,
      windowMessages: result.windowMessages,
    });

    expect(prompt).not.toContain("[当前工作态骨架]");
  });
});

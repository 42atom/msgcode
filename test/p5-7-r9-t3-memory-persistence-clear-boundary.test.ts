/**
 * msgcode: P5.7-R9-T3 记忆持久化与 /clear 边界回归锁
 *
 * 目标：
 * - 锁定持久化窗口/摘要恢复
 * - 锁定低于阈值不提前 compact
 * - 锁定 /clear 只清短期会话并保留结构化日志字段
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("P5.7-R9-T3: Memory Persistence & Clear Boundary", () => {
  let tmpDir = "";
  let workspacePath = "";

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-r9-t3-");
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    process.env.AGENT_CONTEXT_WINDOW_TOKENS = "4096";
    process.env.AGENT_RESERVED_OUTPUT_TOKENS = "1024";
    process.env.AGENT_CHARS_PER_TOKEN = "2";

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    clearRuntimeCapabilityCache();
  });

  afterEach(async () => {
    mock.restore();
    delete process.env.AGENT_CONTEXT_WINDOW_TOKENS;
    delete process.env.AGENT_RESERVED_OUTPUT_TOKENS;
    delete process.env.AGENT_CHARS_PER_TOKEN;

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    clearRuntimeCapabilityCache();

    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("assembleAgentContext 应从 workspace 恢复 window 与 summary 持久化上下文", async () => {
    const { appendWindow } = await import("../src/session-window.js");
    const { saveSummary } = await import("../src/summary.js");
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

    await appendWindow(workspacePath, "chat-r9-t3-persist", {
      role: "user",
      content: "请继续之前的实现，不要重新开始。",
    });
    await appendWindow(workspacePath, "chat-r9-t3-persist", {
      role: "assistant",
      content: "已经保留了会话窗口和摘要。",
    });
    await saveSummary(workspacePath, "chat-r9-t3-persist", {
      goal: ["验证重启后仍能恢复上下文"],
      constraints: ["不要清长期记忆"],
      decisions: [],
      openItems: [],
      toolFacts: [],
    });

    const result = await assembleAgentContext({
      source: "message",
      chatId: "chat-r9-t3-persist",
      prompt: "继续推进",
      workspacePath,
      runId: "run-r9-t3-persist",
      sessionKey: "session:v1:test:r9-t3-persist",
    });

    expect(result.windowMessages).toHaveLength(2);
    expect(result.summaryContext).toContain("Goal:");
    expect(result.summaryContext).toContain("不要清长期记忆");
    expect(result.prompt).toContain("继续推进");
  });

  it("低于 soft threshold 时不应提前 compact", async () => {
    const { appendWindow, loadWindow } = await import("../src/session-window.js");
    const { loadSummary } = await import("../src/summary.js");
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

    await appendWindow(workspacePath, "chat-r9-t3-no-compact", {
      role: "user",
      content: "短上下文不应该提前摘要。",
    });
    await appendWindow(workspacePath, "chat-r9-t3-no-compact", {
      role: "assistant",
      content: "保持原窗口即可。",
    });

    const result = await assembleAgentContext({
      source: "message",
      chatId: "chat-r9-t3-no-compact",
      prompt: "继续这轮短对话",
      workspacePath,
      runId: "run-r9-t3-no-compact",
      sessionKey: "session:v1:test:r9-t3-no-compact",
    });

    const persistedWindow = await loadWindow(workspacePath, "chat-r9-t3-no-compact");
    const persistedSummary = await loadSummary(workspacePath, "chat-r9-t3-no-compact");

    expect(result.compactionTriggered).toBe(false);
    expect(result.postCompactUsagePct).toBeUndefined();
    expect(persistedWindow).toHaveLength(2);
    expect(persistedSummary.goal).toHaveLength(0);
  });

  it("clearSession 应只清 window/summary，并记录 short-term 边界日志", async () => {
    const infoMock = mock(() => {});
    const resetThreadMock = mock(async () => {});

    mock.module("../src/logger/index.js", () => ({
      logger: {
        info: infoMock,
        warn: mock(() => {}),
        error: mock(() => {}),
      },
    }));

    mock.module("../src/runtime/thread-store.js", () => ({
      resetThread: resetThreadMock,
    }));

    const { clearSession } = await import(
      `../src/runtime/session-orchestrator.js?case=r9-t3-${Date.now()}`
    );
    const { appendWindow, loadWindow } = await import("../src/session-window.js");
    const { saveSummary, loadSummary } = await import("../src/summary.js");

    await appendWindow(workspacePath, "chat-r9-t3-clear", {
      role: "user",
      content: "这轮会话需要被 /clear 清掉。",
    });
    await saveSummary(workspacePath, "chat-r9-t3-clear", {
      goal: ["验证 /clear 只清短期会话"],
      constraints: [],
      decisions: [],
      openItems: [],
      toolFacts: [],
    });

    const result = await clearSession({
      projectDir: workspacePath,
      chatId: "chat-r9-t3-clear",
      groupName: "group-r9-t3-clear",
    });

    expect(result.success).toBe(true);
    expect(result.response).toContain("已清理会话文件");
    expect(await loadWindow(workspacePath, "chat-r9-t3-clear")).toHaveLength(0);
    expect((await loadSummary(workspacePath, "chat-r9-t3-clear")).goal).toHaveLength(0);
    expect(resetThreadMock).toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalled();

    const clearLog = infoMock.mock.calls.find(
      ([message]) => message === "Session artifacts cleared"
    );
    expect(clearLog).toBeDefined();
    expect(clearLog?.[1]).toMatchObject({
      module: "session-orchestrator",
      chatId: "chat-r9-t3-clear",
      clearScope: "short-term",
      clearedItems: ["window", "summary"],
      preservedItems: ["memory"],
    });
  });
});

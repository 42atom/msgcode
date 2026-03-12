/**
 * msgcode: P5.7-R9-T2 上下文预算与 Compact 回归锁
 *
 * 目标：
 * - 锁定上下文预算常量与 helper 合同
 * - 锁定 compact 触发与落盘行为
 * - 锁定 routed-chat 对 summaryContext 的真实透传
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("P5.7-R9-T2: Context Budget & Compact", () => {
  let tmpDir = "";
  let workspacePath = "";

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-r9-t2-");
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
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

    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("应导出稳定的 compact 常量", async () => {
    const {
      CONTEXT_COMPACT_SOFT_THRESHOLD,
      CONTEXT_COMPACT_HARD_THRESHOLD,
      CONTEXT_COMPACT_KEEP_RECENT,
    } = await import("../src/runtime/context-policy.js");

    expect(CONTEXT_COMPACT_SOFT_THRESHOLD).toBe(70);
    expect(CONTEXT_COMPACT_HARD_THRESHOLD).toBe(85);
    expect(CONTEXT_COMPACT_KEEP_RECENT).toBe(16);
  });

  it("buildConversationContextBlocks / buildDialogPromptWithContext 应按预算裁剪并生成上下文块", async () => {
    const {
      buildConversationContextBlocks,
      buildDialogPromptWithContext,
    } = await import("../src/runtime/context-policy.js");

    const blocks = buildConversationContextBlocks({
      summaryContext: "这是一个很长的历史摘要，用来验证摘要预算会被裁剪。",
      windowMessages: [
        { role: "user", content: "第一条消息会被窗口预算裁掉" },
        { role: "assistant", content: "第二条消息保留" },
        { role: "user", content: "第三条消息也保留" },
      ],
      budget: {
        maxSummaryChars: 12,
        maxWindowMessages: 2,
        maxWindowChars: 40,
        maxTotalContextChars: 60,
        maxMessageChars: 8,
      },
    });

    expect(blocks.summaryText).toBe("这是一个很长的历史摘要，");
    expect(blocks.windowMessages).toEqual([
      { role: "assistant", content: "第二条消息保留" },
      { role: "user", content: "第三条消息也保留" },
    ]);
    expect(blocks.usedChars).toBeLessThanOrEqual(60);

    const prompt = buildDialogPromptWithContext({
      prompt: "继续执行",
      summaryContext: "Goal:\n- 收口 compact",
      windowMessages: [
        { role: "user", content: "用户上下文" },
        { role: "assistant", content: "助手上下文" },
      ],
    });

    expect(prompt).toContain("[历史对话摘要]");
    expect(prompt).toContain("[最近对话窗口]");
    expect(prompt).toContain("[当前用户问题]");
    expect(prompt).toContain("继续执行");
  });

  it("assembleAgentContext 超过软阈值时应 compact 并落盘", async () => {
    process.env.AGENT_CONTEXT_WINDOW_TOKENS = "20";
    process.env.AGENT_RESERVED_OUTPUT_TOKENS = "10";
    process.env.AGENT_CHARS_PER_TOKEN = "1";

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    const { appendWindow, loadWindow } = await import("../src/session-window.js");
    const { loadSummary } = await import("../src/summary.js");
    const { assembleAgentContext, CONTEXT_COMPACT_SOFT_THRESHOLD } = await import("../src/runtime/context-policy.js");
    clearRuntimeCapabilityCache();

    for (let index = 0; index < 24; index += 1) {
      await appendWindow(workspacePath, "chat-r9-t2-compact", {
        role: index % 2 === 0 ? "user" : "assistant",
        content: `第 ${index} 条上下文消息，用来压满窗口并触发 compact。`.repeat(2),
      });
    }

    const result = await assembleAgentContext({
      source: "message",
      chatId: "chat-r9-t2-compact",
      prompt: "继续推进 compact 验证",
      workspacePath,
      runId: "run-r9-t2-compact",
      sessionKey: "session:v1:test:r9-t2",
    });

    const persistedWindow = await loadWindow(workspacePath, "chat-r9-t2-compact");
    const persistedSummary = await loadSummary(workspacePath, "chat-r9-t2-compact");

    expect(result.compactionTriggered).toBe(true);
    expect(result.compactionReason).toContain(`${CONTEXT_COMPACT_SOFT_THRESHOLD}% threshold`);
    expect(result.contextUsagePct).toBeGreaterThanOrEqual(CONTEXT_COMPACT_SOFT_THRESHOLD);
    expect(result.postCompactUsagePct).toBeDefined();
    expect(result.contextWindowTokens).toBeGreaterThan(0);
    expect(result.contextBudget).toBeGreaterThan(0);
    expect(result.windowMessages).toHaveLength(16);
    expect(persistedWindow).toHaveLength(16);
    expect(persistedSummary.goal.length).toBeGreaterThan(0);
    expect(result.summaryContext).toContain("Goal:");
  });

  it("routed-chat 应把 summaryContext 透传给 tool-loop 主链", async () => {
    const routedChatCode = fs.readFileSync(
      path.join(process.cwd(), "src/agent-backend/routed-chat.ts"),
      "utf-8"
    );

    expect(routedChatCode).toContain("summaryContext: options.summaryContext");
  });
});

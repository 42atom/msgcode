import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("Phase 3: Context Policy", () => {
  let tmpDir = "";
  let workspacePath = "";

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-context-policy-");
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

  it("普通消息链和 task 续跑链应共享同一 assembleAgentContext 合同", async () => {
    const { appendWindow } = await import("../src/session-window.js");
    const { saveSummary } = await import("../src/summary.js");
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

    await appendWindow(workspacePath, "chat-phase3-shared", {
      role: "user",
      content: "普通消息链和 task 续跑链都应该复用统一 assembler。",
    });
    await saveSummary(workspacePath, "chat-phase3-shared", {
      goal: ["共享统一上下文装配入口"],
      constraints: ["不要回退到 handlers 私有拼装"],
      decisions: [],
      openItems: [],
      toolFacts: [],
    });

    const messageResult = await assembleAgentContext({
      source: "message",
      chatId: "chat-phase3-shared",
      prompt: "继续普通消息链",
      workspacePath,
      currentChannel: "feishu",
      currentSpeakerId: "ou_phase3",
      primaryOwnerIds: ["ou_phase3"],
      runId: "run-phase3-shared-message",
      sessionKey: "session:v1:phase3:shared-message",
    });

    const taskResult = await assembleAgentContext({
      source: "task",
      chatId: "chat-phase3-shared",
      prompt: "继续 task 续跑链",
      workspacePath,
      taskGoal: "统一消息链与 task 链的上下文合同",
      checkpoint: {
        currentPhase: "running",
        summary: "当前正在校验两条链共享 assembler。",
        nextAction: "确认输出字段与持久化上下文一致",
        updatedAt: Date.now(),
      },
      runId: "run-phase3-shared-task",
      sessionKey: "session:v1:phase3:shared-task",
    });

    expect(messageResult.windowMessages.length).toBeGreaterThan(0);
    expect(taskResult.windowMessages.length).toBeGreaterThan(0);
    expect(messageResult.summaryContext).toContain("Goal:");
    expect(taskResult.summaryContext).toContain("Goal:");
    expect(messageResult.prompt).toContain("继续普通消息链");
    expect(taskResult.prompt).toContain("[任务检查点]");
    expect(taskResult.prompt).toContain("确认输出字段与持久化上下文一致");
  });

  it("task 续跑应通过统一 assembler 拼入 checkpoint 和 summary/window", async () => {
    const { appendWindow } = await import("../src/session-window.js");
    const { saveSummary } = await import("../src/summary.js");
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

    await appendWindow(workspacePath, "chat-phase3-task", {
      role: "user",
      content: "先把 Phase 3 的上下文入口收口好。",
    });
    await appendWindow(workspacePath, "chat-phase3-task", {
      role: "assistant",
      content: "已进入 context policy 收口阶段。",
    });
    await saveSummary(workspacePath, "chat-phase3-task", {
      goal: ["收口 Agent Core Context Policy"],
      constraints: ["不要新增厚控制层"],
      decisions: [],
      openItems: [],
      toolFacts: [],
    });

    const result = await assembleAgentContext({
      source: "task",
      chatId: "chat-phase3-task",
      prompt: "继续推进 Phase 3",
      workspacePath,
      taskGoal: "统一普通消息与 task 续跑的上下文装配入口",
      checkpoint: {
        currentPhase: "running",
        summary: "已完成入口抽取，正在接 handlers 与 task 续跑。",
        nextAction: "统一入口并跑回归",
        lastToolName: "read_file",
        updatedAt: Date.now(),
      },
      runId: "run-phase3-task",
    });

    expect(result.prompt).toContain("[长期任务目标]");
    expect(result.prompt).toContain("统一普通消息与 task 续跑的上下文装配入口");
    expect(result.prompt).toContain("[任务检查点]");
    expect(result.prompt).toContain("下一步: 统一入口并跑回归");
    expect(result.windowMessages.length).toBeGreaterThan(0);
    expect(result.summaryContext).toContain("Goal:");
    expect(result.summaryContext).toContain("Constraints:");
  });

  it("task 续跑的统一 assembler 应支持注入 SOUL 上下文", async () => {
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

    fs.mkdirSync(path.join(workspacePath, ".msgcode"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, ".msgcode", "SOUL.md"),
      "# Workspace Soul\n必须保持长期任务续跑也遵守同一人格与约束。\n",
      "utf-8"
    );

    const result = await assembleAgentContext({
      source: "task",
      chatId: "chat-phase3-soul",
      prompt: "继续推进长期任务",
      workspacePath,
      taskGoal: "确保 task 续跑链也带上 soulContext",
      checkpoint: {
        summary: "当前在补 task 续跑的 SOUL 注入缺口。",
        nextAction: "确认 task 链和 message 链上下文强度一致",
        updatedAt: Date.now(),
      },
      includeSoulContext: true,
      runId: "run-phase3-soul",
      sessionKey: "session:v1:test:soul",
    });

    expect(result.soulContext?.source).toBe("workspace");
    expect(result.soulContext?.content).toContain("长期任务续跑也遵守同一人格与约束");
  });

  it("普通消息链应把 speakerId 与按渠道 owner ids 注入统一上下文", async () => {
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

    const result = await assembleAgentContext({
      source: "message",
      chatId: "feishu:oc_phase3_owner",
      prompt: "请判断当前发言人是不是主人。",
      workspacePath,
      currentChannel: "feishu",
      currentSpeakerId: "ou_owner_1",
      primaryOwnerIds: ["ou_owner_1", "ou_owner_2"],
      runId: "run-phase3-owner",
      sessionKey: "session:v1:feishu:test-owner",
    });

    expect(result.speakerIdentityContext).toContain("当前渠道: feishu");
    expect(result.speakerIdentityContext).toContain("当前发言人ID: ou_owner_1");
    expect(result.speakerIdentityContext).toContain("本渠道主人的ID: ou_owner_1, ou_owner_2");
    expect(result.prompt).toContain("[当前会话身份事实]");
    expect(result.prompt).toContain("当前发言人是否是主人: 是");
  });

  it("compact 触发后应通过统一入口重写 summary 和 window", async () => {
    process.env.AGENT_CONTEXT_WINDOW_TOKENS = "20";
    process.env.AGENT_RESERVED_OUTPUT_TOKENS = "10";
    process.env.AGENT_CHARS_PER_TOKEN = "1";

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    const { appendWindow, loadWindow } = await import("../src/session-window.js");
    const { loadSummary } = await import("../src/summary.js");
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");
    clearRuntimeCapabilityCache();

    for (let index = 0; index < 24; index += 1) {
      const role = index % 2 === 0 ? "user" : "assistant";
      const content = index === 0
        ? "Phase 3 必须统一 context policy，不能再留 handlers 私有 compaction。"
        : `第 ${index} 条上下文消息，用来压满窗口并验证 compact 收口仍能保留最近状态。`.repeat(2);

      await appendWindow(workspacePath, "chat-phase3-compact", {
        role,
        content,
      });
    }

    const result = await assembleAgentContext({
      source: "message",
      chatId: "chat-phase3-compact",
      prompt: "继续推进 compact 回归",
      workspacePath,
      runId: "run-phase3-compact",
      sessionKey: "session:v1:test:compact",
    });

    const persistedWindow = await loadWindow(workspacePath, "chat-phase3-compact");
    const persistedSummary = await loadSummary(workspacePath, "chat-phase3-compact");

    expect(result.compactionTriggered).toBe(true);
    expect(result.windowMessages).toHaveLength(16);
    expect(persistedWindow).toHaveLength(16);
    expect(result.postCompactUsagePct).toBeDefined();
    expect(persistedSummary.goal.length).toBeGreaterThan(0);
    expect(result.summaryContext).toContain("Goal:");
  });

  it("context policy 不再导出 tool preview helper", async () => {
    const contextPolicy = await import("../src/runtime/context-policy.js");

    expect("clipToolPreviewText" in contextPolicy).toBe(false);
  });
});

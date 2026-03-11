import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("Phase 2: Feishu recent message roster context", () => {
  let tmpDir = "";
  let workspacePath = "";
  let originalFetch: typeof globalThis.fetch;
  let originalAgentBackend: string | undefined;
  let originalOpenAiModel: string | undefined;
  let originalOpenAiApiKey: string | undefined;
  let originalOpenAiBaseUrl: string | undefined;

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-feishu-message-roster-");
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    process.env.AGENT_CONTEXT_WINDOW_TOKENS = "4096";
    process.env.AGENT_RESERVED_OUTPUT_TOKENS = "1024";
    process.env.AGENT_CHARS_PER_TOKEN = "2";
    originalFetch = globalThis.fetch;
    originalAgentBackend = process.env.AGENT_BACKEND;
    originalOpenAiModel = process.env.OPENAI_MODEL;
    originalOpenAiApiKey = process.env.OPENAI_API_KEY;
    originalOpenAiBaseUrl = process.env.OPENAI_BASE_URL;
    process.env.AGENT_BACKEND = "openai";
    process.env.OPENAI_MODEL = "gpt-test";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:18080";

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    clearRuntimeCapabilityCache();
  });

  afterEach(async () => {
    delete process.env.AGENT_CONTEXT_WINDOW_TOKENS;
    delete process.env.AGENT_RESERVED_OUTPUT_TOKENS;
    delete process.env.AGENT_CHARS_PER_TOKEN;
    if (originalAgentBackend === undefined) {
      delete process.env.AGENT_BACKEND;
    } else {
      process.env.AGENT_BACKEND = originalAgentBackend;
    }
    if (originalOpenAiModel === undefined) {
      delete process.env.OPENAI_MODEL;
    } else {
      process.env.OPENAI_MODEL = originalOpenAiModel;
    }
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
    if (originalOpenAiBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = originalOpenAiBaseUrl;
    }
    globalThis.fetch = originalFetch;

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    clearRuntimeCapabilityCache();

    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("应把最近消息的最小结构表注入上下文", async () => {
    const { appendWindow } = await import("../src/session-window.js");
    const { assembleAgentContext } = await import(
      `../src/runtime/context-policy.js?case=feishu-phase2-roster-${Date.now()}`
    );

    await appendWindow(workspacePath, "feishu:oc_roster_phase2", {
      role: "user",
      content: "老哥先看一下这一条。",
      messageId: "om_prev_1",
      senderId: "ou_owner_1",
      senderName: "老哥",
      messageType: "text",
      isGroup: true,
    });
    await appendWindow(workspacePath, "feishu:oc_roster_phase2", {
      role: "assistant",
      content: "我已经看到了。",
    });
    await appendWindow(workspacePath, "feishu:oc_roster_phase2", {
      role: "user",
      content: "小王那条消息你也顺手记一下。",
      messageId: "om_prev_2",
      senderId: "ou_guest_1",
      senderName: "小王",
      messageType: "text",
      isGroup: true,
    });

    const result = await assembleAgentContext({
      source: "message",
      chatId: "feishu:oc_roster_phase2",
      prompt: "引用上一条再回复一下。",
      workspacePath,
      currentChannel: "feishu",
      currentMessageId: "om_current_2",
      currentSpeakerId: "ou_owner_1",
      currentSpeakerName: "老哥",
      currentIsGroup: true,
      currentMessageType: "text",
      primaryOwnerIds: ["ou_owner_1"],
      runId: "run-message-phase2",
      sessionKey: "session:v1:feishu:message-phase2",
    });

    expect(result.recentMessageRosterContext).toContain("msg=om_prev_1");
    expect(result.recentMessageRosterContext).toContain("sender=ou_owner_1");
    expect(result.recentMessageRosterContext).toContain("name=老哥");
    expect(result.recentMessageRosterContext).toContain("owner=yes");
    expect(result.recentMessageRosterContext).toContain("msg=om_prev_2");
    expect(result.recentMessageRosterContext).toContain("sender=ou_guest_1");
    expect(result.prompt).toContain("[最近消息索引]");
    expect(result.prompt).toContain("msg=om_prev_1");
    expect(result.prompt).toContain("msg=om_prev_2");
  });

  it("最近消息索引应保留最近 40 条结构记录，而不是只保留很短窗口", async () => {
    const { appendWindow } = await import("../src/session-window.js");
    const { assembleAgentContext } = await import(
      `../src/runtime/context-policy.js?case=feishu-phase2-limit-${Date.now()}`
    );

    for (let i = 1; i <= 45; i += 1) {
      await appendWindow(workspacePath, "feishu:oc_roster_limit_phase2", {
        role: "user",
        content: `第 ${i} 条消息，记录一段上下文线索。`,
        messageId: `om_prev_${i}`,
        senderId: `ou_speaker_${i}`,
        senderName: `成员${i}`,
        messageType: "text",
        isGroup: true,
      });
    }

    const result = await assembleAgentContext({
      source: "message",
      chatId: "feishu:oc_roster_limit_phase2",
      prompt: "请引用较新的消息线索。",
      workspacePath,
      currentChannel: "feishu",
      currentMessageId: "om_current_limit",
      currentSpeakerId: "ou_owner_1",
      currentSpeakerName: "老哥",
      currentIsGroup: true,
      currentMessageType: "text",
      primaryOwnerIds: ["ou_owner_1"],
      runId: "run-message-phase2-limit",
      sessionKey: "session:v1:feishu:message-phase2-limit",
    });

    const lines = result.recentMessageRosterContext?.split("\n") || [];
    expect(lines.some((line) => line.includes("msg=om_prev_1 "))).toBe(false);
    expect(lines.some((line) => line.includes("msg=om_prev_6 "))).toBe(true);
    expect(lines.some((line) => line.includes("msg=om_prev_45 "))).toBe(true);
    expect(lines.length).toBe(40);
  });

  it("应把 summary 中的最近生成产物路径提炼成独立索引", async () => {
    const { saveSummary } = await import("../src/summary.js");
    const { assembleAgentContext } = await import(
      `../src/runtime/context-policy.js?case=feishu-phase2-artifact-${Date.now()}`
    );

    await saveSummary(workspacePath, "feishu:oc_artifact_phase2", {
      goal: [],
      constraints: [],
      decisions: [],
      openItems: [],
      toolFacts: [
        "生成图片完成，路径=/Users/admin/msgcode-workspaces/smoke/ws-a/AIDOCS/images/gen-image-2026-03-10T17-20-00-074Z.png",
        "Banana 输出保存在 AIDOCS/banana-images/banana-pro-20260311-015844-image.png",
      ],
    });

    const result = await assembleAgentContext({
      source: "message",
      chatId: "feishu:oc_artifact_phase2",
      prompt: "请继续处理刚才那张图。",
      workspacePath,
      currentChannel: "feishu",
      currentMessageId: "om_current_artifact",
      currentSpeakerId: "ou_owner_1",
      currentSpeakerName: "老哥",
      currentIsGroup: false,
      currentMessageType: "text",
      primaryOwnerIds: ["ou_owner_1"],
      runId: "run-message-phase2-artifact",
      sessionKey: "session:v1:feishu:message-phase2-artifact",
    });

    expect(result.artifactRosterContext).toContain("/Users/admin/msgcode-workspaces/smoke/ws-a/AIDOCS/images/gen-image-2026-03-10T17-20-00-074Z.png");
    expect(result.artifactRosterContext).toContain("AIDOCS/banana-images/banana-pro-20260311-015844-image.png");
    expect(result.prompt).toContain("[最近生成产物索引]");
  });

  it("RuntimeRouterHandler 写回窗口时应保留当前消息元数据", async () => {
    const { saveWorkspaceConfig } = await import("../src/config/workspace.js");
    const { RuntimeRouterHandler } = await import("../src/handlers.js");
    const { loadWindow } = await import("../src/session-window.js");

    await saveWorkspaceConfig(workspacePath, { "tooling.mode": "explicit" });

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "处理完成" },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;

    const handler = new RuntimeRouterHandler();
    const result = await handler.handle("请记录消息元数据。", {
      botType: "agent-backend",
      chatId: "feishu:oc_phase2_handler",
      groupName: "feishu-phase2",
      projectDir: workspacePath,
      originalMessage: {
        id: "om_phase2_1",
        chatId: "feishu:oc_phase2_handler",
        text: "请记录消息元数据。",
        isFromMe: false,
        sender: "ou_sender_1",
        senderName: "老哥",
        handle: "ou_sender_1",
        isGroup: true,
        messageType: "text",
      },
    });

    expect(result.success).toBe(true);
    const windowMessages = await loadWindow(workspacePath, "feishu:oc_phase2_handler");
    expect(windowMessages).toHaveLength(2);
    expect(windowMessages[0]).toMatchObject({
      role: "user",
      content: "请记录消息元数据。",
      messageId: "om_phase2_1",
      senderId: "ou_sender_1",
      senderName: "老哥",
      messageType: "text",
      isGroup: true,
    });
    expect(windowMessages[1]).toMatchObject({
      role: "assistant",
      content: "处理完成",
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("Phase 1: Feishu message facts context", () => {
  let tmpDir = "";
  let workspacePath = "";
  let originalFetch: typeof globalThis.fetch;
  let originalAgentBackend: string | undefined;
  let originalOpenAiModel: string | undefined;
  let originalOpenAiApiKey: string | undefined;
  let originalOpenAiBaseUrl: string | undefined;

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-feishu-message-context-");
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

  it("普通消息链应把当前消息事实注入上下文", async () => {
    const { assembleAgentContext } = await import(
      `../src/runtime/context-policy.js?case=feishu-phase1-actual-${Date.now()}`
    );

    const result = await assembleAgentContext({
      source: "message",
      chatId: "feishu:oc_message_phase1",
      prompt: "请对本消息做后续操作。",
      workspacePath,
      currentChannel: "feishu",
      currentMessageId: "om_current_123",
      currentSpeakerId: "ou_speaker_1",
      currentSpeakerName: "老哥",
      currentIsGroup: true,
      currentMessageType: "text",
      primaryOwnerIds: ["ou_speaker_1"],
      runId: "run-message-phase1",
      sessionKey: "session:v1:feishu:message-phase1",
    });

    expect(result.messageIdentityContext).toContain("当前消息ID: om_current_123");
    expect(result.messageIdentityContext).toContain("本轮默认动作目标消息ID: om_current_123");
    expect(result.messageIdentityContext).toContain("当前消息发送者ID: ou_speaker_1");
    expect(result.messageIdentityContext).toContain("当前消息发送者昵称: 老哥");
    expect(result.messageIdentityContext).toContain("当前是否群聊: 是");
    expect(result.messageIdentityContext).toContain("当前消息类型: text");
    expect(result.prompt).toContain("[当前消息事实]");
    expect(result.prompt).toContain("本轮默认动作目标消息ID: om_current_123");
  });

  it("RuntimeRouterHandler 应把飞书当前消息 facts 带进发给模型的真实 prompt", async () => {
    const { saveWorkspaceConfig } = await import("../src/config/workspace.js");
    const { RuntimeRouterHandler } = await import("../src/handlers.js");

    await saveWorkspaceConfig(workspacePath, { "tooling.mode": "explicit" });

    let requestBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return new Response(
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
      );
    }) as typeof fetch;

    const handler = new RuntimeRouterHandler();
    const result = await handler.handle("请对本消息做后续操作。", {
      botType: "agent-backend",
      chatId: "feishu:oc_message_phase1_handler",
      groupName: "feishu-phase1",
      projectDir: workspacePath,
      originalMessage: {
        id: "om_current_456",
        chatId: "feishu:oc_message_phase1_handler",
        text: "请对本消息做后续操作。",
        isFromMe: false,
        sender: "ou_speaker_2",
        senderName: "王哥",
        handle: "ou_speaker_2",
        isGroup: true,
        messageType: "image",
      },
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe("处理完成");

    const messages = Array.isArray(requestBody.messages)
      ? (requestBody.messages as Array<{ role?: string; content?: string }>)
      : [];
    const userMessage = messages.findLast((message) => message.role === "user");
    expect(userMessage?.content).toContain("[当前消息事实]");
    expect(userMessage?.content).toContain("当前消息ID: om_current_456");
    expect(userMessage?.content).toContain("当前消息发送者昵称: 王哥");
    expect(userMessage?.content).toContain("当前是否群聊: 是");
    expect(userMessage?.content).toContain("当前消息类型: image");
  });

  it("飞书 transport 应标准化 messageType 为空白或缺失的情况", async () => {
    const transportTest = (await import("../src/feishu/transport.js")).__test;
    expect(transportTest?.normalizeFeishuMessageType).toBeDefined();

    expect(transportTest?.normalizeFeishuMessageType(" image ")).toBe("image");
    expect(transportTest?.normalizeFeishuMessageType("   ")).toBe("unknown");
    expect(transportTest?.normalizeFeishuMessageType(undefined)).toBe("unknown");
  });
});

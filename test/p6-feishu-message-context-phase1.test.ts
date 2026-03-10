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

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-feishu-message-context-");
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    clearRuntimeCapabilityCache();
  });

  afterEach(async () => {
    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    clearRuntimeCapabilityCache();

    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("普通消息链应把当前消息事实注入上下文", async () => {
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

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

  it("handlers 应把飞书当前消息 facts 传入统一 assembler", () => {
    const handlersCode = fs.readFileSync(
      path.join(process.cwd(), "src/handlers.ts"),
      "utf-8"
    );
    const transportCode = fs.readFileSync(
      path.join(process.cwd(), "src/feishu/transport.ts"),
      "utf-8"
    );

    expect(handlersCode).toContain("currentMessageId: context.originalMessage.id");
    expect(handlersCode).toContain("currentSpeakerName: context.originalMessage.senderName");
    expect(handlersCode).toContain("currentIsGroup: context.originalMessage.isGroup");
    expect(handlersCode).toContain("currentMessageType: context.originalMessage.messageType");
    expect(transportCode).toContain("const messageTypeLabel = normalizeFeishuMessageType(msgType);");
    expect(transportCode).toContain("messageType: messageTypeLabel");
  });
});

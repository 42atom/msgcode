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

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-feishu-message-roster-");
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

  it("应把最近消息的最小结构表注入上下文", async () => {
    const { appendWindow } = await import("../src/session-window.js");
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

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

  it("handlers 写回窗口时应保留当前消息元数据", () => {
    const handlersCode = fs.readFileSync(
      path.join(process.cwd(), "src/handlers.ts"),
      "utf-8"
    );

    expect(handlersCode).toContain("messageId: context.originalMessage.id");
    expect(handlersCode).toContain("senderId: context.originalMessage.sender || context.originalMessage.handle");
    expect(handlersCode).toContain("senderName: context.originalMessage.senderName");
    expect(handlersCode).toContain("messageType: context.originalMessage.messageType");
    expect(handlersCode).toContain("isGroup: context.originalMessage.isGroup");
  });
});

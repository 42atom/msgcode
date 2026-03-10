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

  it("最近消息索引应保留最近 40 条结构记录，而不是只保留很短窗口", async () => {
    const { appendWindow } = await import("../src/session-window.js");
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

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
    const { assembleAgentContext } = await import("../src/runtime/context-policy.js");

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

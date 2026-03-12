/**
 * msgcode: Phase 4 飞书消息动作工具回归锁
 *
 * 目标：
 * - reply/react 默认能对“本消息”生效
 * - 显式 messageId 优先于上下文默认目标
 * - 错误信息要提示机器人能力与会话条件
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeTool } from "../src/tools/bus.js";

describe("P6: feishu message actions", () => {
  let workspacePath = "";
  const originalAppId = process.env.FEISHU_APP_ID;
  const originalAppSecret = process.env.FEISHU_APP_SECRET;

  beforeEach(() => {
    workspacePath = join(tmpdir(), `msgcode-feishu-actions-${randomUUID()}`);
    mkdirSync(join(workspacePath, ".msgcode"), { recursive: true });

    writeFileSync(
      join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["feishu_reply_message", "feishu_react_message"],
        "tooling.require_confirm": [],
        "feishu.appId": "workspace-app-id",
        "feishu.appSecret": "workspace-app-secret",
      }),
      "utf-8"
    );

    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  });

  afterEach(() => {
    mock.restore();
    if (originalAppId === undefined) {
      delete process.env.FEISHU_APP_ID;
    } else {
      process.env.FEISHU_APP_ID = originalAppId;
    }
    if (originalAppSecret === undefined) {
      delete process.env.FEISHU_APP_SECRET;
    } else {
      process.env.FEISHU_APP_SECRET = originalAppSecret;
    }

    if (workspacePath && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("reply 缺省 messageId 时应回落到 defaultActionTargetMessageId", async () => {
    let observedArgs: { messageId: string; text: string; replyInThread?: boolean } | undefined;

    mock.module("../src/tools/feishu-reply-message.js", () => ({
      feishuReplyMessage: async (args: { messageId: string; text: string; replyInThread?: boolean }) => {
        observedArgs = args;
        return {
          ok: true,
          messageId: "om_reply_1",
          repliedToMessageId: args.messageId,
          chatId: "oc_runtime_chat",
          replyInThread: Boolean(args.replyInThread),
        };
      },
    }));

    const result = await executeTool(
      "feishu_reply_message",
      { text: "收到，继续处理。", replyInThread: true },
      {
        workspacePath,
        currentMessageId: "om_current_should_not_win",
        defaultActionTargetMessageId: "om_default_target",
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(observedArgs).toEqual({
      messageId: "om_default_target",
      text: "收到，继续处理。",
      replyInThread: true,
    });
    expect(result.data).toEqual({
      chatId: "oc_runtime_chat",
      repliedToMessageId: "om_default_target",
      messageId: "om_reply_1",
      replyInThread: true,
    });
    expect(result.previewText).toContain("[feishu_reply_message]");
    expect(result.previewText).toContain("消息回复已发送");
  });

  it("react 显式 messageId 应优先于上下文默认目标，且支持 emoji 直传", async () => {
    let observedArgs: { messageId: string; emoji?: string } | undefined;

    mock.module("../src/tools/feishu-react-message.js", () => ({
      feishuReactMessage: async (args: { messageId: string; emoji?: string }) => {
        observedArgs = args;
        return {
          ok: true,
          messageId: args.messageId,
          reactionId: "reaction_1",
          emojiType: "HEART",
        };
      },
    }));

    const result = await executeTool(
      "feishu_react_message",
      { messageId: "om_explicit_target", emoji: "heart" },
      {
        workspacePath,
        currentMessageId: "om_current_msg",
        defaultActionTargetMessageId: "om_default_target",
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(observedArgs).toEqual({
      messageId: "om_explicit_target",
      emoji: "heart",
    });
    expect(result.data).toEqual({
      messageId: "om_explicit_target",
      reactionId: "reaction_1",
      emojiType: "HEART",
    });
    expect(result.previewText).toContain("[feishu_react_message]");
    expect(result.previewText).toContain("[emojiType] HEART");
  });

  it("reply 失败时应提示机器人能力和会话条件", async () => {
    mock.module("../src/tools/feishu-reply-message.js", () => ({
      feishuReplyMessage: async () => ({
        ok: false,
        repliedToMessageId: "om_default_target",
        error: "飞书消息回复失败：99991663 forbidden。请确认机器人能力已开启，目标消息仍存在且机器人仍在对应会话中。",
      }),
    }));

    const result = await executeTool(
      "feishu_reply_message",
      { text: "收到" },
      {
        workspacePath,
        defaultActionTargetMessageId: "om_default_target",
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("机器人能力已开启");
    expect(result.error?.message).toContain("机器人仍在对应会话中");
  });

  it("react 缺省 messageId 且无当前消息时应拒绝执行", async () => {
    const result = await executeTool(
      "feishu_react_message",
      { emoji: "点赞" },
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("飞书目标消息 ID 未找到");
  });
});

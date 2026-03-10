/**
 * msgcode: Phase 3 飞书最近消息只读工具回归锁
 *
 * 目标：
 * - chatId 缺省时应从当前 workspace 会话上下文回填
 * - 返回最近消息的最小结构表
 * - 错误信息需提示群消息权限与机器人在群状态
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeTool } from "../src/tools/bus.js";
import { saveCurrentSessionContext } from "../src/config/workspace.js";

describe("P6: feishu recent messages tool", () => {
  let workspacePath = "";
  const originalAppId = process.env.FEISHU_APP_ID;
  const originalAppSecret = process.env.FEISHU_APP_SECRET;

  beforeEach(() => {
    workspacePath = join(tmpdir(), `msgcode-feishu-recent-${randomUUID()}`);
    mkdirSync(join(workspacePath, ".msgcode"), { recursive: true });

    writeFileSync(
      join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["feishu_list_recent_messages"],
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

  it("chatId 缺省时应从 workspace 当前会话上下文回填，并返回最近消息最小结构表", async () => {
    await saveCurrentSessionContext(workspacePath, {
      transport: "feishu",
      chatId: "oc_from_workspace",
      chatGuid: "feishu:oc_from_workspace",
    });

    mock.module("../src/tools/feishu-list-recent-messages.js", () => ({
      feishuListRecentMessages: async (args: { chatId: string; limit?: number }) => ({
        ok: true,
        chatId: args.chatId,
        count: 2,
        messages: [
          {
            messageId: "om_1",
            senderId: "ou_owner",
            messageType: "text",
            sentAt: "1711111111000",
            textSnippet: "你能对本消息点赞互动吗",
          },
          {
            messageId: "om_2",
            senderId: "ou_other",
            messageType: "text",
            replyToMessageId: "om_1",
            textSnippet: "可以，先定位 messageId。",
          },
        ],
      }),
    }));

    const result = await executeTool(
      "feishu_list_recent_messages",
      {},
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(result.data?.chatId).toBe("oc_from_workspace");
    expect(result.data?.count).toBe(2);
    expect(result.data?.messages).toEqual([
      {
        messageId: "om_1",
        senderId: "ou_owner",
        messageType: "text",
        sentAt: "1711111111000",
        textSnippet: "你能对本消息点赞互动吗",
      },
      {
        messageId: "om_2",
        senderId: "ou_other",
        messageType: "text",
        replyToMessageId: "om_1",
        textSnippet: "可以，先定位 messageId。",
      },
    ]);
  });

  it("接口失败时，错误信息应提示群消息权限和机器人在群状态", async () => {
    mock.module("../src/tools/feishu-list-recent-messages.js", () => ({
      feishuListRecentMessages: async () => ({
        ok: false,
        chatId: "oc_runtime_chat",
        error: "飞书最近消息接口失败：99991661 forbidden。请确认飞书后台已开启“获取群组中所有消息”权限，且机器人仍在群里。",
      }),
    }));

    const result = await executeTool(
      "feishu_list_recent_messages",
      { chatId: "oc_runtime_chat" },
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("获取群组中所有消息");
    expect(result.error?.message).toContain("机器人仍在群里");
  });

  it("默认应查询最近 40 条，并将显式 limit 上限收口到 40", async () => {
    await saveCurrentSessionContext(workspacePath, {
      transport: "feishu",
      chatId: "oc_from_workspace",
      chatGuid: "feishu:oc_from_workspace",
    });

    const observedLimits: number[] = [];
    mock.module("../src/tools/feishu-list-recent-messages.js", () => ({
      feishuListRecentMessages: async (args: { chatId: string; limit?: number }) => {
        observedLimits.push(args.limit ?? -1);
        return {
          ok: true,
          chatId: args.chatId,
          count: 0,
          messages: [],
        };
      },
    }));

    const defaultResult = await executeTool(
      "feishu_list_recent_messages",
      {},
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    const cappedResult = await executeTool(
      "feishu_list_recent_messages",
      { limit: 999 },
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(defaultResult.ok).toBe(true);
    expect(cappedResult.ok).toBe(true);
    expect(observedLimits).toEqual([40, 40]);
  });
});

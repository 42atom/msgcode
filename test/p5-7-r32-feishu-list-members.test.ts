/**
 * msgcode: Feishu 群成员列表工具回归锁
 *
 * 目标：
 * - 获取飞书群成员列表工具可被执行
 * - chatId 缺省时可从 workspace 当前会话上下文回填
 * - 错误信息需提示权限/机器人在群状态
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeTool } from "../src/tools/bus.js";
import { loadWorkspaceConfig, saveCurrentSessionContext } from "../src/config/workspace.js";

describe("P5.7-R32: feishu_list_members", () => {
  let workspacePath = "";
  const originalAppId = process.env.FEISHU_APP_ID;
  const originalAppSecret = process.env.FEISHU_APP_SECRET;

  beforeEach(() => {
    workspacePath = join(tmpdir(), `msgcode-feishu-members-${randomUUID()}`);
    mkdirSync(join(workspacePath, ".msgcode"), { recursive: true });

    writeFileSync(
      join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["feishu_list_members"],
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

  it("应将当前会话上下文写入 workspace config", async () => {
    await saveCurrentSessionContext(workspacePath, {
      transport: "feishu",
      chatId: "oc_runtime_chat",
      chatGuid: "feishu:oc_runtime_chat",
    });

    const config = await loadWorkspaceConfig(workspacePath);
    expect(config["runtime.current_transport"]).toBe("feishu");
    expect(config["runtime.current_chat_id"]).toBe("oc_runtime_chat");
  });

  it("chatId 缺省时应从 workspace 当前会话上下文回填，并返回成员列表", async () => {
    await saveCurrentSessionContext(workspacePath, {
      transport: "feishu",
      chatId: "oc_from_workspace",
      chatGuid: "feishu:oc_from_workspace",
    });

    mock.module("../src/tools/feishu-list-members.js", () => ({
      feishuListMembers: async (args: { chatId: string; memberIdType?: string }) => ({
        ok: true,
        chatId: args.chatId,
        memberIdType: args.memberIdType ?? "open_id",
        memberTotal: 2,
        members: [
          { senderId: "ou_owner", name: "won" },
          { senderId: "ou_other", name: "tan" },
        ],
      }),
    }));

    const result = await executeTool(
      "feishu_list_members",
      {},
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(result.data?.chatId).toBe("oc_from_workspace");
    expect(result.data?.memberTotal).toBe(2);
    expect(result.data?.members).toEqual([
      { senderId: "ou_owner", name: "won" },
      { senderId: "ou_other", name: "tan" },
    ]);
    expect(result.previewText).toContain("[feishu_list_members]");
    expect(result.previewText).toContain("[memberTotal] 2");
  });

  it("接口失败时，错误信息应提示权限或机器人状态", async () => {
    mock.module("../src/tools/feishu-list-members.js", () => ({
      feishuListMembers: async () => ({
        ok: false,
        chatId: "oc_runtime_chat",
        memberIdType: "open_id",
        error: "飞书群成员接口失败：99991677 forbidden。可能是机器人不在群里，或飞书后台未开启群成员读取权限。",
      }),
    }));

    const result = await executeTool(
      "feishu_list_members",
      { chatId: "oc_runtime_chat" },
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("机器人不在群里");
    expect(result.error?.message).toContain("飞书后台未开启群成员读取权限");
  });
});

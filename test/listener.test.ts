/**
 * msgcode: listener（2.0）单测
 *
 * 只验证控制面：/bind /where 以及未绑定时的提示。
 * 不触发 tmux（/start 走“未绑定提示”路径）。
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { handleMessage } from "../src/listener.js";
import { config } from "../src/config.js";

const TEST_ROUTES_FILE = path.join(os.tmpdir(), ".config/msgcode/routes-listener.test.json");
const TEST_WORKSPACE_ROOT = path.join(os.tmpdir(), "msgcode-workspaces-listener.test");

class FakeImsgClient {
  public sent: Array<{ chat_guid: string; text: string }> = [];
  async send(params: { chat_guid: string; text: string }): Promise<{ ok: boolean }> {
    this.sent.push({ chat_guid: params.chat_guid, text: params.text });
    return { ok: true };
  }
}

function cleanTestData(): void {
  if (fs.existsSync(TEST_ROUTES_FILE)) {
    fs.unlinkSync(TEST_ROUTES_FILE);
  }
  if (fs.existsSync(TEST_WORKSPACE_ROOT)) {
    fs.rmSync(TEST_WORKSPACE_ROOT, { recursive: true, force: true });
  }
}

describe("listener (2.0)", () => {
  beforeEach(() => {
    cleanTestData();
    fs.mkdirSync(TEST_WORKSPACE_ROOT, { recursive: true });

    process.env.ROUTES_FILE_PATH = TEST_ROUTES_FILE;
    process.env.WORKSPACE_ROOT = TEST_WORKSPACE_ROOT;

    if (!config.whitelist.emails.includes("test@example.com")) {
      config.whitelist.emails.push("test@example.com");
    }
  });

  afterEach(() => {
    cleanTestData();
  });

  it("未绑定时，/start 会提示先 /bind", async () => {
    const imsg = new FakeImsgClient();
    await handleMessage(
      {
        id: "m1",
        chatId: "any;+;chat-guid-1",
        text: "/start",
        isFromMe: false,
        sender: "test@example.com",
        handle: "test@example.com",
      },
      { imsgClient: imsg as unknown as any }
    );

    expect(imsg.sent.length).toBe(1);
    expect(imsg.sent[0].text).toContain("/bind");
  });

  it("/bind 会写入 RouteStore，并且 /where 可查询", async () => {
    const imsg = new FakeImsgClient();
    const chatId = "any;+;chat-guid-2";

    await handleMessage(
      {
        id: "m2",
        chatId,
        text: "/bind acme/ops",
        isFromMe: false,
        sender: "test@example.com",
        handle: "test@example.com",
      },
      { imsgClient: imsg as unknown as any }
    );

    expect(imsg.sent.length).toBe(1);
    expect(imsg.sent[0].text).toContain("绑定成功");
    expect(fs.existsSync(TEST_ROUTES_FILE)).toBe(true);

    await handleMessage(
      {
        id: "m3",
        chatId,
        text: "/where",
        isFromMe: false,
        sender: "test@example.com",
        handle: "test@example.com",
      },
      { imsgClient: imsg as unknown as any }
    );

    expect(imsg.sent.length).toBe(2);
    expect(imsg.sent[1].text).toContain("当前绑定");
    expect(imsg.sent[1].text).toContain(path.join(TEST_WORKSPACE_ROOT, "acme/ops"));
  });
});


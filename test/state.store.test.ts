/**
 * msgcode: StateStore 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  loadState,
  saveState,
  updateLastSeen,
  getChatState,
  resetChatState,
} from "../src/state/store.js";

const TEST_STATE_FILE = path.join(os.tmpdir(), ".config/msgcode/state.store.test.json");

function clean(): void {
  if (fs.existsSync(TEST_STATE_FILE)) {
    fs.unlinkSync(TEST_STATE_FILE);
  }
  const dir = path.dirname(TEST_STATE_FILE);
  const tmpFile = TEST_STATE_FILE + ".tmp";
  if (fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile);
  }
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("StateStore", () => {
  beforeEach(() => {
    process.env.STATE_FILE_PATH = TEST_STATE_FILE;
    clean();
  });

  afterEach(() => {
    clean();
  });

  it("文件不存在时返回空 StateStore", () => {
    const state = loadState();
    expect(state.version).toBe(1);
    expect(Object.keys(state.chats)).toHaveLength(0);
  });

  it("保存后可被加载", () => {
    const now = new Date().toISOString();
    saveState({
      version: 1,
      updatedAt: now,
      chats: {
        "any;+;test": {
          chatGuid: "any;+;test",
          lastSeenRowid: 10,
          lastMessageId: "m10",
          lastSeenAt: now,
          messageCount: 1,
        },
      },
    });

    const loaded = loadState();
    expect(loaded.chats["any;+;test"]?.lastSeenRowid).toBe(10);
    expect(fs.existsSync(TEST_STATE_FILE + ".tmp")).toBe(false);
  });

  it("updateLastSeen 只前进不后退", () => {
    const chatId = "any;+;monotonic";

    updateLastSeen(chatId, 100, "m100");
    updateLastSeen(chatId, 90, "m090"); // 不应回退
    updateLastSeen(chatId, 101, "m101");

    const state = getChatState(chatId);
    expect(state).not.toBeNull();
    expect(state?.lastSeenRowid).toBe(101);
    expect(state?.lastMessageId).toBe("m101");
    expect(state?.messageCount).toBe(2);
  });

  it("resetChatState 删除指定群记录", () => {
    const chatId = "any;+;resetme";
    updateLastSeen(chatId, 1, "m1");
    expect(getChatState(chatId)).not.toBeNull();

    resetChatState(chatId);
    expect(getChatState(chatId)).toBeNull();
  });

  it("版本不匹配会报错", () => {
    const dir = path.dirname(TEST_STATE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      TEST_STATE_FILE,
      JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), chats: {} }, null, 2),
      "utf8"
    );
    expect(() => loadState()).toThrow("不支持的 StateStore 版本");
  });

  it("坏 JSON 会报错", () => {
    const dir = path.dirname(TEST_STATE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TEST_STATE_FILE, "{not-json", "utf8");
    expect(() => loadState()).toThrow("加载 StateStore 失败");
  });
});

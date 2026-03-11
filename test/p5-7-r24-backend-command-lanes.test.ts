/**
 * P5.7-R24: backend lanes 命令协议回归锁
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setRoute } from "../src/routes/store.js";
import {
  handleApiCommand,
  handleBackendCommand,
  handleEmbeddingModelCommand,
  handleModelCommand,
  handleTextModelCommand,
  handleTtsModelCommand,
  handleVisionModelCommand,
} from "../src/routes/cmd-model.js";

const CHAT_ID = "any;+;r24-backend-lanes";

describe("P5.7-R24: backend lanes 命令协议", () => {
  let tmpRoot = "";
  let workspacePath = "";
  let routesFilePath = "";
  let fakeHome = "";

  const envBackup: Record<string, string | undefined> = {};
  const envKeys = [
    "HOME",
    "ROUTES_FILE_PATH",
    "WORKSPACE_ROOT",
    "AGENT_BACKEND",
    "LOCAL_AGENT_BACKEND",
    "MSGCODE_API_PROVIDER",
    "MSGCODE_CONFIG_DIR",
  ] as const;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-r24-backend-lanes-"));
    workspacePath = path.join(tmpRoot, "workspace");
    routesFilePath = path.join(tmpRoot, "routes.json");
    fakeHome = path.join(tmpRoot, "home");

    for (const key of envKeys) {
      envBackup[key] = process.env[key];
    }

    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(path.join(fakeHome, ".config", "msgcode"), { recursive: true });

    process.env.HOME = fakeHome;
    process.env.MSGCODE_CONFIG_DIR = path.join(fakeHome, ".config", "msgcode");
    process.env.ROUTES_FILE_PATH = routesFilePath;
    process.env.WORKSPACE_ROOT = tmpRoot;
    delete process.env.AGENT_BACKEND;
    delete process.env.LOCAL_AGENT_BACKEND;
    delete process.env.MSGCODE_API_PROVIDER;

    setRoute(CHAT_ID, {
      chatGuid: CHAT_ID,
      workspacePath,
      label: "backend-lanes",
      botType: "agent-backend",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    for (const key of envKeys) {
      if (typeof envBackup[key] === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("local/api 分支应保留各自独立的模型覆盖", async () => {
    await handleBackendCommand({ chatId: CHAT_ID, args: ["local"] });
    await handleTextModelCommand({ chatId: CHAT_ID, args: ["local-text-model"] });
    await handleVisionModelCommand({ chatId: CHAT_ID, args: ["local-vision-model"] });

    let status = await handleModelCommand({ chatId: CHAT_ID, args: ["status"] });
    expect(status.success).toBe(true);
    expect(status.message).toContain("backend: local");
    expect(status.message).toContain("text-model: local-text-model");
    expect(status.message).toContain("vision-model: local-vision-model");
    expect(status.message).toContain("embedding-model: auto");

    await handleApiCommand({ chatId: CHAT_ID, args: ["deepseek"] });
    status = await handleModelCommand({ chatId: CHAT_ID, args: ["status"] });
    expect(status.message).toContain("backend: local");
    expect(status.message).toContain("api-provider: deepseek");
    expect(status.message).toContain("text-model: local-text-model");

    await handleBackendCommand({ chatId: CHAT_ID, args: ["api"] });
    status = await handleModelCommand({ chatId: CHAT_ID, args: ["status"] });
    expect(status.message).toContain("backend: api");
    expect(status.message).toContain("api-provider: deepseek");
    expect(status.message).toContain("text-model: auto");
    expect(status.message).toContain("vision-model: auto");

    await handleTextModelCommand({ chatId: CHAT_ID, args: ["api-text-model"] });
    await handleEmbeddingModelCommand({ chatId: CHAT_ID, args: ["api-embedding-model"] });

    status = await handleModelCommand({ chatId: CHAT_ID, args: ["status"] });
    expect(status.message).toContain("backend: api");
    expect(status.message).toContain("text-model: api-text-model");
    expect(status.message).toContain("embedding-model: api-embedding-model");
    expect(status.message).toContain("vision-model: auto");

    await handleBackendCommand({ chatId: CHAT_ID, args: ["local"] });
    status = await handleModelCommand({ chatId: CHAT_ID, args: ["status"] });
    expect(status.message).toContain("backend: local");
    expect(status.message).toContain("text-model: local-text-model");
    expect(status.message).toContain("vision-model: local-vision-model");
    expect(status.message).toContain("embedding-model: auto");
  });

  it("tmux 分支下模型命令应 fail-closed，状态页显示 n/a", async () => {
    await handleBackendCommand({ chatId: CHAT_ID, args: ["tmux"] });

    const setText = await handleTextModelCommand({ chatId: CHAT_ID, args: ["some-model"] });
    expect(setText.success).toBe(false);
    expect(setText.message).toContain("tmux 模式不支持本地/API 模型覆盖");

    const status = await handleModelCommand({ chatId: CHAT_ID, args: ["status"] });
    expect(status.success).toBe(true);
    expect(status.message).toContain("backend: tmux");
    expect(status.message).toContain("text-model: n/a (tmux)");
    expect(status.message).toContain("vision-model: n/a (tmux)");
    expect(status.message).toContain("embedding-model: n/a (tmux)");
  });

  it("tts-model 只允许 qwen|indextts|auto", async () => {
    await handleBackendCommand({ chatId: CHAT_ID, args: ["local"] });

    const invalid = await handleTtsModelCommand({ chatId: CHAT_ID, args: ["some-random-model"] });
    expect(invalid.success).toBe(false);
    expect(invalid.message).toContain("当前 tts-model 仅支持 qwen | indextts | auto");

    const valid = await handleTtsModelCommand({ chatId: CHAT_ID, args: ["qwen"] });
    expect(valid.success).toBe(true);
    expect(valid.message).toContain("tts-model: qwen");
  });
});

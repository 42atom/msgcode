/**
 * msgcode: P5.7-R8c Agent Backend 单源化回归锁
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { setRoute } from "../src/routes/store.js";
import { handleModelCommand } from "../src/routes/cmd-model.js";
import { loadWorkspaceConfig } from "../src/config/workspace.js";

const CHAT_ID = "any;+;r8c-single-source";

describe("P5.7-R8c: agent backend 单源化", () => {
  let tmpRoot = "";
  let workspacePath = "";
  let routesFilePath = "";
  let fakeHome = "";

  const envBackup: Record<string, string | undefined> = {};
  const envKeys = ["HOME", "ROUTES_FILE_PATH", "WORKSPACE_ROOT", "AGENT_BACKEND", "MSGCODE_CONFIG_DIR"] as const;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-r8c-single-source-"));
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

    setRoute(CHAT_ID, {
      chatGuid: CHAT_ID,
      workspacePath,
      label: "single-source",
      botType: "lmstudio",
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

  it("/model minimax 应写入全局 AGENT_BACKEND 并保持 workspace provider 不变", async () => {
    const result = await handleModelCommand({ chatId: CHAT_ID, args: ["minimax"] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("作用域：global");
    expect(process.env.AGENT_BACKEND).toBe("minimax");

    const envPath = path.join(fakeHome, ".config", "msgcode", ".env");
    expect(existsSync(envPath)).toBe(true);
    const envContent = await fs.readFile(envPath, "utf8");
    expect(envContent).toContain("AGENT_BACKEND=minimax");

    const workspaceConfig = await loadWorkspaceConfig(workspacePath);
    expect(workspaceConfig["runtime.kind"]).toBe("agent");
    expect(workspaceConfig["agent.provider"]).toBeUndefined();
  });

  it("/model 查询应显示全局 AGENT_BACKEND，而不是 workspace provider", async () => {
    process.env.AGENT_BACKEND = "minimax";

    const status = await handleModelCommand({ chatId: CHAT_ID, args: [] });

    expect(status.success).toBe(true);
    expect(status.message).toContain("Agent Backend: minimax");
    expect(status.message).toContain(path.join(fakeHome, ".config", "msgcode", ".env"));
  });
});

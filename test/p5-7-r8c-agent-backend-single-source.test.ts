/**
 * msgcode: P5.7-R8c Agent Backend 单源化回归锁
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { setRoute } from "../src/routes/store.js";
import {
  handleApiCommand,
  handleBackendCommand,
  handleModelCommand,
} from "../src/routes/cmd-model.js";
import { loadWorkspaceConfig } from "../src/config/workspace.js";

const CHAT_ID = "any;+;r8c-single-source";

describe("P5.7-R8c: agent backend 单源化", () => {
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

  it("/api minimax 在当前非 api 分支时只更新 api-provider 预设", async () => {
    const result = await handleApiCommand({ chatId: CHAT_ID, args: ["minimax"] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("api-provider: minimax");
    expect(result.message).toContain("backend: local");
    expect(process.env.AGENT_BACKEND).toBeUndefined();
    expect(process.env.MSGCODE_API_PROVIDER).toBe("minimax");

    const envPath = path.join(fakeHome, ".config", "msgcode", ".env");
    expect(existsSync(envPath)).toBe(true);
    const envContent = await fs.readFile(envPath, "utf8");
    expect(envContent).toContain("MSGCODE_API_PROVIDER=minimax");

    const workspaceConfig = await loadWorkspaceConfig(workspacePath);
    expect(workspaceConfig["runtime.kind"]).toBeUndefined();
    expect(workspaceConfig["agent.provider"]).toBeUndefined();
  });

  it("/backend api 应激活已保存的 api-provider", async () => {
    process.env.MSGCODE_API_PROVIDER = "minimax";

    const result = await handleBackendCommand({ chatId: CHAT_ID, args: ["api"] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("backend: api");
    expect(result.message).toContain("api-provider: minimax");
    expect(process.env.AGENT_BACKEND).toBe("minimax");

    const workspaceConfig = await loadWorkspaceConfig(workspacePath);
    expect(workspaceConfig["runtime.kind"]).toBe("agent");
  });

  it("/model omlx 应切到本地后端入口，并写入 LOCAL_AGENT_BACKEND", async () => {
    const result = await handleModelCommand({ chatId: CHAT_ID, args: ["omlx"] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("backend: local");
    expect(result.message).toContain("local-app: omlx");
    expect(process.env.AGENT_BACKEND).toBe("agent-backend");
    expect(process.env.LOCAL_AGENT_BACKEND).toBe("omlx");

    const envPath = path.join(fakeHome, ".config", "msgcode", ".env");
    expect(existsSync(envPath)).toBe(true);
    const envContent = await fs.readFile(envPath, "utf8");
    expect(envContent).toContain("AGENT_BACKEND=agent-backend");
    expect(envContent).toContain("LOCAL_AGENT_BACKEND=omlx");
  });

  it("/model status 应显示当前 backend 与分支预设，而不是 workspace provider", async () => {
    process.env.AGENT_BACKEND = "minimax";
    process.env.LOCAL_AGENT_BACKEND = "omlx";
    process.env.MSGCODE_API_PROVIDER = "minimax";

    const status = await handleModelCommand({ chatId: CHAT_ID, args: [] });

    expect(status.success).toBe(true);
    expect(status.message).toContain("backend: api");
    expect(status.message).toContain("local-app: omlx");
    expect(status.message).toContain("api-provider: minimax");
    expect(status.message).not.toContain("agent.provider");
  });
});

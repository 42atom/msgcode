/**
 * msgcode: 默认工作区命令 fallback 回归锁
 *
 * 目标：
 * - 命令链路未显式 /bind 时，也应落到 default workspace
 * - 显式绑定优先于 default fallback
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleMemCommand } from "../src/routes/cmd-memory.js";
import { resolveCommandRoute } from "../src/routes/workspace-resolver.js";
import { getRouteByChatId, setRoute } from "../src/routes/store.js";
import { routeByChatId } from "../src/router.js";

const TEST_ROOT = path.join(os.tmpdir(), "msgcode-r13-default-workspace");
const TEST_ROUTES = path.join(os.tmpdir(), ".config/msgcode/routes-r13-default-workspace.json");

function cleanTestData(): void {
  if (fs.existsSync(TEST_ROUTES)) {
    fs.unlinkSync(TEST_ROUTES);
  }
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

describe("P5.7-R13: default workspace command fallback", () => {
  beforeEach(() => {
    cleanTestData();
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    process.env.WORKSPACE_ROOT = TEST_ROOT;
    process.env.ROUTES_FILE_PATH = TEST_ROUTES;
    process.env.MSGCODE_DEFAULT_WORKSPACE_DIR = "default";
  });

  afterEach(() => {
    cleanTestData();
  });

  it("未显式绑定时，命令链路应回落到 default workspace", async () => {
    const chatId = "feishu:oc_default_fallback";
    const defaultWorkspace = path.join(TEST_ROOT, "default");

    const resolved = resolveCommandRoute(chatId);
    expect(resolved).not.toBeNull();
    expect(resolved?.explicitBinding).toBe(false);
    expect(resolved?.route.workspacePath).toBe(defaultWorkspace);

    const result = await handleMemCommand({
      chatId,
      args: ["status"],
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("记忆注入状态");
    expect(result.message).toContain(`工作目录: ${defaultWorkspace}`);
  });

  it("未显式绑定的新群首次落到 default 时，不应被系统自动持久化为真实 route", () => {
    const chatId = "feishu:oc_auto_default_bind";
    const defaultWorkspace = path.join(TEST_ROOT, "default");

    const routed = routeByChatId(chatId);
    expect(routed).not.toBeNull();
    expect(routed?.projectDir).toBe(defaultWorkspace);

    const persisted = getRouteByChatId(chatId);
    expect(persisted).toBeNull();
  });

  it("显式绑定存在时，应优先使用显式 workspace", async () => {
    const chatId = "feishu:oc_explicit_binding";
    const explicitWorkspace = path.join(TEST_ROOT, "acme", "ops");
    fs.mkdirSync(explicitWorkspace, { recursive: true });

    setRoute(chatId, {
      chatGuid: chatId,
      chatId,
      workspacePath: explicitWorkspace,
      label: "acme/ops",
      botType: "agent-backend",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const resolved = resolveCommandRoute(chatId);
    expect(resolved).not.toBeNull();
    expect(resolved?.explicitBinding).toBe(true);
    expect(resolved?.route.workspacePath).toBe(explicitWorkspace);

    const result = await handleMemCommand({
      chatId,
      args: ["status"],
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("记忆注入状态");
    expect(result.message).toContain("acme/ops");
    expect(result.message).not.toContain(path.join(TEST_ROOT, "default"));
  });
});

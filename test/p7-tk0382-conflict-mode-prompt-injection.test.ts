import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildDialogSystemPrompt, buildExecSystemPrompt, runAgentChat, type AgentBackendRuntime } from "../src/agent-backend/index.js";
import { getConflictMode } from "../src/config/workspace.js";
import { handleRouteCommand, isRouteCommand, parseRouteCommand } from "../src/routes/commands.js";
import { setRoute } from "../src/routes/store.js";

const CHAT_ID = "any;+;tk0382";
const ORIGINAL_FETCH = globalThis.fetch;

describe("tk0382: conflict mode prompt injection", () => {
  let tmpRoot = "";
  let workspacePath = "";
  let routesFilePath = "";
  const envBackup: Record<string, string | undefined> = {};
  const envKeys = [
    "ROUTES_FILE_PATH",
    "WORKSPACE_ROOT",
  ] as const;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-tk0382-"));
    workspacePath = path.join(tmpRoot, "workspace");
    routesFilePath = path.join(tmpRoot, "routes.json");
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(path.join(workspacePath, ".msgcode", "config.json"), JSON.stringify({}, null, 2), "utf-8");

    for (const key of envKeys) {
      envBackup[key] = process.env[key];
    }
    process.env.ROUTES_FILE_PATH = routesFilePath;
    process.env.WORKSPACE_ROOT = tmpRoot;

    setRoute(CHAT_ID, {
      chatGuid: CHAT_ID,
      workspacePath,
      label: "tk0382-workspace",
      botType: "agent-backend",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    globalThis.fetch = ORIGINAL_FETCH;
    for (const key of envKeys) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("应识别并解析 /conflict-mode 命令", () => {
    expect(isRouteCommand("/conflict-mode assisted")).toBe(true);
    expect(parseRouteCommand("/conflict-mode assisted")).toEqual({
      command: "conflictMode",
      args: ["assisted"],
    });
  });

  it("workspace config 应支持 conflict mode 读写，命令入口应可热切换", async () => {
    const first = await handleRouteCommand("conflictMode", {
      chatId: CHAT_ID,
      args: ["assisted"],
    });
    expect(first.success).toBe(true);
    expect(first.message).toContain("下一轮 prompt 注入立即生效");
    expect(await getConflictMode(workspacePath)).toBe("assisted");

    const second = await handleRouteCommand("conflictMode", {
      chatId: CHAT_ID,
      args: ["full"],
    });
    expect(second.success).toBe(true);
    expect(await getConflictMode(workspacePath)).toBe("full");
  });

  it("dialog/exec prompt 应注入不同 conflict mode 片段，且下一轮 runAgentChat 立即生效", async () => {
    const dialogFull = buildDialogSystemPrompt("基础提示词", false, undefined, "full");
    const dialogAssisted = buildDialogSystemPrompt("基础提示词", false, undefined, "assisted");
    const execAssisted = buildExecSystemPrompt("基础提示词", false, "assisted");

    expect(dialogFull).toContain("优先自己收口");
    expect(dialogAssisted).toContain("给出编号选项并等待确认");
    expect(execAssisted).toContain("给出编号选项并等待确认");

    const runtime: AgentBackendRuntime = {
      id: "openai",
      baseUrl: "https://api.openai.test",
      apiKey: "test-key",
      model: "gpt-test",
      timeoutMs: 10_000,
      nativeApiEnabled: false,
    };
    const capturedSystems: string[] = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
      capturedSystems.push(String(messages[0]?.content || ""));
      return new Response(JSON.stringify({
        choices: [
          {
            message: { content: "ok" },
            finish_reason: "stop",
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await handleRouteCommand("conflictMode", { chatId: CHAT_ID, args: ["full"] });
    await runAgentChat({
      prompt: "直接回答",
      system: "基础提示词",
      workspace: workspacePath,
      backendRuntime: runtime,
    });

    await handleRouteCommand("conflictMode", { chatId: CHAT_ID, args: ["assisted"] });
    await runAgentChat({
      prompt: "直接回答",
      system: "基础提示词",
      workspace: workspacePath,
      backendRuntime: runtime,
    });

    expect(capturedSystems).toHaveLength(2);
    expect(capturedSystems[0]).toContain("优先自己收口");
    expect(capturedSystems[1]).toContain("给出编号选项并等待确认");
  });
});

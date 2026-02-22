/**
 * msgcode: P5.7-R8b Agent Backend 切换回归锁
 *
 * 目标：验证 minimax 与 lmstudio 可往返切换且不串线。
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setRoute } from "../src/routes/store.js";
import { handleModelCommand } from "../src/routes/cmd-model.js";
import { getAgentProvider, getRuntimeKind } from "../src/config/workspace.js";
import { runLmStudioRoutedChat } from "../src/lmstudio.js";
import { recoverDegrade } from "../src/slo-degrade.js";

const CHAT_ID = "any;+;r8b-switch";
const ENV_KEYS = [
  "ROUTES_FILE_PATH",
  "WORKSPACE_ROOT",
  "LMSTUDIO_BASE_URL",
  "LMSTUDIO_MODEL",
  "LMSTUDIO_API_KEY",
  "LMSTUDIO_ENABLE_MCP",
  "MINIMAX_BASE_URL",
  "MINIMAX_MODEL",
  "MINIMAX_API_KEY",
  "AGENT_BASE_URL",
  "AGENT_MODEL",
  "AGENT_API_KEY",
  "AGENT_TIMEOUT_MS",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

function setEnvValue(key: EnvKey, value: string | undefined): void {
  if (typeof value === "undefined") {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe("P5.7-R8b: agent backend minimax/lmstudio 往返切换", () => {
  let tmpRoot = "";
  let workspacePath = "";
  let routesFilePath = "";
  let envBackup: Partial<Record<EnvKey, string | undefined>> = {};
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-r8b-switch-"));
    workspacePath = path.join(tmpRoot, "workspace");
    routesFilePath = path.join(tmpRoot, "routes.json");
    await fs.mkdir(workspacePath, { recursive: true });

    envBackup = {};
    for (const key of ENV_KEYS) {
      envBackup[key] = process.env[key];
    }

    setEnvValue("ROUTES_FILE_PATH", routesFilePath);
    setEnvValue("WORKSPACE_ROOT", tmpRoot);
    setEnvValue("LMSTUDIO_BASE_URL", "http://lmstudio.test");
    setEnvValue("LMSTUDIO_MODEL", "glm-local-test");
    setEnvValue("LMSTUDIO_API_KEY", "lm-key");
    setEnvValue("LMSTUDIO_ENABLE_MCP", "0");
    setEnvValue("MINIMAX_BASE_URL", "http://minimax.test");
    setEnvValue("MINIMAX_MODEL", "minimax-test-model");
    setEnvValue("MINIMAX_API_KEY", "mini-key");
    setEnvValue("AGENT_BASE_URL", undefined);
    setEnvValue("AGENT_MODEL", undefined);
    setEnvValue("AGENT_API_KEY", undefined);
    setEnvValue("AGENT_TIMEOUT_MS", "5000");

    setRoute(CHAT_ID, {
      chatGuid: CHAT_ID,
      workspacePath,
      label: "switch-test",
      botType: "lmstudio",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 统一恢复到正常态，避免被其他测试/本地状态污染
    recoverDegrade("LEVEL_0");

    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;

    recoverDegrade("LEVEL_0");

    for (const key of ENV_KEYS) {
      setEnvValue(key, envBackup[key]);
    }

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("/model 支持 minimax <-> lmstudio 往返切换且保持 agent 形态", async () => {
    const toMinimax = await handleModelCommand({
      chatId: CHAT_ID,
      args: ["minimax"],
    });
    expect(toMinimax.success).toBe(true);
    expect(toMinimax.message).toContain("minimax");
    expect(await getRuntimeKind(workspacePath)).toBe("agent");
    // R8c 单源化口径：provider 由全局 AGENT_BACKEND 决定，workspace provider 不写入
    expect(process.env.AGENT_BACKEND).toBe("minimax");
    // P5.7-R9-T6: 默认值改为 agent-backend
    expect(await getAgentProvider(workspacePath)).toBe("agent-backend");

    const toLocal = await handleModelCommand({
      chatId: CHAT_ID,
      args: ["lmstudio"],
    });
    expect(toLocal.success).toBe(true);
    expect(toLocal.message).toContain("agent-backend");
    expect(await getRuntimeKind(workspacePath)).toBe("agent");
    // R9-T6+ 后统一回写中性主语，lmstudio 仅作为输入别名
    expect(process.env.AGENT_BACKEND).toBe("agent-backend");
    // P5.7-R9-T6: 默认值改为 agent-backend
    expect(await getAgentProvider(workspacePath)).toBe("agent-backend");

    const toMinimaxAgain = await handleModelCommand({
      chatId: CHAT_ID,
      args: ["minimax"],
    });
    expect(toMinimaxAgain.success).toBe(true);
    expect(await getRuntimeKind(workspacePath)).toBe("agent");
    expect(process.env.AGENT_BACKEND).toBe("minimax");
    // P5.7-R9-T6: 默认值改为 agent-backend
    expect(await getAgentProvider(workspacePath)).toBe("agent-backend");
  });

  it("切换后 routed chat 命中对应后端端点，不发生串线", async () => {
    const calledUrls: string[] = [];
    const calledModels: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      calledUrls.push(url);

      const rawBody = typeof init?.body === "string" ? init.body : "";
      if (rawBody) {
        const parsed = JSON.parse(rawBody) as { model?: unknown };
        if (typeof parsed.model === "string") {
          calledModels.push(parsed.model);
        }
      }

      if (url === "http://minimax.test/v1/chat/completions") {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "mini ok" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url === "http://lmstudio.test/api/v1/chat") {
        return new Response(
          JSON.stringify({
            output: [{ type: "message", content: "local ok" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response("not found", { status: 404 });
    };

    const minimaxResult = await runLmStudioRoutedChat({
      prompt: "请直接回复一句确认",
      workspacePath,
      agentProvider: "minimax",
      hasToolsAvailable: false,
    });

    expect(minimaxResult.route).toBe("no-tool");
    expect(minimaxResult.answer).toBe("mini ok");

    const lmstudioResult = await runLmStudioRoutedChat({
      prompt: "请直接回复一句确认",
      workspacePath,
      agentProvider: "lmstudio",
      hasToolsAvailable: false,
    });

    expect(lmstudioResult.route).toBe("no-tool");
    expect(lmstudioResult.answer).toBe("local ok");

    expect(calledUrls).toContain("http://minimax.test/v1/chat/completions");
    expect(calledUrls).toContain("http://lmstudio.test/api/v1/chat");
    expect(calledModels).toContain("minimax-test-model");
    expect(calledModels).toContain("glm-local-test");
  });
});

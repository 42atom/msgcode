/**
 * msgcode: P5.7-R8d 模型切换链路同步回归锁
 *
 * 目标：
 * - 全局后端模型已配置时，分类器与主回答链路必须使用同一模型
 * - workspace 的 executor/responder 配置不应覆盖全局后端模型
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { saveWorkspaceConfig } from "../src/config/workspace.js";
import { runLmStudioRoutedChat } from "../src/lmstudio.js";
import { recoverDegrade } from "../src/slo-degrade.js";

describe("P5.7-R8d: model switch chain sync", () => {
  let tmpRoot = "";
  let workspacePath = "";
  let originalFetch: typeof globalThis.fetch;

  const envKeys = [
    "MINIMAX_BASE_URL",
    "MINIMAX_MODEL",
    "MINIMAX_API_KEY",
    "AGENT_MODEL",
    "AGENT_BACKEND",
  ] as const;
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-r8d-chain-sync-"));
    workspacePath = path.join(tmpRoot, "workspace");
    await fs.mkdir(workspacePath, { recursive: true });

    await saveWorkspaceConfig(workspacePath, {
      "model.executor": "workspace-executor-should-not-win",
      "model.responder": "workspace-responder-should-not-win",
    });

    for (const key of envKeys) {
      envBackup[key] = process.env[key];
    }

    process.env.MINIMAX_BASE_URL = "http://minimax.test";
    process.env.MINIMAX_MODEL = "minimax-chain-sync-model";
    process.env.MINIMAX_API_KEY = "mini-key";
    process.env.AGENT_BACKEND = "minimax";
    delete process.env.AGENT_MODEL;

    recoverDegrade("LEVEL_0");
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    recoverDegrade("LEVEL_0");

    for (const key of envKeys) {
      if (typeof envBackup[key] === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("应把分类器与 no-tool 主回答统一绑定到后端模型", async () => {
    const calledModels: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url !== "http://minimax.test/v1/chat/completions") {
        return new Response("not found", { status: 404 });
      }

      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { model?: string; messages?: Array<{ role?: string; content?: string }> }
        : {};

      if (typeof body.model === "string") {
        calledModels.push(body.model);
      }

      const isClassifierCall = (body.messages || [])
        .some((msg) => msg.role === "user" && typeof msg.content === "string" && msg.content.includes("请判断以下用户请求应走哪条路由"));

      if (isClassifierCall) {
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: "{\"route\":\"no-tool\",\"confidence\":\"high\",\"reason\":\"test\"}",
              },
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: "chain-sync-ok",
            },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await runLmStudioRoutedChat({
      prompt: "请简单回答：hello",
      workspacePath,
      agentProvider: "minimax",
      hasToolsAvailable: true,
    });

    expect(result.route).toBe("no-tool");
    expect(result.answer).toBe("chain-sync-ok");
    expect(calledModels.length).toBeGreaterThanOrEqual(2);
    expect(calledModels.every((model) => model === "minimax-chain-sync-model")).toBe(true);
    expect(calledModels).not.toContain("workspace-executor-should-not-win");
    expect(calledModels).not.toContain("workspace-responder-should-not-win");
  });
});


/**
 * P5.7-R6b 回归锁：默认模型优先级应锁运行时行为，不锁源码写法
 */

import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { runAgentChat } from "../src/agent-backend/chat.js";
import {
  AGENT_BACKEND_DEFAULT_CHAT_MODEL,
  LMSTUDIO_DEFAULT_CHAT_MODEL,
} from "../src/agent-backend/prompt.js";
import type { AgentBackendRuntime } from "../src/agent-backend/types.js";
import { runVision } from "../src/runners/vision.js";
import { resolveLocalVisionModel } from "../src/local-backend/registry.js";
import { setBranchModel } from "../src/config/workspace.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  "LOCAL_AGENT_BACKEND",
  "LMSTUDIO_BASE_URL",
  "LMSTUDIO_MODEL",
  "LMSTUDIO_VISION_MODEL",
] as const;

function snapshotEnv(): Map<string, string | undefined> {
  const snapshot = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) snapshot.set(key, process.env[key]);
  return snapshot;
}

function restoreEnv(snapshot: Map<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createTinyPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==",
    "base64"
  );
}

async function createVisionWorkspace(prefix: string): Promise<{ workspacePath: string; imagePath: string }> {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
  await writeFile(path.join(workspacePath, ".msgcode", "config.json"), JSON.stringify({}, null, 2), "utf-8");
  const imagePath = path.join(workspacePath, "avatar.png");
  await writeFile(imagePath, createTinyPngBuffer());
  return { workspacePath, imagePath };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("P5.7-R6b: 默认模型优先级", () => {
  it("文本默认模型常量应保持稳定，并保留 LM Studio 兼容别名", () => {
    expect(AGENT_BACKEND_DEFAULT_CHAT_MODEL).toBe("huihui-glm-4.7-flash-abliterated-mlx");
    expect(LMSTUDIO_DEFAULT_CHAT_MODEL).toBe(AGENT_BACKEND_DEFAULT_CHAT_MODEL);
  });

  it("未显式配置文本模型时，应优先命中稳定默认模型", async () => {
    const backendRuntime: AgentBackendRuntime = {
      id: "local-openai",
      baseUrl: "http://127.0.0.1:12431",
      timeoutMs: 10_000,
      nativeApiEnabled: true,
      localBackendId: "lmstudio",
      supportsModelLifecycle: true,
      modelsListPath: "/api/v1/models",
    };
    let chatBody: Record<string, unknown> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models")) {
        return new Response(JSON.stringify({
          models: [
            {
              type: "llm",
              key: AGENT_BACKEND_DEFAULT_CHAT_MODEL,
              loaded_instances: [{ id: "loaded" }],
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      chatBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "text", text: "默认模型命中" }] }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const answer = await runAgentChat({
      prompt: "直接回答",
      backendRuntime,
    });

    expect(answer).toContain("默认模型命中");
    expect(chatBody.model).toBe(AGENT_BACKEND_DEFAULT_CHAT_MODEL);
  });

  it("视觉链路未显式配置时，应回退稳定默认视觉模型", () => {
    expect(resolveLocalVisionModel({
      id: "lmstudio",
      baseUrl: "http://127.0.0.1:12432",
      timeoutMs: 10_000,
      nativeApiEnabled: true,
      supportsModelLifecycle: true,
      modelsListPath: "/api/v1/models",
    }, "huihui-glm-4.6v-flash-abliterated-mlx")).toBe("huihui-glm-4.6v-flash-abliterated-mlx");
  });

  it("workspace 显式配置的视觉模型应覆盖默认回退值", async () => {
    const envSnapshot = snapshotEnv();
    process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:12433";
    process.env.LOCAL_AGENT_BACKEND = "lmstudio";
    process.env.LMSTUDIO_MODEL = "auto";
    process.env.LMSTUDIO_VISION_MODEL = "auto";

    const { workspacePath, imagePath } = await createVisionWorkspace("msgcode-r6b-vision-workspace-");
    await setBranchModel(workspacePath, "local", "vision", "workspace-vlm");

    let requestBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return new Response(JSON.stringify({
        choices: [{ message: { content: "workspace override" } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const result = await runVision({
        workspacePath,
        imagePath,
      });

      expect(result.success).toBe(true);
      expect(result.modelId).toBe("workspace-vlm");
      expect(requestBody.model).toBe("workspace-vlm");
    } finally {
      restoreEnv(envSnapshot);
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it(".env.example 应继续暴露文本/视觉默认模型建议", () => {
    const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf-8");

    expect(envExample).toContain("LMSTUDIO_MODEL=huihui-glm-4.7-flash-abliterated-mlx");
    expect(envExample).toContain("LMSTUDIO_VISION_MODEL=huihui-glm-4.6v-flash-abliterated-mlx");
  });
});

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { resetModelServiceLeaseManager } from "../src/runtime/model-service-lease.js";

function writeTinyPng(filePath: string): void {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0fcAAAAASUVORK5CYII=";
  writeFileSync(filePath, Buffer.from(pngBase64, "base64"));
}

function asJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("P5.7-R23: vision 主链收口", () => {
  let workspacePath = "";
  let imagePath = "";
  let originalFetch: typeof globalThis.fetch;
  let envBackups: Record<string, string | undefined>;

  beforeEach(() => {
    workspacePath = join(tmpdir(), `msgcode-vision-${randomUUID()}`);
    imagePath = join(workspacePath, "table.png");
    mkdirSync(workspacePath, { recursive: true });
    writeTinyPng(imagePath);
    originalFetch = globalThis.fetch;
    envBackups = {
      LOCAL_AGENT_BACKEND: process.env.LOCAL_AGENT_BACKEND,
      OMLX_BASE_URL: process.env.OMLX_BASE_URL,
      OMLX_API_KEY: process.env.OMLX_API_KEY,
      OMLX_VISION_MODEL: process.env.OMLX_VISION_MODEL,
    };
    process.env.LOCAL_AGENT_BACKEND = "lmstudio";
    delete process.env.OMLX_BASE_URL;
    delete process.env.OMLX_API_KEY;
    delete process.env.OMLX_VISION_MODEL;
  });

  afterEach(async () => {
    mock.restore();
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envBackups)) {
      if (typeof value === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await resetModelServiceLeaseManager();
    if (workspacePath && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("自动图片摘要主链不应偷用用户提问做预处理", async () => {
    const listenerCode = fs.readFileSync(join(process.cwd(), "src", "listener.ts"), "utf-8");
    const pipelineCode = fs.readFileSync(join(process.cwd(), "src", "media", "pipeline.ts"), "utf-8");

    expect(listenerCode).toContain("processAttachment(copyResult.localPath, attachment, workspacePath)");
    expect(listenerCode).not.toContain("processAttachment(copyResult.localPath, attachment, workspacePath, text)");
    expect(listenerCode).not.toContain("请用一句话概括主要内容。");
    expect(pipelineCode).toContain('executeTool("vision", { imagePath: vaultPath }');
    expect(pipelineCode).not.toContain("userQuery");
    expect(pipelineCode).toContain('kind: "vision"');
  });

  it("用户带任务调用 vision 时，不应被摘要缓存污染", async () => {
    const digest = createHash("sha256").update(await readFile(imagePath)).digest("hex").slice(0, 12);
    const visionDir = join(workspacePath, "artifacts", "vision");
    mkdirSync(visionDir, { recursive: true });
    const summaryPath = join(visionDir, `${digest}.txt`);
    writeFileSync(summaryPath, "这是一张表格截图。", "utf-8");

    const prompts: string[] = [];
    const maxTokens: number[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const prompt = body?.messages?.[0]?.content?.[0]?.text;
      if (typeof prompt === "string") {
        prompts.push(prompt);
      }
      if (typeof body?.max_tokens === "number") {
        maxTokens.push(body.max_tokens);
      }
      return asJsonResponse({
        choices: [
          {
            message: {
              content: "List of Liquids\nFreezing Point\nVaporization Point",
            },
          },
        ],
      });
    }) as typeof globalThis.fetch;

    const { runVision } = await import("../src/runners/vision.js");

    const result = await runVision({
      workspacePath,
      imagePath,
      userQuery: "请提取图片中的表格文字并尽量保留结构",
    });

    expect(result.success).toBe(true);
    expect(result.textPreview).toContain("List of Liquids");
    expect(result.textPath).toContain(".q-");
    expect(result.textPath).not.toBe(summaryPath);
    expect(prompts).toHaveLength(1);
    expect(maxTokens).toEqual([2048]);
    expect(prompts[0]).toContain("用户要求：请提取图片中的表格文字并尽量保留结构");
    expect(prompts[0]).not.toContain("一句话说清楚");
    expect(prompts[0]).not.toContain("用一句话简洁描述");
  });

  it("无用户任务时，应继续复用摘要缓存", async () => {
    const digest = createHash("sha256").update(await readFile(imagePath)).digest("hex").slice(0, 12);
    const visionDir = join(workspacePath, "artifacts", "vision");
    mkdirSync(visionDir, { recursive: true });
    const summaryPath = join(visionDir, `${digest}.txt`);
    writeFileSync(summaryPath, "这是一张表格截图。", "utf-8");

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return asJsonResponse({
        choices: [{ message: { content: "unexpected" } }],
      });
    }) as typeof globalThis.fetch;

    const { runVision } = await import("../src/runners/vision.js");

    const result = await runVision({
      workspacePath,
      imagePath,
    });

    expect(result.success).toBe(true);
    expect(result.textPath).toBe(summaryPath);
    expect(result.textPreview).toBe("这是一张表格截图。");
    expect(fetchCalls).toBe(0);
  });

  it("OMLX 视觉链应在 model_type=llm 时 fail-closed", async () => {
    const backups = {
      LOCAL_AGENT_BACKEND: process.env.LOCAL_AGENT_BACKEND,
      OMLX_BASE_URL: process.env.OMLX_BASE_URL,
      OMLX_API_KEY: process.env.OMLX_API_KEY,
      OMLX_VISION_MODEL: process.env.OMLX_VISION_MODEL,
    };

    try {
      process.env.LOCAL_AGENT_BACKEND = "omlx";
      process.env.OMLX_BASE_URL = "http://127.0.0.1:8000";
      process.env.OMLX_API_KEY = "omlx-key";
      process.env.OMLX_VISION_MODEL = "Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit";

      const requestedUrls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);

        if (url.endsWith("/v1/models/status")) {
          return asJsonResponse({
            models: [
              {
                id: "Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit",
                model_type: "llm",
                engine_type: "batched",
              },
            ],
          });
        }

        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof globalThis.fetch;

      const { runVision } = await import("../src/runners/vision.js");
      const result = await runVision({ workspacePath, imagePath });

      expect(result.success).toBe(false);
      expect(result.error).toContain("model_type=llm");
      expect(requestedUrls).toEqual(["http://127.0.0.1:8000/v1/models/status"]);
    } finally {
      for (const [key, value] of Object.entries(backups)) {
        if (typeof value === "undefined") {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("OMLX 视觉链应只在 model_type=vlm 时放行图片请求", async () => {
    const backups = {
      LOCAL_AGENT_BACKEND: process.env.LOCAL_AGENT_BACKEND,
      OMLX_BASE_URL: process.env.OMLX_BASE_URL,
      OMLX_API_KEY: process.env.OMLX_API_KEY,
      OMLX_VISION_MODEL: process.env.OMLX_VISION_MODEL,
    };

    try {
      process.env.LOCAL_AGENT_BACKEND = "omlx";
      process.env.OMLX_BASE_URL = "http://127.0.0.1:8000";
      process.env.OMLX_API_KEY = "omlx-key";
      process.env.OMLX_VISION_MODEL = "Qwen3.5-4B-MLX-4bit";

      const requestedUrls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requestedUrls.push(url);

        if (url.endsWith("/v1/models/status")) {
          return asJsonResponse({
            models: [
              {
                id: "Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit",
                model_type: "llm",
                engine_type: "batched",
              },
              {
                id: "Qwen3.5-4B-MLX-4bit",
                model_type: "vlm",
                engine_type: "vlm",
              },
            ],
          });
        }

        if (url.endsWith("/v1/chat/completions")) {
          const headers = init?.headers as Record<string, string> | undefined;
          expect(headers?.Authorization).toBe("Bearer omlx-key");
          return asJsonResponse({
            choices: [{ message: { content: "一个卡通男性头像。" } }],
          });
        }

        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof globalThis.fetch;

      const { runVision } = await import("../src/runners/vision.js");
      const result = await runVision({ workspacePath, imagePath });

      expect(result.success).toBe(true);
      expect(result.textPreview).toContain("卡通男性头像");
      expect(requestedUrls).toEqual([
        "http://127.0.0.1:8000/v1/models/status",
        "http://127.0.0.1:8000/v1/chat/completions",
      ]);
    } finally {
      for (const [key, value] of Object.entries(backups)) {
        if (typeof value === "undefined") {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

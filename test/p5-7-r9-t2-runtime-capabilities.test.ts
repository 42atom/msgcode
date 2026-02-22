/**
 * msgcode: P5.7-R9-T2 运行时能力解析回归锁
 *
 * 目标：
 * - API 优先获取 context window
 * - 表覆盖兜底
 * - 环境变量显式覆盖
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  clearRuntimeCapabilityCache,
  resolveRuntimeCapabilities,
} from "../src/capabilities";

type FetchFn = typeof globalThis.fetch;

describe("P5.7-R9-T2: runtime capabilities resolver", () => {
  const envKeys = [
    "AGENT_BACKEND",
    "AGENT_BASE_URL",
    "AGENT_MODEL",
    "AGENT_TIMEOUT_MS",
    "AGENT_API_KEY",
    "AGENT_CONTEXT_WINDOW_TOKENS",
    "AGENT_RESERVED_OUTPUT_TOKENS",
    "AGENT_CHARS_PER_TOKEN",
    "LMSTUDIO_BASE_URL",
    "LMSTUDIO_MODEL",
    "LMSTUDIO_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAI_API_KEY",
    "MINIMAX_BASE_URL",
    "MINIMAX_MODEL",
    "MINIMAX_API_KEY",
  ] as const;

  const envBackup: Record<string, string | undefined> = {};
  let originalFetch: FetchFn;

  beforeEach(() => {
    clearRuntimeCapabilityCache();
    originalFetch = globalThis.fetch;
    for (const key of envKeys) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    clearRuntimeCapabilityCache();
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (typeof envBackup[key] === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
  });

  it("环境变量显式覆盖应优先于 API 与表覆盖", async () => {
    process.env.AGENT_BACKEND = "minimax";
    process.env.AGENT_CONTEXT_WINDOW_TOKENS = "77777";
    process.env.AGENT_RESERVED_OUTPUT_TOKENS = "3333";
    process.env.AGENT_CHARS_PER_TOKEN = "3";

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as FetchFn;

    const caps = await resolveRuntimeCapabilities({ agentProvider: "minimax" });

    expect(caps.source).toBe("env-override");
    expect(caps.contextWindowTokens).toBe(77777);
    expect(caps.reservedOutputTokens).toBe(3333);
    expect(caps.charsPerToken).toBe(3);
    expect(fetchCalls).toBe(0);
  });

  it("local-openai 应优先使用 /api/v1/models 动态 context window", async () => {
    process.env.AGENT_BACKEND = "lmstudio";
    process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:1234";
    process.env.LMSTUDIO_MODEL = "huihui-glm-4.7-flash-abliterated-mlx";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        data: [
          {
            id: "huihui-glm-4.7-flash-abliterated-mlx",
            max_context_length: 32000,
            loaded_instances: [
              {
                config: { context_length: 28672 },
              },
            ],
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as FetchFn;

    const caps = await resolveRuntimeCapabilities({ agentProvider: "lmstudio" });

    expect(caps.provider).toBe("local-openai");
    expect(caps.source).toBe("api-models");
    expect(caps.contextWindowTokens).toBe(28672);
    expect(caps.reservedOutputTokens).toBeGreaterThan(0);
  });

  it("API 无法提供时应回退到模型表覆盖", async () => {
    process.env.AGENT_BACKEND = "minimax";
    process.env.MINIMAX_BASE_URL = "https://api.minimax.chat";
    process.env.MINIMAX_MODEL = "MiniMax-M2";

    globalThis.fetch = (async () => {
      return new Response("{}", {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }) as FetchFn;

    const caps = await resolveRuntimeCapabilities({ agentProvider: "minimax" });

    expect(caps.source).toBe("model-table");
    expect(caps.contextWindowTokens).toBe(204800);
  });

  it("模型表未命中时应回退到 provider 默认表", async () => {
    process.env.AGENT_BACKEND = "openai";
    process.env.OPENAI_BASE_URL = "https://api.openai.com";
    process.env.OPENAI_MODEL = "unknown-model-family";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        data: [{ id: "unknown-model-family" }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as FetchFn;

    const caps = await resolveRuntimeCapabilities({ agentProvider: "openai" });

    expect(caps.source).toBe("provider-table");
    expect(caps.contextWindowTokens).toBe(128000);
  });

  it("相同查询应命中缓存，避免重复请求", async () => {
    process.env.AGENT_BACKEND = "openai";
    process.env.OPENAI_BASE_URL = "https://api.openai.com";
    process.env.OPENAI_MODEL = "gpt-4.1-mini";

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({
        data: [{ id: "gpt-4.1-mini", max_context_length: 128000 }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as FetchFn;

    const first = await resolveRuntimeCapabilities({ agentProvider: "openai" });
    const second = await resolveRuntimeCapabilities({ agentProvider: "openai" });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(fetchCalls).toBe(1);
    expect(second.contextWindowTokens).toBe(128000);
  });
});


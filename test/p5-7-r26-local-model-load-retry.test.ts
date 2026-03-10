import { afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("P5.7-R26: 本地模型 2 次 load 重试", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maybeReloadLocalModelAndRetry 应命中 load 端点并返回 true", async () => {
    const { maybeReloadLocalModelAndRetry } = await import("../src/runtime/model-service-lease.js");
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      return new Response("{}", {
        status: String(input).includes("/api/v1/models/load") ? 200 : 404,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const shouldRetry = await maybeReloadLocalModelAndRetry({
      module: "test",
      baseUrl: "http://127.0.0.1:1234",
      model: "huihui-glm-4.7-flash-abliterated-mlx",
      errorMessage: "LM Studio API 错误 (400)：The model has crashed without additional information.",
      attempt: 0,
      delayMs: 0,
    });

    expect(shouldRetry).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/models/load");
  });

  it("达到第 2 次重试后不应继续 reload", async () => {
    const { maybeReloadLocalModelAndRetry } = await import("../src/runtime/model-service-lease.js");
    const fetchMock = mock(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const shouldRetry = await maybeReloadLocalModelAndRetry({
      module: "test",
      baseUrl: "http://127.0.0.1:1234",
      model: "huihui-glm-4.7-flash-abliterated-mlx",
      errorMessage: "Model unloaded",
      attempt: 2,
      delayMs: 0,
    });

    expect(shouldRetry).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chat/vision/emotion 都应接入同一 reload helper", () => {
    const chatCode = readFileSync(join(process.cwd(), "src", "agent-backend", "chat.ts"), "utf-8");
    const visionCode = readFileSync(join(process.cwd(), "src", "runners", "vision.ts"), "utf-8");
    const emotionCode = readFileSync(join(process.cwd(), "src", "runners", "tts", "emotion.ts"), "utf-8");

    expect(chatCode).toContain("LOCAL_MODEL_LOAD_MAX_RETRIES");
    expect(chatCode).toContain("maybeReloadLocalModelAndRetry");
    expect(chatCode).toContain("const firstCatalogModel = await fetchFirstModelId");
    expect(visionCode).toContain("maybeReloadLocalModelAndRetry");
    expect(emotionCode).toContain("maybeReloadLocalModelAndRetry");
  });
});

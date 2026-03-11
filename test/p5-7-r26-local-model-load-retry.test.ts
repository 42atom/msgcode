import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  createLocalModelLoadAction,
  maybeReloadLocalModelAndRetry,
  shouldRetryLocalModelLoad,
} from "../src/runtime/model-service-lease.js";

describe("P5.7-R26: 本地模型 load/retry 合同", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maybeReloadLocalModelAndRetry 应命中 load 端点并返回 true", async () => {
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

  it("createLocalModelLoadAction 应在 v1 不可用时回退到 v0 端点", async () => {
    const seenUrls: string[] = [];
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      if (url.endsWith("/api/v1/models/load")) {
        return new Response("{}", { status: 404 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const loaded = await createLocalModelLoadAction({
      baseUrl: "http://127.0.0.1:1234",
      model: "huihui-glm-4.7-flash-abliterated-mlx",
      timeoutMs: 1000,
    })();

    expect(loaded).toBe(true);
    expect(seenUrls).toEqual([
      "http://127.0.0.1:1234/api/v1/models/load",
      "http://127.0.0.1:1234/api/v0/model/load",
    ]);
  });

  it("达到第 2 次重试后不应继续 reload", async () => {
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

  it("reload helper 只对已知的 unloaded/crashed 信号返回 true", () => {
    expect(shouldRetryLocalModelLoad("Model unloaded")).toBe(true);
    expect(shouldRetryLocalModelLoad("The model has crashed without additional information.")).toBe(true);
    expect(shouldRetryLocalModelLoad("random validation error")).toBe(false);
  });
});

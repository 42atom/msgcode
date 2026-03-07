/**
 * msgcode: P5.7-R7A PinchTab runner 回归锁
 *
 * 目标：
 * - 验证 HTTP API 路径与方法
 * - 验证 snapshot/text/eval 等返回结构
 * - 验证远端错误分类
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  BROWSER_ERROR_CODES,
  BrowserCommandError,
  executeBrowserOperation,
} from "../src/runners/browser-pinchtab.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("P5.7-R7A: browser runner", () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.PINCHTAB_BASE_URL;
  const originalToken = process.env.PINCHTAB_TOKEN;

  beforeEach(() => {
    process.env.PINCHTAB_BASE_URL = "http://127.0.0.1:9988";
    process.env.PINCHTAB_TOKEN = "runner-test-token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.PINCHTAB_BASE_URL;
    } else {
      process.env.PINCHTAB_BASE_URL = originalBaseUrl;
    }
    if (originalToken === undefined) {
      delete process.env.PINCHTAB_TOKEN;
    } else {
      process.env.PINCHTAB_TOKEN = originalToken;
    }
  });

  it("profiles.list 应该请求 GET /profiles", async () => {
    const requests: Array<{ url: string; method: string; auth?: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        auth: init?.headers instanceof Headers
          ? init.headers.get("Authorization") ?? undefined
          : (init?.headers as Record<string, string> | undefined)?.Authorization,
      });
      if (url.endsWith("/health")) {
        return jsonResponse({ status: "ok", mode: "dashboard" });
      }
      return jsonResponse([{ id: "prof_1", name: "work" }]);
    }) as typeof globalThis.fetch;

    const result = await executeBrowserOperation({ operation: "profiles.list" });

    expect(result.operation).toBe("profiles.list");
    expect(result.data.profiles).toEqual([{ id: "prof_1", name: "work" }]);
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe("http://127.0.0.1:9988/health");
    expect(requests[1].url).toBe("http://127.0.0.1:9988/profiles");
    expect(requests[1].method).toBe("GET");
    expect(requests[1].auth).toBe("Bearer runner-test-token");
  });

  it("instances.launch 应该请求 POST /instances/launch 并透传 mode/profileId", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.endsWith("/health")) {
        return jsonResponse({ status: "ok", mode: "dashboard" });
      }
      return jsonResponse({
        id: "inst_1",
        profileId: "prof_1",
        profileName: "work",
        port: "9868",
        headless: true,
        status: "starting",
      });
    }) as typeof globalThis.fetch;

    const result = await executeBrowserOperation({
      operation: "instances.launch",
      profileId: "prof_1",
      mode: "headless",
    });

    expect(result.data.id).toBe("inst_1");
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe("http://127.0.0.1:9988/health");
    expect(requests[1].url).toBe("http://127.0.0.1:9988/instances/launch");
    expect(requests[1].method).toBe("POST");
    expect(JSON.parse(requests[1].body ?? "{}")).toEqual({
      profileId: "prof_1",
      mode: "headless",
    });
  });

  it("tabs.snapshot 应该请求 GET /tabs/{id}/snapshot 并返回文本", async () => {
    const requests: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response("# Example Domain", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }) as typeof globalThis.fetch;

    const result = await executeBrowserOperation({
      operation: "tabs.snapshot",
      tabId: "tab_123",
      interactive: true,
      compact: true,
    });

    expect(result.data.snapshot).toBe("# Example Domain");
    expect(requests[0]).toBe(
      "http://127.0.0.1:9988/tabs/tab_123/snapshot?filter=interactive&format=compact"
    );
  });

  it("tabs.eval 应该请求 POST /tabs/{id}/evaluate", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return jsonResponse({ result: "https://example.com/" });
    }) as typeof globalThis.fetch;

    const result = await executeBrowserOperation({
      operation: "tabs.eval",
      tabId: "tab_abc",
      expression: "location.href",
    });

    expect(result.data.result).toBe("https://example.com/");
    expect(requests[0].url).toBe("http://127.0.0.1:9988/tabs/tab_abc/evaluate");
    expect(requests[0].method).toBe("POST");
    expect(JSON.parse(requests[0].body ?? "{}")).toEqual({
      expression: "location.href",
    });
  });

  it("tab not found 应该归类为 BROWSER_TAB_NOT_FOUND", async () => {
    globalThis.fetch = (async () => {
      return jsonResponse(
        { code: "error", error: "tab tab_missing not found" },
        404
      );
    }) as typeof globalThis.fetch;

    await expect(
      executeBrowserOperation({
        operation: "tabs.text",
        tabId: "tab_missing",
      })
    ).rejects.toMatchObject<Partial<BrowserCommandError>>({
      code: BROWSER_ERROR_CODES.TAB_NOT_FOUND,
    });
  });

  it("fetch 异常应归类为 BROWSER_PINCHTAB_UNAVAILABLE", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:9988");
    }) as typeof globalThis.fetch;

    await expect(
      executeBrowserOperation({ operation: "health" })
    ).rejects.toMatchObject<Partial<BrowserCommandError>>({
      code: BROWSER_ERROR_CODES.PINCHTAB_UNAVAILABLE,
    });
  });

  it("AbortError 应归类为 BROWSER_TIMEOUT", async () => {
    globalThis.fetch = (async () => {
      const abortError = new Error("request aborted");
      abortError.name = "AbortError";
      throw abortError;
    }) as typeof globalThis.fetch;

    await expect(
      executeBrowserOperation({ operation: "tabs.text", tabId: "tab_slow", timeoutMs: 1234 })
    ).rejects.toMatchObject<Partial<BrowserCommandError>>({
      code: BROWSER_ERROR_CODES.TIMEOUT,
      message: "request timed out after 1234ms",
    });
  });

  it("management operation 在实例 URL 上应返回 BROWSER_ORCHESTRATOR_URL_REQUIRED", async () => {
    const requests: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return jsonResponse({ status: "ok", tabs: 1, cdp: "" });
    }) as typeof globalThis.fetch;

    await expect(
      executeBrowserOperation({ operation: "profiles.list" })
    ).rejects.toMatchObject<Partial<BrowserCommandError>>({
      code: BROWSER_ERROR_CODES.ORCHESTRATOR_URL_REQUIRED,
    });

    expect(requests).toEqual(["http://127.0.0.1:9988/health"]);
  });
});

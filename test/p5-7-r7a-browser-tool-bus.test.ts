/**
 * msgcode: P5.7-R7A browser tool bus 回归锁
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeTool } from "../src/tools/bus.js";

describe("P5.7-R7A: browser tool bus", () => {
  let workspacePath = "";
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    workspacePath = join(tmpdir(), `msgcode-browser-${randomUUID()}`);
    mkdirSync(join(workspacePath, ".msgcode"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["browser"],
        "tooling.require_confirm": [],
      }),
      "utf-8"
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (workspacePath && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("browser 工具应通过 operation=profiles.list 执行成功", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok", mode: "dashboard" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ id: "prof_1", name: "work" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await executeTool(
      "browser",
      { operation: "profiles.list" },
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(result.data?.operation).toBe("profiles.list");
    expect((result.data?.result as { profiles: Array<{ id: string }> }).profiles[0].id).toBe("prof_1");
  });

  it("browser 工具缺少 operation 时应返回 TOOL_BAD_ARGS", async () => {
    const result = await executeTool(
      "browser",
      {},
      {
        workspacePath,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_BAD_ARGS");
  });

  it("browser 远端 tab not found 应折叠为 TOOL_EXEC_FAILED 并保留 browser 错误码", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ code: "error", error: "tab tab_missing not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof globalThis.fetch;

    const result = await executeTool(
      "browser",
      { operation: "tabs.text", tabId: "tab_missing" },
      {
        workspacePath,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_EXEC_FAILED");
    expect(result.error?.message).toContain("BROWSER_TAB_NOT_FOUND");
  });

  it("browser timeout 应映射为 TOOL_TIMEOUT", async () => {
    globalThis.fetch = (async () => {
      const abortError = new Error("request aborted");
      abortError.name = "AbortError";
      throw abortError;
    }) as typeof globalThis.fetch;

    const result = await executeTool(
      "browser",
      { operation: "tabs.text", tabId: "tab_slow" },
      {
        workspacePath,
        source: "slash-command",
        requestId: randomUUID(),
        timeoutMs: 321,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_TIMEOUT");
    expect(result.error?.message).toContain("BROWSER_TIMEOUT");
  });

  it("baseUrl 误配为实例 URL 时，management operation 应返回明确错误", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/health");
      return new Response(JSON.stringify({ status: "ok", tabs: 1, cdp: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await executeTool(
      "browser",
      { operation: "profiles.list" },
      {
        workspacePath,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_EXEC_FAILED");
    expect(result.error?.message).toContain("BROWSER_ORCHESTRATOR_URL_REQUIRED");
  });
});

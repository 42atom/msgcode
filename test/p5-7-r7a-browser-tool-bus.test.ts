/**
 * msgcode: P5.7-R7A browser tool bus 回归锁
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { executeTool } from "../src/tools/bus.js";
import { __setBrowserPatchrightTestDeps } from "../src/runners/browser-patchright.js";

describe("P5.7-R7A: browser tool bus", () => {
  let workspacePath = "";
  let chromeProfilesRoot = "";
  const originalChromeProfilesRoot = process.env.MSGCODE_CHROME_PROFILES_ROOT;

  beforeEach(() => {
    workspacePath = join(tmpdir(), `msgcode-browser-${randomUUID()}`);
    chromeProfilesRoot = join(workspacePath, ".chrome-profiles");
    mkdirSync(join(workspacePath, ".msgcode"), { recursive: true });
    mkdirSync(chromeProfilesRoot, { recursive: true });
    writeFileSync(
      join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["browser"],
        "tooling.require_confirm": [],
      }),
      "utf-8"
    );
    process.env.MSGCODE_CHROME_PROFILES_ROOT = chromeProfilesRoot;
  });

  afterEach(() => {
    __setBrowserPatchrightTestDeps({
      fetchImpl: globalThis.fetch,
      spawnProcess: spawn,
    });
    if (originalChromeProfilesRoot === undefined) {
      delete process.env.MSGCODE_CHROME_PROFILES_ROOT;
    } else {
      process.env.MSGCODE_CHROME_PROFILES_ROOT = originalChromeProfilesRoot;
    }
    if (workspacePath && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("browser 工具应通过 operation=profiles.list 执行成功", async () => {
    mkdirSync(join(chromeProfilesRoot, "prof_1"), { recursive: true });

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

  it("browser per-operation 缺参应由 runner 返回真实 bad args", async () => {
    const result = await executeTool(
      "browser",
      { operation: "tabs.eval", tabId: "tab_1" },
      {
        workspacePath,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_EXEC_FAILED");
    expect(result.error?.message).toContain("BROWSER_BAD_ARGS");
    expect(result.error?.message).toContain("expression must be a non-empty string");
  });

  it("browser 远端 tab not found 应折叠为 TOOL_EXEC_FAILED 并保留 browser 错误码", async () => {
    __setBrowserPatchrightTestDeps({
      fetchImpl: (async () => {
      return new Response(
        JSON.stringify({ code: "error", error: "tab tab_missing not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
      }) as typeof globalThis.fetch,
    });

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
    __setBrowserPatchrightTestDeps({
      fetchImpl: (async () => {
        const abortError = new Error("request aborted");
        abortError.name = "AbortError";
        throw abortError;
      }) as typeof globalThis.fetch,
      spawnProcess: (() => ({
        pid: 4321,
        unref() {},
      })) as typeof spawn,
    });

    const result = await executeTool(
      "browser",
      { operation: "instances.launch", mode: "headless", rootName: "timeout-root" },
      {
        workspacePath,
        source: "slash-command",
        requestId: randomUUID(),
        timeoutMs: 20,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_TIMEOUT");
    expect(result.error?.message).toBe("TOOL_TIMEOUT");
  });

  it("tabs.text 应把正文落盘为 browser artifact，并在 preview 里暴露 textPath", async () => {
    const stateDir = join(chromeProfilesRoot, ".browser");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "work-default-9222.json"),
      JSON.stringify({
        id: "chrome:work-default:9222",
        rootName: "work-default",
        chromeRoot: join(chromeProfilesRoot, "work-default"),
        port: "9222",
        headless: false,
        status: "running",
        mode: "headed",
      }),
      "utf-8"
    );

    const pageText = "第一段正文。\n\n第二段正文，应该被完整落盘。";
    const fakePage = {
      title: async () => "Example Article",
      url: () => "https://example.com/article",
      locator: () => ({
        innerText: async () => pageText,
      }),
      context: () => ({
        newCDPSession: async () => ({
          send: async () => ({ targetInfo: { targetId: "tab_live_text" } }),
          detach: async () => undefined,
        }),
      }),
    };

    __setBrowserPatchrightTestDeps({
      fetchImpl: (async () => new Response(
        JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/mock" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )) as typeof globalThis.fetch,
      resolvePatchright: () => ({
        connectOverCDP: async () => ({
          contexts: () => [{
            pages: () => [fakePage],
            newPage: async () => fakePage,
          }],
          close: async () => undefined,
        }),
      }),
    });

    const result = await executeTool(
      "browser",
      { operation: "tabs.text", tabId: "tab_live_text" },
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect((result.data as { textPath?: string }).textPath).toBeDefined();
    expect(result.previewText).toContain("[textPath]");
    expect(result.previewText).toContain("[textPreview]");
    expect(result.previewText).toContain("第一段正文");
    expect(result.artifacts?.[0]?.path).toBe((result.data as { textPath?: string }).textPath);
    expect(readFileSync((result.data as { textPath: string }).textPath, "utf-8")).toBe(pageText);
    expect(((result.data as { result: Record<string, unknown> }).result).text).toBeUndefined();
  });

  it("profiles.list 不应依赖旧 orchestrator/baseUrl，也不应发起网络请求", async () => {
    mkdirSync(join(chromeProfilesRoot, "work"), { recursive: true });
    let called = false;
    __setBrowserPatchrightTestDeps({
      fetchImpl: (async () => {
        called = true;
        throw new Error("unexpected network request");
      }) as typeof globalThis.fetch,
    });

    const result = await executeTool(
      "browser",
      { operation: "profiles.list" },
      {
        workspacePath,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(called).toBe(false);
    expect((result.data?.result as { profiles: Array<{ id: string }> }).profiles[0].id).toBe("work");
  });
});

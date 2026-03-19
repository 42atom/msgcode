/**
 * msgcode: P5.7-R7A Patchright runner 回归锁
 *
 * 目标：
 * - 验证 Chrome-as-State 启动链
 * - 验证 tabs.open 自动拉起实例
 * - 验证 snapshot 输出无状态 ref
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __setBrowserPatchrightTestDeps,
  BROWSER_ERROR_CODES,
  BrowserCommandError,
  executeBrowserOperation,
} from "../src/runners/browser-patchright.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createPageStub(options: {
  targetId: string;
  title?: string;
  url?: string;
  ariaSnapshot?: string;
  refs?: Array<Record<string, unknown>>;
}) {
  let currentUrl = options.url ?? "about:blank";

  const context = {
    async newCDPSession() {
      return {
        async send() {
          return { targetInfo: { targetId: options.targetId } };
        },
        async detach() {
          return undefined;
        },
      };
    },
  };

  return {
    async goto(url: string) {
      currentUrl = url;
    },
    async title() {
      return options.title ?? "Example Domain";
    },
    url() {
      return currentUrl;
    },
    context() {
      return context;
    },
    locator() {
      return {
        async ariaSnapshot() {
          return options.ariaSnapshot ?? "document";
        },
        async innerText() {
          return "Example body text";
        },
      };
    },
    async evaluate() {
      return options.refs ?? [];
    },
    keyboard: {
      async press() {
        return undefined;
      },
    },
  };
}

describe("P5.7-R7A: browser runner", () => {
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  let tempWorkspaceRoot = "";

  beforeEach(async () => {
    tempWorkspaceRoot = await mkdtemp(join(tmpdir(), "msgcode-browser-runner-"));
    process.env.WORKSPACE_ROOT = tempWorkspaceRoot;
  });

  afterEach(async () => {
    __setBrowserPatchrightTestDeps({
      fetchImpl: fetch,
      resolvePatchright: () => {
        throw new Error("patchright dependency is not installed");
      },
    });

    if (originalWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    }

    if (tempWorkspaceRoot) {
      await rm(tempWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("instances.launch 应拉起共享工作 Chrome 并返回 chrome:<rootName>:<port>", async () => {
    let fetchCalls = 0;
    const spawns: Array<{ command: string; args: string[] }> = [];

    __setBrowserPatchrightTestDeps({
      fetchImpl: (async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          throw new Error("connect ECONNREFUSED");
        }
        return jsonResponse({ webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/test" });
      }) as typeof fetch,
      spawnProcess: ((command, args) => {
        spawns.push({ command, args });
        return {
          pid: 4321,
          unref() {
            return undefined;
          },
        } as any;
      }) as any,
    });

    const result = await executeBrowserOperation({
      operation: "instances.launch",
      rootName: "work-default",
      port: 9333,
      mode: "headless",
    });

    expect(result.data.id).toBe("chrome:work-default:9333");
    expect(result.data.rootName).toBe("work-default");
    expect(result.data.port).toBe("9333");
    expect(result.data.headless).toBe(true);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].args).toContain("--remote-debugging-port=9333");
    expect(spawns[0].args).toContain(`--user-data-dir=${join(tempWorkspaceRoot, ".msgcode", "chrome-profiles", "work-default")}`);
  });

  it("tabs.open 缺少 instanceId 时应自动 launch 默认实例后继续打开", async () => {
    let fetchCalls = 0;
    const page = createPageStub({
      targetId: "target_auto_1",
      title: "GitHub",
      url: "https://github.com/",
    });

    __setBrowserPatchrightTestDeps({
      fetchImpl: (async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          throw new Error("connect ECONNREFUSED");
        }
        return jsonResponse({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test" });
      }) as typeof fetch,
      spawnProcess: ((command, args) => {
        return {
          pid: 1234,
          unref() {
            return undefined;
          },
        } as any;
      }) as any,
      resolvePatchright: () => ({
        async connectOverCDP() {
          return {
            contexts() {
              return [{
                pages() {
                  return [];
                },
                async newPage() {
                  return page;
                },
              }];
            },
            async close() {
              return undefined;
            },
          };
        },
      }),
    });

    const result = await executeBrowserOperation({
      operation: "tabs.open",
      url: "https://github.com/",
      mode: "headless",
    });

    expect(result.data.instanceId).toBe("chrome:work-default:9222");
    expect(result.data.autoLaunched).toBe(true);
    expect(result.data.tabId).toBe("target_auto_1");
    expect(result.data.title).toBe("GitHub");
  });

  it("tabs.snapshot 应返回 ariaSnapshot 与无状态 ref", async () => {
    const page = createPageStub({
      targetId: "target_snapshot_1",
      ariaSnapshot: "document\n  button \"Submit\"",
      refs: [
        {
          role: "button",
          name: "Submit",
          index: 0,
          ref: "{\"role\":\"button\",\"name\":\"Submit\",\"index\":0}",
          tag: "button",
          text: "Submit",
        },
      ],
    });

    let fetchCalls = 0;
    __setBrowserPatchrightTestDeps({
      fetchImpl: (async () => {
        fetchCalls += 1;
        return jsonResponse({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test" });
      }) as typeof fetch,
      spawnProcess: ((command, args) => {
        return {
          pid: 5678,
          unref() {
            return undefined;
          },
        } as any;
      }) as any,
      resolvePatchright: () => ({
        async connectOverCDP() {
          return {
            contexts() {
              return [{
                pages() {
                  return [page];
                },
                async newPage() {
                  return page;
                },
              }];
            },
            async close() {
              return undefined;
            },
          };
        },
      }),
    });

    await executeBrowserOperation({
      operation: "instances.launch",
      rootName: "work-default",
      mode: "headless",
    });

    const result = await executeBrowserOperation({
      operation: "tabs.snapshot",
      tabId: "target_snapshot_1",
      interactive: true,
      compact: false,
    });

    expect(result.data.tabId).toBe("target_snapshot_1");
    expect(String(result.data.snapshot)).toContain("button \"Submit\"");
    expect(String(result.data.snapshot)).toContain("{\"role\":\"button\",\"name\":\"Submit\",\"index\":0}");
    expect(Array.isArray(result.data.refs)).toBe(true);
  });

  it("tabs.text 应跳过不可达的实例状态（例如旧端口 9223），继续扫描并命中可用实例", async () => {
    const stateDir = join(tempWorkspaceRoot, ".msgcode", "chrome-profiles", ".browser");
    await mkdir(stateDir, { recursive: true });
    const now = Date.now();

    // Deliberately make the stale one "more recent" so it is tried first.
    await writeFile(join(stateDir, "gmail-test-9223.json"), JSON.stringify({
      id: "chrome:gmail-test:9223",
      rootName: "gmail-test",
      chromeRoot: "/tmp/fake-gmail",
      port: "9223",
      headless: true,
      status: "running",
      mode: "headless",
      startTime: new Date(now - 2_000).toISOString(),
      lastUsedAt: new Date(now).toISOString(),
    }), "utf-8");
    await writeFile(join(stateDir, "work-default-9222.json"), JSON.stringify({
      id: "chrome:work-default:9222",
      rootName: "work-default",
      chromeRoot: "/tmp/fake-work",
      port: "9222",
      headless: true,
      status: "running",
      mode: "headless",
      startTime: new Date(now - 3_000).toISOString(),
      lastUsedAt: new Date(now - 1_000).toISOString(),
    }), "utf-8");

    const page = createPageStub({
      targetId: "target_text_1",
      title: "Example Domain",
      url: "https://example.com/",
    });

    const connectUrls: string[] = [];
    __setBrowserPatchrightTestDeps({
      fetchImpl: (async (url: string) => {
        const raw = String(url);
        if (raw.includes(":9223/")) {
          throw new Error("connect ECONNREFUSED");
        }
        return jsonResponse({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test" });
      }) as any,
      resolvePatchright: () => ({
        async connectOverCDP(url: string) {
          connectUrls.push(url);
          if (String(url).includes(":9223")) {
            throw new Error("should not connect to 9223");
          }
          return {
            contexts() {
              return [{
                pages() {
                  return [page];
                },
                async newPage() {
                  return page;
                },
              }];
            },
            async close() {
              return undefined;
            },
          };
        },
      }),
    });

    const result = await executeBrowserOperation({
      operation: "tabs.text",
      tabId: "target_text_1",
      timeoutMs: 500,
    });

    expect(result.data.title).toBe("Example Domain");
    expect(String(result.data.text)).toContain("Example body text");
    expect(connectUrls.some((item) => item.includes(":9222"))).toBe(true);
    expect(connectUrls.some((item) => item.includes(":9223"))).toBe(false);
  });

  it("无效 instanceId 应返回 BROWSER_BAD_ARGS", async () => {
    await expect(
      executeBrowserOperation({
        operation: "instances.stop",
        instanceId: "bad-instance-id",
      })
    ).rejects.toMatchObject<Partial<BrowserCommandError>>({
      code: BROWSER_ERROR_CODES.BAD_ARGS,
    });
  });
});

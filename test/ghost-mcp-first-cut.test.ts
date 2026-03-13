import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { executeTool } from "../src/tools/bus.js";
import {
  __clearGhostProbeCache,
  __resetGhostMcpTestDeps,
  __setGhostMcpTestDeps,
} from "../src/runners/ghost-mcp-client.js";
import { GHOST_TOOL_NAMES } from "../src/runners/ghost-mcp-contract.js";

class MockGhostProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  #buffer = "";

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer | string) => {
      this.#buffer += chunk.toString();
      while (true) {
        const newlineIndex = this.#buffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = this.#buffer.slice(0, newlineIndex).trim();
        this.#buffer = this.#buffer.slice(newlineIndex + 1);
        if (!line) continue;
        const message = JSON.parse(line) as Record<string, unknown>;
        this.#handleMessage(message);
      }
    });
  }

  kill(): boolean {
    if (this.killed) return true;
    this.killed = true;
    queueMicrotask(() => this.emit("close", 0));
    return true;
  }

  #handleMessage(message: Record<string, unknown>): void {
    if (message.method === "initialize") {
      this.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "ghost", version: "Ghost OS v2.0.0" },
        },
      })}\n`);
      return;
    }

    if (message.method === "tools/list") {
      this.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "ghost_context",
              description: "context",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      })}\n`);
      return;
    }

    if (message.method === "tools/call") {
      this.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                app: "Chrome",
                windowTitle: "Inbox",
              }),
            },
          ],
          isError: false,
        },
      })}\n`);
    }
  }
}

function mockHealthyGhost(): void {
  __setGhostMcpTestDeps({
    fileExists: (path) => path === "/opt/homebrew/bin/ghost",
    execFileText: async (_file, args) => {
      if (args[0] === "version") {
        return { stdout: "Ghost OS v2.0.0", stderr: "" };
      }
      if (args[0] === "status") {
        return {
          stdout: "Ghost OS v2.0.0\n\nAccessibility: granted\nScreen Recording: granted\n\nStatus: Ready",
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    },
    spawnProcess: () => new MockGhostProcess() as any,
  });
}

describe("ghost-os 第一刀：ghost mcp 挂载", () => {
  let tempWorkspace: string;

  beforeEach(() => {
    tempWorkspace = join(tmpdir(), `msgcode-ghost-${randomUUID()}`);
    mkdirSync(join(tempWorkspace, ".msgcode"), { recursive: true });
    __resetGhostMcpTestDeps();
    __clearGhostProbeCache();
  });

  afterEach(() => {
    __resetGhostMcpTestDeps();
    __clearGhostProbeCache();
    if (existsSync(tempWorkspace)) {
      rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });

  test("默认 tooling.allow 应包含 ghost 原生工具", async () => {
    const { DEFAULT_WORKSPACE_CONFIG } = await import("../src/config/workspace.js");

    expect(DEFAULT_WORKSPACE_CONFIG["tooling.allow"]).toContain("ghost_context");
    expect(DEFAULT_WORKSPACE_CONFIG["tooling.allow"]).toContain("ghost_click");
    expect(DEFAULT_WORKSPACE_CONFIG["tooling.allow"]).toContain("ghost_run");
    expect(DEFAULT_WORKSPACE_CONFIG["tooling.allow"]).not.toContain("desktop");
  });

  test("ghost 工具说明书应从 ghost mcp tools/list 动态派生", async () => {
    mockHealthyGhost();
    const { TOOL_MANIFESTS, getRegisteredToolManifests } = await import("../src/tools/manifest.js");

    expect(TOOL_MANIFESTS.ghost_context).toBeUndefined();

    const manifests = await getRegisteredToolManifests(tempWorkspace);
    expect(manifests.ghost_context).toBeDefined();
    expect(manifests.ghost_context?.description).toBe("context");
    expect(Object.keys(manifests)).toEqual(expect.arrayContaining(["ghost_context"]));
    expect(Object.keys(manifests)).not.toEqual(expect.arrayContaining([...GHOST_TOOL_NAMES]));
  });

  test("workspace allow 包含 ghost_context 时，getToolsForLlm 应暴露它", async () => {
    mockHealthyGhost();
    writeFileSync(
      join(tempWorkspace, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.allow": ["ghost_context", "bash"],
      }),
    );

    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");
    const tools = await toolLoopModule.getToolsForLlm(tempWorkspace);

    expect(tools).toContain("ghost_context");
    expect(tools).toContain("bash");
  });

  test("ghost 缺失时应 fail-closed 返回安装指引", async () => {
    writeFileSync(
      join(tempWorkspace, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["ghost_context"],
      }),
    );

    __setGhostMcpTestDeps({
      fileExists: () => false,
      execFileText: async (file) => {
        if (file === "which") {
          return { stdout: "", stderr: "" };
        }
        throw new Error("not found");
      },
    });

    const result = await executeTool(
      "ghost_context",
      { app: "Chrome" },
      {
        workspacePath: tempWorkspace,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_EXEC_FAILED");
    expect(result.error?.message).toContain("ghost binary not found");
    expect(result.error?.message).toContain("brew install ghostwright/ghost-os/ghost-os");
  });

  test("ghost_context 应通过 ghost mcp 返回真实结构化结果", async () => {
    writeFileSync(
      join(tempWorkspace, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["ghost_context"],
      }),
    );

    mockHealthyGhost();

    const result = await executeTool(
      "ghost_context",
      { app: "Chrome" },
      {
        workspacePath: tempWorkspace,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(result.data?.binaryPath).toBe("/opt/homebrew/bin/ghost");
    expect(result.data?.structuredContent).toMatchObject({
      success: true,
      app: "Chrome",
      windowTitle: "Inbox",
    });
    expect(result.previewText).toContain("Status: Ready");
    expect(result.previewText).toContain("[ghost_context]");
  });

  test("ghost status not ready 且命中权限缺失时，应 best-effort 打开系统设置并返回原始事实", async () => {
    writeFileSync(
      join(tempWorkspace, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["ghost_context"],
      }),
    );

    const calls: Array<{ file: string; args: string[] }> = [];
    __setGhostMcpTestDeps({
      fileExists: (path) => path === "/opt/homebrew/bin/ghost",
      execFileText: async (file, args) => {
        calls.push({ file, args });
        if (file === "/opt/homebrew/bin/ghost" && args[0] === "version") {
          return { stdout: "Ghost OS v2.0.0", stderr: "" };
        }
        if (file === "/opt/homebrew/bin/ghost" && args[0] === "status") {
          return {
            stdout: "Ghost OS v2.0.0\n\nAccessibility: NOT GRANTED\nScreen Recording: not granted\n\nStatus: needs setup",
            stderr: "",
          };
        }
        if (file === "/opt/homebrew/bin/ghost" && args[0] === "doctor") {
          return {
            stdout: "Accessibility Permission\n  [FAIL] Not granted\n\nScreen Recording Permission\n  [FAIL] Not granted",
            stderr: "",
          };
        }
        if (file === "open") {
          return { stdout: "", stderr: "" };
        }
        throw new Error(`unexpected exec: ${file} ${args.join(" ")}`);
      },
      spawnProcess: () => new MockGhostProcess() as any,
    });

    const result = await executeTool(
      "ghost_context",
      { app: "Safari" },
      {
        workspacePath: tempWorkspace,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_EXEC_FAILED");
    expect(result.error?.message).toContain("ghost status not ready");
    expect(result.error?.message).toContain("[host]");
    expect(result.error?.message).toContain("[tcc]");

    if (process.platform === "darwin") {
      expect(calls.some((c) => c.file === "open")).toBe(true);
    }
  });
});

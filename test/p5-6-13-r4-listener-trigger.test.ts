import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

function runIsolatedListenerCase(mode: "search" | "fail-open"): {
  vectorAvailable?: boolean;
  requestBody?: Record<string, unknown>;
  sent?: Array<{ chat_guid: string; text: string }>;
  debugLogs?: Array<[string, Record<string, unknown>]>;
  warnLogs?: Array<[string, Record<string, unknown>]>;
} {
  const repoRoot = process.cwd();
  const nodeBinary = process.env.NODE_BINARY || "node";
  const marker = "__MSGCODE_RESULT__";
  const script = `
    import fs from "node:fs";
    import os from "node:os";
    import path from "node:path";
    import crypto from "node:crypto";

    const mode = ${JSON.stringify(mode)};
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-r4-listener-child-"));
    const homeDir = path.join(tmpRoot, "home");
    const workspaceRoot = path.join(tmpRoot, "workspaces");
    const routesPath = path.join(tmpRoot, "routes.json");
    const statePath = path.join(tmpRoot, "state.json");
    const workspacePath = path.join(workspaceRoot, "default");

    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(workspacePath, { recursive: true });

    process.env.HOME = homeDir;
    process.env.ROUTES_FILE_PATH = routesPath;
    process.env.STATE_FILE_PATH = statePath;
    process.env.WORKSPACE_ROOT = workspaceRoot;
    process.env.MSGCODE_DEFAULT_WORKSPACE_DIR = "default";
    process.env.AGENT_BACKEND = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-test";
    process.env.MEMORY_DEBUG = "1";
    process.env.NODE_ENV = "test";

    const { saveWorkspaceConfig } = await import(${JSON.stringify(path.join(repoRoot, "src/config/workspace.ts"))});
    await saveWorkspaceConfig(workspacePath, {
      "tooling.mode": "explicit",
      "memory.inject.enabled": true,
      "memory.inject.topK": 3,
      "memory.inject.maxChars": 500,
    });

    const { config } = await import(${JSON.stringify(path.join(repoRoot, "src/config.ts"))});
    config.ownerOnlyInGroup = false;
    config.ownerIdentifiers = [];
    if (!config.whitelist.emails.includes("tester@example.com")) {
      config.whitelist.emails.push("tester@example.com");
    }

    let vectorAvailable = false;
    if (mode === "search") {
      const { createMemoryStore } = await import(${JSON.stringify(path.join(repoRoot, "src/memory/store.ts"))});
      const store = createMemoryStore();
      vectorAvailable = store.isVectorAvailable();
      const docId = store.upsertDocument({
        workspaceId: "default",
        path: "notes/alpha.md",
        mtimeMs: Date.now(),
        sha256: crypto.createHash("sha256").update("继续推进").digest("hex"),
        createdAtMs: Date.now(),
      });
      store.addChunk(
        {
          chunkId: "chunk-r4-1",
          heading: "记忆",
          startLine: 12,
          endLine: 14,
          textLength: 12,
          textDigest: crypto.createHash("sha256").update("继续推进这轮任务").digest("hex"),
          createdAtMs: Date.now(),
        },
        docId,
        "继续 推进 这轮 任务 的 关键记忆"
      );
      store.close();
    } else {
      const brokenPath = path.join(homeDir, ".config", "msgcode", "memory", "index.sqlite");
      fs.mkdirSync(brokenPath, { recursive: true });
    }

    const { logger } = await import(${JSON.stringify(path.join(repoRoot, "src/logger/index.ts"))});
    const debugLogs = [];
    const warnLogs = [];
    const originalDebug = logger.debug.bind(logger);
    const originalWarn = logger.warn.bind(logger);
    logger.debug = (message, meta) => { debugLogs.push([message, meta]); };
    logger.warn = (message, meta) => { warnLogs.push([message, meta]); };

    let requestBody = {};
    globalThis.fetch = async (_input, init) => {
      requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: mode === "search" ? "处理完成" : "原样继续" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    class FakeSendClient {
      sent = [];
      async send(params) {
        this.sent.push({ chat_guid: params.chat_guid, text: params.text || "" });
        return { ok: true };
      }
    }

    const sendClient = new FakeSendClient();
    try {
      const { handleMessage } = await import(${JSON.stringify(path.join(repoRoot, "src/listener.ts"))});
      await handleMessage(
        {
          id: mode === "search" ? "msg-r4-search" : "msg-r4-fail-open",
          chatId: mode === "search" ? "chat-r4-search" : "chat-r4-fail-open",
          text: mode === "search" ? "继续" : "请继续原样处理",
          isFromMe: false,
          sender: "tester@example.com",
          handle: "tester@example.com",
        },
        { sendClient }
      );
      console.log(${JSON.stringify(marker)} + JSON.stringify({
        vectorAvailable,
        requestBody,
        sent: sendClient.sent,
        debugLogs,
        warnLogs,
      }));
    } finally {
      logger.debug = originalDebug;
      logger.warn = originalWarn;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  `;

  const result = spawnSync(nodeBinary, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "isolated listener case failed").trim());
  }

  const line = result.stdout
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith(marker));

  if (!line) {
    throw new Error(`listener case did not emit result marker: ${result.stdout}`);
  }

  return JSON.parse(line.slice(marker.length));
}

describe("P5.6.13-R4: listener 记忆检索触发收口", () => {
  it("enabled=true 时即使没有关键词，也应直接检索并把 memoryMode/vectorAvailable 打进 debug", () => {
    const result = runIsolatedListenerCase("search");
    const messages = Array.isArray(result.requestBody?.messages)
      ? (result.requestBody?.messages as Array<{ role?: string; content?: string }>)
      : [];
    const userMessage = messages.findLast((message) => message.role === "user");

    expect(userMessage?.content).toContain("相关记忆：");
    expect(userMessage?.content).toContain("[记忆] notes/alpha.md:12-14");
    expect(userMessage?.content).toContain("用户问题：\n继续");
    expect(result.sent?.[0]?.text).toBe("处理完成");

    const debugEntry = result.debugLogs?.find(([message]) => message === "记忆注入结果");
    expect(debugEntry).toBeDefined();
    expect(debugEntry?.[1]).toMatchObject({
      module: "listener",
      memoryMode: result.vectorAvailable ? "hybrid" : "fts-only",
      vectorAvailable: result.vectorAvailable,
      memoryHitCount: 1,
      memoryInjected: true,
    });
  });

  it("搜索失败时应 fail-open，保留原始内容并继续主流程", () => {
    const result = runIsolatedListenerCase("fail-open");
    const messages = Array.isArray(result.requestBody?.messages)
      ? (result.requestBody?.messages as Array<{ role?: string; content?: string }>)
      : [];
    const userMessage = messages.findLast((message) => message.role === "user");

    expect(userMessage?.content).toContain("请继续原样处理");
    expect(userMessage?.content).not.toContain("相关记忆：");
    expect(result.sent?.[0]?.text).toBe("原样继续");

    const warnEntry = result.warnLogs?.find(([message]) => message === "记忆注入失败");
    expect(warnEntry).toBeDefined();
    const warnError = String(warnEntry?.[1]?.error || "");
    expect(warnError.length).toBeGreaterThan(0);
    expect(
      warnError.includes("unable to open database file") ||
      warnError.includes("index.sqlite"),
    ).toBe(true);
  });
});

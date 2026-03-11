import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeActiveRoute(routePath: string, chatGuid: string, workspacePath: string): void {
  fs.mkdirSync(path.dirname(routePath), { recursive: true });
  fs.writeFileSync(
    routePath,
    JSON.stringify(
      {
        version: 1,
        routes: {
          [chatGuid]: {
            chatGuid,
            workspacePath,
            botType: "default",
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      null,
      2
    ),
    "utf-8"
  );
}

describe("P5.6.2-R1: ToolLoop 主链防回流锁", () => {
  let tmpDir = "";
  let originalEnv: Record<string, string | undefined> = {};
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-r1-regression-");

    originalEnv = {
      AGENT_BACKEND: process.env.AGENT_BACKEND,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      OPENAI_MODEL: process.env.OPENAI_MODEL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      AGENT_CONTEXT_WINDOW_TOKENS: process.env.AGENT_CONTEXT_WINDOW_TOKENS,
      AGENT_RESERVED_OUTPUT_TOKENS: process.env.AGENT_RESERVED_OUTPUT_TOKENS,
      AGENT_CHARS_PER_TOKEN: process.env.AGENT_CHARS_PER_TOKEN,
      MSGCODE_RUNS_FILE_PATH: process.env.MSGCODE_RUNS_FILE_PATH,
      MSGCODE_RUN_EVENTS_FILE_PATH: process.env.MSGCODE_RUN_EVENTS_FILE_PATH,
      ROUTES_FILE_PATH: process.env.ROUTES_FILE_PATH,
      JOBS_FILE_PATH: process.env.JOBS_FILE_PATH,
      RUNS_FILE_PATH: process.env.RUNS_FILE_PATH,
    };

    process.env.AGENT_BACKEND = "openai";
    process.env.OPENAI_BASE_URL = "http://unit-test.local";
    process.env.OPENAI_MODEL = "unit-test-model";
    process.env.OPENAI_API_KEY = "unit-test-key";
    process.env.AGENT_CONTEXT_WINDOW_TOKENS = "4096";
    process.env.AGENT_RESERVED_OUTPUT_TOKENS = "1024";
    process.env.AGENT_CHARS_PER_TOKEN = "2";
    process.env.MSGCODE_RUNS_FILE_PATH = path.join(tmpDir, "run-core", "runs.jsonl");
    process.env.MSGCODE_RUN_EVENTS_FILE_PATH = path.join(tmpDir, "run-core", "run-events.jsonl");
    process.env.ROUTES_FILE_PATH = path.join(tmpDir, "routes.json");
    process.env.JOBS_FILE_PATH = path.join(tmpDir, "cron", "jobs.json");
    process.env.RUNS_FILE_PATH = path.join(tmpDir, "cron", "runs.jsonl");

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    const { resetRunStoreForTest } = await import("../src/runtime/run-store.js");
    const { resetRunEventStoreForTest } = await import("../src/runtime/run-events.js");
    const { close } = await import("../src/runtime/thread-store.js");

    clearRuntimeCapabilityCache();
    resetRunStoreForTest();
    resetRunEventStoreForTest();
    close();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    const { clearRuntimeCapabilityCache } = await import("../src/capabilities.js");
    const { resetRunStoreForTest } = await import("../src/runtime/run-store.js");
    const { resetRunEventStoreForTest } = await import("../src/runtime/run-events.js");
    const { close } = await import("../src/runtime/thread-store.js");

    clearRuntimeCapabilityCache();
    resetRunStoreForTest();
    resetRunEventStoreForTest();
    close();

    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("RuntimeRouterHandler 非 slash 聊天应走 agent 主链、写回窗口，并产出 toolCallCount 日志", async () => {
    const workspacePath = path.join(tmpDir, "workspace-main");
    fs.mkdirSync(workspacePath, { recursive: true });

    const logEntries: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const { logger } = await import("../src/logger/index.js");
    const originalInfo = logger.info.bind(logger);
    logger.info = ((message: string, meta?: Record<string, unknown>) => {
      logEntries.push({ message, meta });
    }) as typeof logger.info;

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "处理完成" },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );

    try {
      const { RuntimeRouterHandler } = await import("../src/handlers.js");
      const { loadWindow } = await import("../src/session-window.js");

      const handler = new RuntimeRouterHandler();
      const result = await handler.handle("请给出结论", {
        botType: "default",
        chatId: "chat-r1-main",
        groupName: "test-group",
        projectDir: workspacePath,
        originalMessage: {
          id: "msg-r1-main",
          chatId: "chat-r1-main",
          text: "请给出结论",
          isFromMe: false,
          sender: "ou_test_user",
          senderName: "老哥",
          handle: "ou_test_user",
          isGroup: true,
          messageType: "text",
        },
      });

      expect(result.success).toBe(true);
      expect(result.response).toBe("处理完成");

      const windowMessages = await loadWindow(workspacePath, "chat-r1-main");
      expect(windowMessages).toHaveLength(2);
      expect(windowMessages[0]).toMatchObject({
        role: "user",
        content: "请给出结论",
        messageId: "msg-r1-main",
        senderId: "ou_test_user",
        senderName: "老哥",
        messageType: "text",
        isGroup: true,
      });
      expect(windowMessages[1]).toMatchObject({
        role: "assistant",
        content: "处理完成",
      });

      const completionLog = logEntries.find((entry) => entry.message === "agent request completed");
      expect(completionLog).toBeDefined();
      expect(completionLog?.meta?.runtimeKind).toBe("agent");
      expect(completionLog?.meta?.agentProvider).toBe("openai");
      expect(completionLog?.meta?.toolCallCount).toBe(0);
    } finally {
      logger.info = originalInfo;
    }
  });
});

describe("P5.6.2-R3: /reload SOUL 可观测防回流锁", () => {
  it("handleReloadCommand 应输出 SOUL source/path 与 SOUL Entries", async () => {
    const tmpDir = createTempDir("msgcode-r1-reload-");
    const previousRoutesPath = process.env.ROUTES_FILE_PATH;
    const previousJobsPath = process.env.JOBS_FILE_PATH;
    const previousRunsPath = process.env.RUNS_FILE_PATH;
    try {
      const workspacePath = path.join(tmpDir, "workspace");
      const routesPath = path.join(tmpDir, "routes.json");

      process.env.ROUTES_FILE_PATH = routesPath;
      process.env.JOBS_FILE_PATH = path.join(tmpDir, "cron", "jobs.json");
      process.env.RUNS_FILE_PATH = path.join(tmpDir, "cron", "runs.jsonl");

      fs.mkdirSync(path.join(workspacePath, ".msgcode", "schedules"), { recursive: true });
      fs.writeFileSync(
        path.join(workspacePath, ".msgcode", "SOUL.md"),
        "# Workspace SOUL\n\nreload test",
        "utf-8"
      );
      writeActiveRoute(routesPath, "chat-r1-reload", workspacePath);

      const { handleReloadCommand } = await import("../src/routes/cmd-schedule.ts");
      const result = await handleReloadCommand({
        chatId: "chat-r1-reload",
        args: [],
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("SOUL: source=workspace");
      expect(result.message).toContain(`path=${path.join(workspacePath, ".msgcode", "SOUL.md")}`);
      expect(result.message).toContain("SOUL Entries:");
    } finally {
      if (previousRoutesPath === undefined) {
        delete process.env.ROUTES_FILE_PATH;
      } else {
        process.env.ROUTES_FILE_PATH = previousRoutesPath;
      }
      if (previousJobsPath === undefined) {
        delete process.env.JOBS_FILE_PATH;
      } else {
        process.env.JOBS_FILE_PATH = previousJobsPath;
      }
      if (previousRunsPath === undefined) {
        delete process.env.RUNS_FILE_PATH;
      } else {
        process.env.RUNS_FILE_PATH = previousRunsPath;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("P5.6.2-R4: SOUL 过滤防回流锁（renderSoulContent 检测）", () => {
  it("src/ 目录下不得存在 renderSoulContent 函数（字符串当布尔用风险）", () => {
    const srcDir = path.join(process.cwd(), "src");

    const grepRecursive = (dir: string, pattern: RegExp): string[] => {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...grepRecursive(fullPath, pattern));
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (pattern.test(content)) {
            results.push(fullPath);
          }
        }
      }
      return results;
    };

    const matches = grepRecursive(srcDir, /function\s+renderSoulContent|export\s+function\s+renderSoulContent/);
    expect(matches).toHaveLength(0);
  });

  it("src/soul/ 目录不得存在（防止将来引入 soul 加载器）", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/soul"))).toBe(false);
  });

  it("src/skills/pi-assembler.ts 文件不得存在", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/skills/pi-assembler.ts"))).toBe(false);
  });

  it("src/providers/tool-loop.ts 文件不得存在", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/providers/tool-loop.ts"))).toBe(false);
  });
});

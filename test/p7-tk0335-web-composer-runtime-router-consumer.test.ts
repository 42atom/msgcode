import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("tk0335: web composer runtime-router consumer", () => {
  let tmpDir = "";
  let workspacePath = "";
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = createTempDir("msgcode-web-consumer-");
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });

    originalFetch = globalThis.fetch;
    originalEnv = {
      AGENT_BACKEND: process.env.AGENT_BACKEND,
      OPENAI_MODEL: process.env.OPENAI_MODEL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
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
    process.env.OPENAI_MODEL = "unit-test-model";
    process.env.OPENAI_API_KEY = "unit-test-key";
    process.env.OPENAI_BASE_URL = "http://unit-test.local";
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

    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("应消费一条 web inbox 请求，复用 handler，并推进到 triaged", async () => {
    const { createInboxRequest, listInboxRequests } = await import("../src/runtime/inbox-store.js");
    const { consumeWebInboxRequest } = await import("../src/cli/inbox.js");
    const { loadWindow } = await import("../src/session-window.js");
    const { getHelpDocsData } = await import("../src/cli/help.js");

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "今晚 18:30 还要接娃。" },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );

    const created = await createInboxRequest(workspacePath, {
      id: "web-msg-1",
      transport: "web",
      chatId: "web:family",
      text: "今晚还有什么安排？",
      isFromMe: false,
      date: Date.now(),
      sender: "sam",
      senderName: "sam",
      handle: "sam",
      isGroup: false,
      messageType: "text",
    });

    const consumed = await consumeWebInboxRequest({ workspacePath });

    expect(consumed.handled).toBe(true);
    expect(consumed.requestNumber).toBe(created.requestNumber);
    expect(consumed.chatId).toBe("web:family");
    expect(consumed.response).toBe("今晚 18:30 还要接娃。");
    expect(path.basename(consumed.sourceFilePath || "")).toBe(path.basename(created.path));
    expect(path.basename(consumed.triagedFilePath || "")).toContain(".triaged.web.");

    const triaged = await listInboxRequests(workspacePath, { state: "triaged", transport: "web" });
    expect(triaged).toHaveLength(1);

    const windowMessages = await loadWindow(workspacePath, "web:family");
    expect(windowMessages).toHaveLength(2);
    expect(windowMessages[0]).toMatchObject({
      role: "user",
      content: "今晚还有什么安排？",
      senderId: "sam",
      senderName: "sam",
    });
    expect(windowMessages[1]).toMatchObject({
      role: "assistant",
      content: "今晚 18:30 还要接娃。",
    });

    const threadsDir = path.join(workspacePath, ".msgcode", "threads");
    const threadFiles = await fsp.readdir(threadsDir);
    expect(threadFiles.length).toBe(1);

    const helpData = await getHelpDocsData();
    const commandNames = helpData.commands.map((command) => String((command as { name?: string }).name || ""));
    expect(commandNames).toContain("msgcode inbox consume-web");
  });

  it("没有待消费 web 请求时应返回 handled=false", async () => {
    const { consumeWebInboxRequest } = await import("../src/cli/inbox.js");
    const consumed = await consumeWebInboxRequest({ workspacePath });
    expect(consumed).toEqual({ handled: false });
  });

  it("坏的 inbox 文件应报错，且保持 new 状态不推进", async () => {
    const { consumeWebInboxRequest } = await import("../src/cli/inbox.js");
    const { listInboxRequests } = await import("../src/runtime/inbox-store.js");

    const inboxDir = path.join(workspacePath, ".msgcode", "inbox");
    await fsp.mkdir(inboxDir, { recursive: true });
    const brokenPath = path.join(inboxDir, "rq0001.new.web.broken.md");
    await fsp.writeFile(
      brokenPath,
      [
        "---",
        "request_id: web-bad-1",
        "created_at: 2026-03-21T10:00:00.000Z",
        "---",
        "",
        "# Request",
        "- sender: sam",
        "",
        "## Text",
        "```text",
        "坏文件",
        "```",
        "",
      ].join("\n"),
      "utf8"
    );

    await expect(consumeWebInboxRequest({ workspacePath })).rejects.toThrow("request_id 或 chat_id");

    const stillNew = await listInboxRequests(workspacePath, { state: "new", transport: "web" });
    expect(stillNew).toHaveLength(1);
    expect(stillNew[0]?.path).toBe(brokenPath);
  });
});

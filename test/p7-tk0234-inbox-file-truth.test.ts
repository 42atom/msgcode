import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("tk0234 inbox file truth", () => {
  let tmpRoot = "";
  let homeDir = "";
  let workspacePath = "";
  let routesPath = "";
  let statePath = "";
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: Record<string, string | undefined>;
  let originalOwnerOnlyInGroup = false;
  let originalOwnerIdentifiers: string[] = [];
  let originalWhitelistEmails: string[] = [];

  beforeEach(async () => {
    tmpRoot = createTempDir("msgcode-tk0234-");
    homeDir = path.join(tmpRoot, "home");
    workspacePath = path.join(tmpRoot, "workspace");
    routesPath = path.join(tmpRoot, "routes.json");
    statePath = path.join(tmpRoot, "state.json");

    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(workspacePath, { recursive: true });

    originalFetch = globalThis.fetch;
    originalEnv = {
      HOME: process.env.HOME,
      ROUTES_FILE_PATH: process.env.ROUTES_FILE_PATH,
      STATE_FILE_PATH: process.env.STATE_FILE_PATH,
      WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
      MSGCODE_DEFAULT_WORKSPACE_DIR: process.env.MSGCODE_DEFAULT_WORKSPACE_DIR,
      AGENT_BACKEND: process.env.AGENT_BACKEND,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_MODEL: process.env.OPENAI_MODEL,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    };

    process.env.HOME = homeDir;
    process.env.ROUTES_FILE_PATH = routesPath;
    process.env.STATE_FILE_PATH = statePath;
    process.env.WORKSPACE_ROOT = tmpRoot;
    process.env.MSGCODE_DEFAULT_WORKSPACE_DIR = "workspace";
    process.env.AGENT_BACKEND = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-test";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:18080";

    const { config } = await import("../src/config.js");
    originalOwnerOnlyInGroup = config.ownerOnlyInGroup;
    originalOwnerIdentifiers = [...config.ownerIdentifiers];
    originalWhitelistEmails = [...config.whitelist.emails];
    config.ownerOnlyInGroup = false;
    config.ownerIdentifiers = [];
    if (!config.whitelist.emails.includes("tester@example.com")) {
      config.whitelist.emails.push("tester@example.com");
    }
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;

    const { config } = await import("../src/config.js");
    config.ownerOnlyInGroup = originalOwnerOnlyInGroup;
    config.ownerIdentifiers = [...originalOwnerIdentifiers];
    config.whitelist.emails = [...originalWhitelistEmails];

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("createInboxRequest 应落 new 文件，并能推进到 triaged", async () => {
    const inboxStore = await import(`../src/runtime/inbox-store.js?case=tk0234-store-${Date.now()}`);

    const created = await inboxStore.createInboxRequest(workspacePath, {
      id: "msg-store-1",
      transport: "feishu",
      chatId: "feishu:oc_store_case",
      text: "Please keep inbox truth visible",
      isFromMe: false,
      sender: "tester@example.com",
      handle: "tester@example.com",
      messageType: "text",
    });

    expect(path.basename(created.path)).toBe("rq0001.new.feishu.please-keep-inbox-truth-visible.md");
    expect(fs.existsSync(created.path)).toBe(true);

    const createdContent = fs.readFileSync(created.path, "utf8");
    expect(createdContent).toContain("transport: feishu");
    expect(createdContent).toContain("request_id: msg-store-1");
    expect(createdContent).toContain("Please keep inbox truth visible");

    const triaged = await inboxStore.advanceInboxRequestState(created, "triaged");

    expect(path.basename(triaged.path)).toBe("rq0001.triaged.feishu.please-keep-inbox-truth-visible.md");
    expect(fs.existsSync(created.path)).toBe(false);
    expect(fs.existsSync(triaged.path)).toBe(true);
  });

  it("listener 主链应为入站消息留下 triaged inbox 文件", async () => {
    const nowIso = new Date().toISOString();
    fs.writeFileSync(routesPath, JSON.stringify({
      version: 1,
      routes: {
        "feishu:oc_tk0234": {
          chatGuid: "feishu:oc_tk0234",
          chatId: "feishu:oc_tk0234",
          workspacePath,
          label: "default",
          botType: "agent-backend",
          status: "active",
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      },
    }, null, 2), "utf8");

    const { saveWorkspaceConfig } = await import(`../src/config/workspace.js?case=tk0234-workspace-${Date.now()}`);
    await saveWorkspaceConfig(workspacePath, {
      "tooling.mode": "explicit",
      "memory.inject.enabled": false,
    });

    globalThis.fetch = (async () => {
      return new Response(
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
        },
      );
    }) as typeof fetch;

    class FakeSendClient {
      sent: Array<{ chatId: string; text: string }> = [];

      async send(params: { chatId: string; text: string }) {
        this.sent.push({ chatId: params.chatId, text: params.text || "" });
        return { ok: true };
      }
    }

    const sendClient = new FakeSendClient();
    const { handleMessage } = await import(`../src/listener.js?case=tk0234-listener-${Date.now()}`);

    await handleMessage(
      {
        id: "msg-inbox-1",
        transport: "feishu",
        chatId: "feishu:oc_tk0234",
        text: "Please continue inbox file truth",
        isFromMe: false,
        sender: "tester@example.com",
        handle: "tester@example.com",
        messageType: "text",
      },
      { sendClient },
    );

    expect(sendClient.sent.at(-1)?.text).toBe("处理完成");

    const inboxDir = path.join(workspacePath, ".msgcode", "inbox");
    const inboxFiles = fs.readdirSync(inboxDir).sort();
    expect(inboxFiles).toEqual([
      "rq0001.triaged.feishu.please-continue-inbox-file-truth.md",
    ]);

    const inboxContent = fs.readFileSync(path.join(inboxDir, inboxFiles[0]), "utf8");
    expect(inboxContent).toContain("transport: feishu");
    expect(inboxContent).toContain("request_id: msg-inbox-1");
    expect(inboxContent).toContain("Please continue inbox file truth");
  });
});

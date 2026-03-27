import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../src/config.js";

const TEST_ROUTES_FILE = path.join(os.tmpdir(), ".config/msgcode/routes-task-promotion.test.json");
const TEST_WORKSPACE_ROOT = path.join(os.tmpdir(), "msgcode-workspaces-task-promotion.test");
const TEST_CHAT_ID = "feishu:oc_task_promotion";
const TEST_WORKSPACE_PATH = path.join(TEST_WORKSPACE_ROOT, "ws-a");

class FakeSendClient {
  public sent: Array<{ chatId: string; text: string }> = [];

  async send(params: { chatId: string; text: string }): Promise<{ ok: boolean }> {
    this.sent.push({ chatId: params.chatId, text: params.text });
    return { ok: true };
  }
}

function cleanTestData(): void {
  if (fs.existsSync(TEST_ROUTES_FILE)) {
    fs.unlinkSync(TEST_ROUTES_FILE);
  }
  if (fs.existsSync(TEST_WORKSPACE_ROOT)) {
    fs.rmSync(TEST_WORKSPACE_ROOT, { recursive: true, force: true });
  }
}

function writeActiveRoute(): void {
  fs.mkdirSync(path.dirname(TEST_ROUTES_FILE), { recursive: true });
  fs.mkdirSync(TEST_WORKSPACE_PATH, { recursive: true });
  fs.writeFileSync(
    TEST_ROUTES_FILE,
    JSON.stringify(
      {
        version: 1,
        routes: {
          [TEST_CHAT_ID]: {
            chatGuid: TEST_CHAT_ID,
            workspacePath: TEST_WORKSPACE_PATH,
            botType: "agent-backend",
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

describe("tk0400: message timeout promote to task", () => {
  beforeEach(() => {
    mock.restore();
    cleanTestData();
    writeActiveRoute();

    process.env.ROUTES_FILE_PATH = TEST_ROUTES_FILE;
    process.env.WORKSPACE_ROOT = TEST_WORKSPACE_ROOT;
    process.env.MSGCODE_DEFAULT_WORKSPACE_DIR = "default";

    if (!config.whitelist.emails.includes("test@example.com")) {
      config.whitelist.emails.push("test@example.com");
    }
    config.ownerOnlyInGroup = false;
    config.ownerIdentifiers = [];
  });

  afterEach(() => {
    mock.restore();
    delete process.env.ROUTES_FILE_PATH;
    delete process.env.WORKSPACE_ROOT;
    delete process.env.MSGCODE_DEFAULT_WORKSPACE_DIR;
    cleanTestData();
  });

  it("listener 应把 message continuable 结果转成后台 task 并立即回执", async () => {
    const createdTasks: Array<{ chatId: string; workspacePath: string; goal: string }> = [];
    let triggered = false;

    mock.module("../src/handlers.js", () => ({
      getHandler: () => ({
        handle: async () => ({
          success: true,
          response: "这轮排查已转后台继续，我做完后会直接回帖。",
          backgroundTask: {
            goal: "继续处理刚才的请求",
          },
        }),
      }),
    }));

    mock.module("../src/commands.js", () => ({
      isFastLaneInFlight: () => false,
      wasFastReplied: () => false,
      getTaskSupervisor: () => ({
        createTask: async (chatId: string, workspacePath: string, goal: string) => {
          createdTasks.push({ chatId, workspacePath, goal });
          return {
            ok: true as const,
            task: {
              taskId: "task-promoted-1",
              taskRef: "001",
              chatId,
              workspacePath,
              goal,
              status: "pending",
            },
          };
        },
      }),
      triggerTaskHeartbeatNow: () => {
        triggered = true;
        return true;
      },
    }));

    const { handleMessage } = await import(`../src/listener.js?task-promotion=${Date.now()}`);
    const client = new FakeSendClient();

    await handleMessage(
      {
        id: "m-task-promotion",
        chatId: TEST_CHAT_ID,
        text: "帮我继续排查 homepod",
        isFromMe: false,
        sender: "test@example.com",
        handle: "test@example.com",
      },
      { sendClient: client as unknown as any }
    );

    expect(createdTasks).toHaveLength(1);
    expect(createdTasks[0]?.chatId).toBe(TEST_CHAT_ID);
    expect(createdTasks[0]?.workspacePath).toBe(TEST_WORKSPACE_PATH);
    expect(createdTasks[0]?.goal).toBe("继续处理刚才的请求");
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]?.text).toContain("这轮排查已转后台继续");
    expect(client.sent[0]?.text).toContain("任务号: 001");
    expect(triggered).toBe(true);
  });
});

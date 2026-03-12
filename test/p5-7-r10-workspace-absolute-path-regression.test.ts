/**
 * P5.7-R10: workspace absolute path regression lock
 *
 * 防止 memory/todo/schedule 误将绝对路径 workspace 判定为 PATH_TRAVERSAL。
 */

import { afterEach, describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { routeByChatId } from "../src/router.js";
import { runCliIsolated } from "./helpers/cli-process.js";

interface Envelope {
  status: "pass" | "warning" | "error";
  errors?: Array<{ code?: string }>;
  data?: Record<string, unknown>;
}

const tempDirs: string[] = [];
const ORIGINAL_WORKSPACE_ROOT = process.env.WORKSPACE_ROOT;
const ORIGINAL_ROUTES_FILE_PATH = process.env.ROUTES_FILE_PATH;
const ORIGINAL_DEFAULT_WORKSPACE_DIR = process.env.MSGCODE_DEFAULT_WORKSPACE_DIR;

function createWorkspace(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "msgcode-abs-ws-"));
  tempDirs.push(dir);
  return dir;
}

function runCli(args: string[]): { code: number; envelope: Envelope; stderr: string } {
  const result = runCliIsolated(args, {
    env: {
      WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
      ROUTES_FILE_PATH: process.env.ROUTES_FILE_PATH,
      MSGCODE_DEFAULT_WORKSPACE_DIR: process.env.MSGCODE_DEFAULT_WORKSPACE_DIR,
    },
  });

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  let envelope: Envelope = { status: "error" };
  if (stdout) {
    try {
      envelope = JSON.parse(stdout) as Envelope;
    } catch {
      // 保持默认 envelope，便于断言失败时输出 stderr
    }
  }
  return { code: result.status ?? 1, envelope, stderr };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  process.env.WORKSPACE_ROOT = ORIGINAL_WORKSPACE_ROOT;
  process.env.ROUTES_FILE_PATH = ORIGINAL_ROUTES_FILE_PATH;
  process.env.MSGCODE_DEFAULT_WORKSPACE_DIR = ORIGINAL_DEFAULT_WORKSPACE_DIR;
});

describe("P5.7-R10: absolute workspace path", () => {
  it("memory add 应支持绝对路径 workspace", () => {
    const ws = createWorkspace();
    const res = runCli(["memory", "add", "alpha memory", "--workspace", ws, "--json"]);

    expect(res.code).toBe(0);
    expect(res.envelope.status).toBe("pass");
    expect(String(res.envelope.data?.path || "")).toContain(ws);
  });

  it("todo add/list 应支持绝对路径 workspace", () => {
    const ws = createWorkspace();
    const add = runCli(["todo", "add", "finish audit", "--workspace", ws, "--json"]);
    const list = runCli(["todo", "list", "--workspace", ws, "--json"]);

    expect(add.code).toBe(0);
    expect(add.envelope.status).toBe("pass");
    expect(list.code).toBe(0);
    expect(list.envelope.status).toBe("pass");
    expect(Number(list.envelope.data?.count || 0)).toBeGreaterThanOrEqual(1);
  });

  it("schedule add/list/remove 应支持绝对路径 workspace", () => {
    const ws = createWorkspace();

    // P5.7-R14: schedule add 现在需要 route 绑定，无绑定时会失败
    // 先测试 add 失败（因为没有 route）
    const add = runCli([
      "schedule",
      "add",
      "daily-check",
      "--workspace",
      ws,
      "--cron",
      "0 9 * * *",
      "--tz",
      "UTC",
      "--message",
      "daily check",
      "--json",
    ]);

    // 无 route 时应该返回错误
    expect(add.code).not.toBe(0);
    expect(add.envelope.status).toBe("error");

    // 验证错误码是 SCHEDULE_WORKSPACE_NOT_FOUND（route 未绑定）
    expect(add.envelope.errors?.[0]?.code).toBe("SCHEDULE_WORKSPACE_NOT_FOUND");

    // list 和 remove 在无 route 时仍然可以工作（只操作文件系统）
    const list = runCli(["schedule", "list", "--workspace", ws, "--json"]);
    expect(list.code).toBe(0);
    expect(list.envelope.status).toBe("pass");

    const remove = runCli(["schedule", "remove", "daily-check", "--workspace", ws, "--json"]);
    expect(remove.code).not.toBe(0); // 失败是因为 schedule 不存在
  });

  it("default workspace 自动落地后，schedule add 应可成功投递到当前群", () => {
    const root = createWorkspace();
    const routesFile = path.join(root, "config", "routes.json");
    const defaultWorkspace = path.join(root, "default");
    const chatId = "feishu:oc_default_schedule";

    process.env.WORKSPACE_ROOT = root;
    process.env.ROUTES_FILE_PATH = routesFile;
    process.env.MSGCODE_DEFAULT_WORKSPACE_DIR = "default";

    const routed = routeByChatId(chatId);
    expect(routed?.projectDir).toBe(defaultWorkspace);

    const add = runCli([
      "schedule",
      "add",
      "default-daily-check",
      "--workspace",
      defaultWorkspace,
      "--cron",
      "0 9 * * *",
      "--tz",
      "UTC",
      "--message",
      "daily check",
      "--json",
    ]);

    expect(add.code).toBe(0);
    expect(add.envelope.status).toBe("pass");
    expect(String(add.envelope.data?.path || "")).toContain(defaultWorkspace);
  });

  it("相对路径越界应仍返回 PATH_TRAVERSAL", () => {
    const res = runCli(["memory", "add", "blocked", "--workspace", "../outside", "--json"]);

    expect(res.code).toBe(1);
    expect(res.envelope.status).toBe("error");
    expect(res.envelope.errors?.[0]?.code).toBe("MEMORY_PATH_TRAVERSAL");
  });
});

/**
 * P5.7-R10: workspace absolute path regression lock
 *
 * 防止 memory/todo/schedule 误将绝对路径 workspace 判定为 PATH_TRAVERSAL。
 */

import { afterEach, describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

interface Envelope {
  status: "pass" | "warning" | "error";
  errors?: Array<{ code?: string }>;
  data?: Record<string, unknown>;
}

const tempDirs: string[] = [];

function createWorkspace(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "msgcode-abs-ws-"));
  tempDirs.push(dir);
  return dir;
}

function runCli(args: string[]): { code: number; envelope: Envelope; stderr: string } {
  const result = spawnSync("node", ["src/cli.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, LOG_FILE: "false", LOG_LEVEL: "warn", NODE_OPTIONS: "--import tsx" },
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
    const list = runCli(["schedule", "list", "--workspace", ws, "--json"]);
    const remove = runCli(["schedule", "remove", "daily-check", "--workspace", ws, "--json"]);

    expect(add.code).toBe(0);
    expect(add.envelope.status).toBe("pass");
    expect(list.code).toBe(0);
    expect(list.envelope.status).toBe("pass");
    expect(remove.code).toBe(0);
    expect(remove.envelope.status).toBe("pass");
  });

  it("相对路径越界应仍返回 PATH_TRAVERSAL", () => {
    const res = runCli(["memory", "add", "blocked", "--workspace", "../outside", "--json"]);

    expect(res.code).toBe(1);
    expect(res.envelope.status).toBe("error");
    expect(res.envelope.errors?.[0]?.code).toBe("MEMORY_PATH_TRAVERSAL");
  });
});

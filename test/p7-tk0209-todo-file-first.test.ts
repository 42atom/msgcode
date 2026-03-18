import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(home: string, args: string[], cwd: string): string {
  const result = spawnSync("node", ["src/cli.ts", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      LOG_FILE: "false",
      LOG_LEVEL: "warn",
      MY_EMAIL: "test@example.com",
      NODE_OPTIONS: "--import tsx",
    },
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `exit=${result.status}`);
  }

  return result.stdout;
}

describe("tk0209: todo file-first closure", () => {
  let home = "";
  let workspace = "";
  let repoRoot = "";

  beforeEach(() => {
    home = createTempDir("msgcode-home-");
    workspace = createTempDir("msgcode-workspace-");
    repoRoot = path.resolve(import.meta.dir, "..");
    fs.mkdirSync(path.join(workspace, ".msgcode"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("R1: add/list/done 主链落到 todo.json", () => {
    const added = JSON.parse(
      runCli(home, ["todo", "add", "收口 todo file-first", "--workspace", workspace, "--json"], repoRoot)
    ) as { data: { taskId: string } };

    const todoJsonPath = path.join(workspace, ".msgcode", "todo.json");
    expect(fs.existsSync(todoJsonPath)).toBe(true);

    const todoState = JSON.parse(fs.readFileSync(todoJsonPath, "utf8")) as {
      version: number;
      items: Array<{ id: string; status: string; title: string }>;
    };
    expect(todoState.version).toBe(1);
    expect(todoState.items[0]?.id).toBe(added.data.taskId);
    expect(todoState.items[0]?.status).toBe("pending");

    const listed = JSON.parse(
      runCli(home, ["todo", "list", "--workspace", workspace, "--json"], repoRoot)
    ) as { data: { count: number; items: Array<{ id: string }> } };
    expect(listed.data.count).toBe(1);
    expect(listed.data.items[0]?.id).toBe(added.data.taskId);

    const done = JSON.parse(
      runCli(home, ["todo", "done", added.data.taskId, "--workspace", workspace, "--json"], repoRoot)
    ) as { data: { taskId: string; status: string } };
    expect(done.data.taskId).toBe(added.data.taskId);
    expect(done.data.status).toBe("done");

    const finalState = JSON.parse(fs.readFileSync(todoJsonPath, "utf8")) as {
      items: Array<{ id: string; status: string; doneAt: string | null }>;
    };
    expect(finalState.items[0]?.status).toBe("done");
    expect(finalState.items[0]?.doneAt).toBeTruthy();
  });

  it("R2: 遇到历史 todo.db 时只做一次性导入", () => {
    const dbPath = path.join(workspace, ".msgcode", "todo.db");
    const bootstrap = `
      const Database = require("better-sqlite3");
      const db = new Database(${JSON.stringify(dbPath)});
      db.exec("CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', createdAt TEXT NOT NULL, doneAt TEXT)");
      db.prepare("INSERT INTO todos (id, title, status, createdAt, doneAt) VALUES (?, ?, ?, ?, ?)").run(
        "legacy-001",
        "legacy todo",
        "pending",
        "2026-03-18T00:00:00.000Z",
        null
      );
      db.close();
    `;

    const createDb = spawnSync("node", ["-e", bootstrap], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (createDb.status !== 0) {
      throw new Error(createDb.stderr || createDb.stdout || "failed to create legacy todo.db");
    }

    const listed = JSON.parse(
      runCli(home, ["todo", "list", "--workspace", workspace, "--json"], repoRoot)
    ) as { data: { count: number; items: Array<{ id: string; title: string }> } };

    expect(listed.data.count).toBe(1);
    expect(listed.data.items[0]?.id).toBe("legacy-001");
    expect(fs.existsSync(path.join(workspace, ".msgcode", "todo.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, ".msgcode", "todo.db.legacy.bak"))).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});

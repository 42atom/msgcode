import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(home: string, args: string[], cwd: string) {
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

  if (![0, 2].includes(result.status ?? 1)) {
    throw new Error(result.stderr || result.stdout || `exit=${result.status}`);
  }

  return JSON.parse(result.stdout) as {
    status: string;
    exitCode: number;
    warnings: Array<{ code: string; hint?: string }>;
    data: { count: number; results: unknown[] };
  };
}

describe("tk0229: memory retrieval read path", () => {
  let tempHome = "";
  let workspace = "";
  let repoRoot = "";

  beforeEach(() => {
    tempHome = createTempDir("msgcode-home-");
    workspace = createTempDir("msgcode-workspace-");
    repoRoot = path.resolve(import.meta.dir, "..");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "memory", "2026-03-18.md"), "# Memory\n\nappend truth only\n", "utf8");
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("R1: memory search 在有 append 文件但无索引时返回 warning 与重建建议", () => {
    const result = runCli(
      tempHome,
      ["memory", "search", "append", "--workspace", workspace, "--json"],
      repoRoot
    );

    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(2);
    expect(result.data.count).toBe(0);
    expect(result.warnings[0]?.code).toBe("MEMORY_INDEX_MISSING");
    expect(String(result.warnings[0]?.hint || "")).toContain("msgcode memory index --workspace");
  });
});

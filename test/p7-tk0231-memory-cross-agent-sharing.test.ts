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

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `exit=${result.status}`);
  }

  return JSON.parse(result.stdout) as { data: Record<string, any> };
}

describe("tk0231: memory cross-agent sharing on file truth", () => {
  let tempHome = "";
  let parentA = "";
  let parentB = "";
  let workspaceA = "";
  let workspaceB = "";
  let repoRoot = "";

  beforeEach(() => {
    tempHome = createTempDir("msgcode-home-");
    parentA = createTempDir("msgcode-parent-a-");
    parentB = createTempDir("msgcode-parent-b-");
    workspaceA = path.join(parentA, "shared-name");
    workspaceB = path.join(parentB, "shared-name");
    repoRoot = path.resolve(import.meta.dir, "..");

    fs.mkdirSync(path.join(workspaceA, "memory"), { recursive: true });
    fs.mkdirSync(path.join(workspaceB, "memory"), { recursive: true });
    fs.writeFileSync(path.join(workspaceA, "memory", "2026-03-18.md"), "# Memory\n\nalpha only\n", "utf8");
    fs.writeFileSync(path.join(workspaceB, "memory", "2026-03-18.md"), "# Memory\n\nbeta only\n", "utf8");
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(parentA, { recursive: true, force: true });
    fs.rmSync(parentB, { recursive: true, force: true });
  });

  it("R1: 不同路径下同名 workspace 不应在检索中串味", () => {
    const indexedA = runCli(tempHome, ["memory", "index", "--workspace", workspaceA, "--json"], repoRoot);
    const indexedB = runCli(tempHome, ["memory", "index", "--workspace", workspaceB, "--json"], repoRoot);

    expect(String(indexedA.data.workspaceId)).not.toBe(String(indexedB.data.workspaceId));

    const searchA = runCli(tempHome, ["memory", "search", "alpha", "--workspace", workspaceA, "--json"], repoRoot);
    const searchB = runCli(tempHome, ["memory", "search", "beta", "--workspace", workspaceB, "--json"], repoRoot);
    const crossA = runCli(tempHome, ["memory", "search", "beta", "--workspace", workspaceA, "--json"], repoRoot);
    const crossB = runCli(tempHome, ["memory", "search", "alpha", "--workspace", workspaceB, "--json"], repoRoot);

    expect(Number(searchA.data.count)).toBeGreaterThan(0);
    expect(Number(searchB.data.count)).toBeGreaterThan(0);
    expect(Number(crossA.data.count)).toBe(0);
    expect(Number(crossB.data.count)).toBe(0);
  });
});

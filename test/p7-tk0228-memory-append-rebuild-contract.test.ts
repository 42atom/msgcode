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

describe("tk0228: memory append truth and rebuild contract", () => {
  let tempHome = "";
  let workspace = "";
  let repoRoot = "";

  beforeEach(() => {
    tempHome = createTempDir("msgcode-home-");
    workspace = createTempDir("msgcode-workspace-");
    repoRoot = path.resolve(import.meta.dir, "..");
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("R1: 删除 index.sqlite 后，仍可从 memory/*.md 重建并命中检索", () => {
    const added = runCli(
      tempHome,
      ["memory", "add", "append truth survives rebuild", "--workspace", workspace, "--json"],
      repoRoot
    );
    const memoryPath = String(added.data.path);

    expect(memoryPath).toContain("/memory/");
    expect(fs.existsSync(memoryPath)).toBe(true);
    expect(fs.readFileSync(memoryPath, "utf8")).toContain("append truth survives rebuild");

    const firstIndex = runCli(
      tempHome,
      ["memory", "index", "--workspace", workspace, "--json"],
      repoRoot
    );
    const indexPath = String(firstIndex.data.indexPath);

    expect(firstIndex.data.indexedFiles).toBe(1);
    expect(fs.existsSync(indexPath)).toBe(true);

    const firstSearch = runCli(
      tempHome,
      ["memory", "search", "survives", "--workspace", workspace, "--json"],
      repoRoot
    );
    expect(Number(firstSearch.data.count)).toBeGreaterThan(0);

    fs.rmSync(indexPath, { force: true });
    expect(fs.existsSync(indexPath)).toBe(false);
    expect(fs.readFileSync(memoryPath, "utf8")).toContain("append truth survives rebuild");

    const statsAfterDelete = runCli(tempHome, ["memory", "stats", "--json"], repoRoot);
    expect(statsAfterDelete.data.store.indexedFiles).toBe(0);

    const rebuilt = runCli(
      tempHome,
      ["memory", "index", "--workspace", workspace, "--json"],
      repoRoot
    );
    expect(rebuilt.data.indexedFiles).toBe(1);

    const rebuiltSearch = runCli(
      tempHome,
      ["memory", "search", "survives", "--workspace", workspace, "--json"],
      repoRoot
    );
    expect(Number(rebuiltSearch.data.count)).toBeGreaterThan(0);
    expect(String(rebuiltSearch.data.results[0]?.path)).toMatch(/^memory\/\d{4}-\d{2}-\d{2}\.md$/);
  });
});

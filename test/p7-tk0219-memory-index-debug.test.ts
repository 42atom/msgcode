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

describe("tk0219: memory index sha256 + dirty detection + debug", () => {
  let tempHome = "";
  let workspace = "";
  let repoRoot = "";

  beforeEach(() => {
    tempHome = createTempDir("msgcode-home-");
    workspace = createTempDir("msgcode-workspace-");
    repoRoot = path.resolve(import.meta.dir, "..");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "memory", "2026-03-18.md"), "# Memory\n\nhello\n", "utf8");
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("R1: memory index 会写入真实 sha256，并跳过未变化文件", () => {
    const first = JSON.parse(
      runCli(tempHome, ["memory", "index", "--workspace", workspace, "--json"], repoRoot)
    ) as { data: { indexedFiles: number; skippedFiles: number; refreshedMetadata: number } };

    expect(first.data.indexedFiles).toBe(1);
    expect(first.data.skippedFiles).toBe(0);
    expect(first.data.refreshedMetadata).toBe(0);

    const statsAfterFirstIndex = JSON.parse(
      runCli(tempHome, ["memory", "stats", "--json"], repoRoot)
    ) as { data: { store: { documentsWithoutSha256: number; indexedFiles: number } } };

    expect(statsAfterFirstIndex.data.store.indexedFiles).toBe(1);
    expect(statsAfterFirstIndex.data.store.documentsWithoutSha256).toBe(0);

    const second = JSON.parse(
      runCli(tempHome, ["memory", "index", "--workspace", workspace, "--json"], repoRoot)
    ) as { data: { indexedFiles: number; skippedFiles: number; refreshedMetadata: number } };

    expect(second.data.indexedFiles).toBe(0);
    expect(second.data.skippedFiles).toBe(1);
    expect(second.data.refreshedMetadata).toBe(0);
  });

  it("R2: memory stats 能看见 content_changed 脏文件", () => {
    runCli(tempHome, ["memory", "index", "--workspace", workspace, "--json"], repoRoot);

    fs.writeFileSync(path.join(workspace, "memory", "2026-03-18.md"), "# Memory\n\nhello changed\n", "utf8");

    const stats = JSON.parse(
      runCli(tempHome, ["memory", "stats", "--json"], repoRoot)
    ) as {
      data: {
        dirty: {
          files: Array<{ path: string; reason: string }>;
        };
      };
    };

    expect(stats.data.dirty.files).toHaveLength(1);
    expect(stats.data.dirty.files[0]?.path).toBe("memory/2026-03-18.md");
    expect(stats.data.dirty.files[0]?.reason).toBe("content_changed");
  });
});

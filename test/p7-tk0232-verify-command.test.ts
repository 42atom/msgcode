import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeDispatchRecord, loadDispatchRecords } from "../src/runtime/work-continuity.js";

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
    data: {
      ok: boolean;
      verificationCommands: string[];
      results: Array<{ command: string; ok: boolean; exitCode: number }>;
      dispatchId?: string;
    };
  };
}

describe("tk0232: verify command and result contract", () => {
  let tempHome = "";
  let workspace = "";
  let repoRoot = "";

  beforeEach(() => {
    tempHome = createTempDir("msgcode-home-");
    workspace = createTempDir("msgcode-workspace-");
    repoRoot = path.resolve(import.meta.dir, "..");
    fs.mkdirSync(path.join(workspace, "issues"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "issues", "tk1234.tdo.runtime.verify-smoke.p1.md"), `---
owner: agent
assignee: codex
reviewer: user
why: test verify
scope: test
risk: low
accept: pass
---

# Task

测试 verify

## Verify

- \`printf verified\`
- \`node -e "process.exit(0)"\`
`, "utf8");
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("R1: verify run 应执行任务文档里的验证命令并输出证据", () => {
    const result = runCli(
      tempHome,
      ["verify", "run", "--workspace", workspace, "--task", "tk1234", "--json"],
      repoRoot
    );

    expect(result.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.data.ok).toBe(true);
    expect(result.data.verificationCommands).toEqual([
      "printf verified",
      'node -e "process.exit(0)"',
    ]);
    expect(result.data.results).toHaveLength(2);
    expect(result.data.results.every((item) => item.ok)).toBe(true);
  });

  it("R2: verify run 带 dispatch 时应把证据回写到 dispatch.result.evidence", async () => {
    const dispatch = await writeDispatchRecord({
      workspacePath: workspace,
      parentTaskId: "tk0001",
      childTaskId: "tk1234",
      client: "codex",
      goal: "测试 verify",
      cwd: workspace,
      acceptance: ["pass"],
      verificationCommands: ["printf verified"],
      status: "completed",
      result: {
        completed: true,
        summary: "done",
      },
    });

    const result = runCli(
      tempHome,
      ["verify", "run", "--workspace", workspace, "--task", "tk1234", "--dispatch", dispatch.dispatchId, "--json"],
      repoRoot
    );

    expect(result.data.dispatchId).toBe(dispatch.dispatchId);

    const records = await loadDispatchRecords(workspace);
    const updated = records.records.find((item) => item.dispatchId === dispatch.dispatchId);
    expect(updated?.result?.evidence?.length).toBeGreaterThan(0);
    expect(String(updated?.result?.evidence?.[0] || "")).toContain('"taskId":"tk1234"');
  });
});

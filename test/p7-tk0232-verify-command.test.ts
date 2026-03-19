import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeVerifyRun } from "../src/cli/verify.js";
import { __resetBashRunnerTestDeps, __setBashRunnerTestDeps } from "../src/runners/bash-runner.js";
import { writeDispatchRecord, loadDispatchRecords } from "../src/runtime/work-continuity.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("tk0232: verify command and result contract", () => {
  let tempHome = "";
  let workspace = "";

  beforeEach(() => {
    tempHome = createTempDir("msgcode-home-");
    workspace = createTempDir("msgcode-workspace-");
    __setBashRunnerTestDeps({ resolveManagedBashPath: () => "/bin/bash" });
    process.env.HOME = tempHome;
    process.env.LOG_FILE = "false";
    process.env.LOG_LEVEL = "warn";
    process.env.MY_EMAIL = "test@example.com";
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
    __resetBashRunnerTestDeps();
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("R1: verify run 应执行任务文档里的验证命令并输出证据", async () => {
    const result = await executeVerifyRun({
      workspace,
      task: "tk1234",
    });

    expect(result.envelope.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.envelope.data.ok).toBe(true);
    expect(result.envelope.data.verificationCommands).toEqual([
      "printf verified",
      'node -e "process.exit(0)"',
    ]);
    expect(result.envelope.data.results).toHaveLength(2);
    expect(result.envelope.data.results.every((item) => item.ok)).toBe(true);
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

    const result = await executeVerifyRun({
      workspace,
      task: "tk1234",
      dispatch: dispatch.dispatchId,
    });

    expect(result.envelope.data.dispatchId).toBe(dispatch.dispatchId);

    const records = await loadDispatchRecords(workspace);
    const updated = records.records.find((item) => item.dispatchId === dispatch.dispatchId);
    expect(updated?.result?.evidence?.length).toBeGreaterThan(0);
    const evidence = JSON.parse(String(updated?.result?.evidence?.[0] || "{}")) as {
      taskId: string;
      commands: Array<{ stdoutTail: string; stderrTail: string }>;
    };
    expect(evidence.taskId).toBe("tk1234");
    expect(evidence.commands[0]).toHaveProperty("stdoutTail");
    expect(evidence.commands[0]).toHaveProperty("stderrTail");
  });
});

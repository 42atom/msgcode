import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeVerifyPack } from "../src/cli/verify.js";
import { __resetBashRunnerTestDeps, __setBashRunnerTestDeps } from "../src/runners/bash-runner.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("tk0268: verify pack normalization for coding lane", () => {
  let tempHome = "";
  let workspace = "";
  let repoRoot = "";

  beforeEach(() => {
    tempHome = createTempDir("msgcode-home-");
    workspace = createTempDir("msgcode-workspace-");
    repoRoot = path.resolve(import.meta.dir, "..");
    __setBashRunnerTestDeps({ resolveManagedBashPath: () => "/bin/bash" });
    process.env.HOME = tempHome;
    process.env.LOG_FILE = "false";
    process.env.LOG_LEVEL = "warn";
    process.env.MY_EMAIL = "test@example.com";
    fs.mkdirSync(path.join(workspace, "issues"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "issues", "tk1234.tdo.runtime.verify-pack-custom.p1.md"), `---
owner: agent
assignee: codex
reviewer: user
why: test verify pack
scope: test
risk: low
accept: pass
---

# Task

测试 verify pack

## Verify

- \`printf custom-task-verified\`
`, "utf8");
  });

  afterEach(() => {
    __resetBashRunnerTestDeps();
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("R1: custom pack 应执行显式命令", async () => {
    const result = await executeVerifyPack("custom", {
      workspace,
      command: ["printf pack-ok"],
    });

    expect(result.envelope.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.envelope.data.pack).toBe("custom");
    expect(result.envelope.data.ok).toBe(true);
    expect(result.envelope.data.verificationCommands).toEqual(["printf pack-ok"]);
    expect(result.envelope.data.results[0]?.ok).toBe(true);
  });

  it("R2: custom pack 带 task 时应读取任务文档里的 Verify 命令", async () => {
    const result = await executeVerifyPack("custom", {
      workspace,
      task: "tk1234",
    });

    expect(result.envelope.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.envelope.data.pack).toBe("custom");
    expect(result.envelope.data.taskId).toBe("tk1234");
    expect(result.envelope.data.verificationCommands).toEqual(["printf custom-task-verified"]);
    expect(result.envelope.data.results[0]?.ok).toBe(true);
  });

  it("R3: e2e pack 没有显式命令时应返回 warning，而不是伪造默认 smoke", async () => {
    const result = await executeVerifyPack("e2e", {
      workspace,
    });

    expect(result.envelope.status).toBe("warning");
    expect(result.exitCode).toBe(2);
    expect(result.envelope.data.pack).toBe("e2e");
    expect(result.envelope.data.ok).toBe(false);
    expect(result.envelope.data.verificationCommands).toEqual([]);
    expect(result.envelope.warnings[0]?.code).toBe("VERIFY_PACK_COMMANDS_MISSING");
  });

  it("R4: types pack 应暴露默认 tsc 命令", async () => {
    const result = await executeVerifyPack("types", {
      workspace: repoRoot,
    });

    expect(result.envelope.data.pack).toBe("types");
    expect(result.envelope.data.verificationCommands).toEqual(["./node_modules/.bin/tsc --noEmit"]);
    expect(result.envelope.data.results).toHaveLength(1);
  });
});

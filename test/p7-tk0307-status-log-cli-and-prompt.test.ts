import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "msgcode-status-log-cli-"));
}

describe("tk0307: status-log cli and prompt slice", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
  });

  it("应通过 status-log add/tail 读写共享工作状况", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const refPath = path.join(workspacePath, ".msgcode", "sessions", "web.jsonl");

    await fsp.mkdir(path.dirname(refPath), { recursive: true });
    await fsp.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fsp.writeFile(refPath, "{\"id\":1}\n", "utf8");

    const { stdout: addStdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "status-log",
      "add",
      "--workspace",
      "family",
      "--thread",
      "网页线程",
      "--kind",
      "decision",
      "--summary",
      "先看今天日历 ｜ 再决定是否出门",
      "--ref-path",
      ".msgcode/sessions/web.jsonl",
      "--ref-line",
      "1",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    });

    const addPayload = JSON.parse(addStdout);
    expect(addPayload.exitCode).toBe(0);
    expect(addPayload.data.record.kind).toBe("decision");
    expect(addPayload.data.record.summary).toBe("先看今天日历 ｜ 再决定是否出门");

    const { stdout: tailStdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "status-log",
      "tail",
      "--workspace",
      "family",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    });

    const tailPayload = JSON.parse(tailStdout);
    expect(tailPayload.exitCode).toBe(0);
    expect(tailPayload.data.count).toBe(1);
    expect(tailPayload.data.entries[0].thread).toBe("网页线程");
    expect(tailPayload.data.entries[0].summary).toBe("先看今天日历 ｜ 再决定是否出门");

    const { stdout: helpStdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "help-docs",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    });

    const helpPayload = JSON.parse(helpStdout);
    const commandNames = helpPayload.data.commands.map((command: { name: string }) => command.name);
    expect(commandNames).toContain("msgcode status-log add");
    expect(commandNames).toContain("msgcode status-log tail");
  });

  it("工作区不存在时应返回真实错误", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    await fsp.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });

    await expect(execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "status-log",
      "tail",
      "--workspace",
      "missing",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    })).rejects.toMatchObject({
      code: 1,
    });
  });

  it("agents prompt 应要求先 tail，再通过 status-log add 追加共享近况", () => {
    const promptPath = path.join(process.cwd(), "prompts", "agents-prompt.md");
    const content = fs.readFileSync(promptPath, "utf8");

    expect(content).toContain("<workspace>/.msgcode/status.log");
    expect(content).toContain("msgcode status-log tail --workspace <workspace> --json");
    expect(content).toContain("msgcode status-log add --workspace <workspace>");
    expect(content).toContain("不要手写原始日志行");
  });
});

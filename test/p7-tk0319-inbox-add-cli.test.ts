import { afterEach, describe, expect, it } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "msgcode-inbox-cli-"));
}

describe("tk0319: inbox add cli", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
  });

  it("应把网页输入落成 inbox new 文件，并返回正式合同", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");

    await fsp.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fsp.mkdir(workspacePath, { recursive: true });

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "inbox",
      "add",
      "--workspace",
      "family",
      "--chat-id",
      "web:family",
      "--text",
      "帮我看一下今天下午还有哪些接娃提醒",
      "--sender-name",
      "sam",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.command).toContain("msgcode inbox add");
    expect(payload.data.chatId).toBe("web:family");
    expect(payload.data.transport).toBe("web");
    expect(payload.data.state).toBe("new");
    expect(payload.data.requestNumber).toBe("rq0001");
    expect(payload.data.filePath).toContain(".msgcode/inbox/rq0001.new.web");

    const content = await fsp.readFile(payload.data.filePath, "utf8");
    expect(content).toContain("transport: web");
    expect(content).toContain("- chat_id: web:family");
    expect(content).toContain("- sender_name: sam");
    expect(content).toContain("帮我看一下今天下午还有哪些接娃提醒");

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
    expect(commandNames).toContain("msgcode inbox add");
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
      "inbox",
      "add",
      "--workspace",
      "missing",
      "--chat-id",
      "web:missing",
      "--text",
      "hello",
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
});

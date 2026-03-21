import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-general-"));
}

describe("appliance general contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应输出通用设置读面，并复用现有日志与启动事实", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "general",
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

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.command).toContain("msgcode appliance general");
    expect(payload.data.workspacePath).toBe(workspacePath);
    expect(payload.data.workspaceRoot).toBe(workspaceRoot);
    expect(payload.data.log.dir).toBe(path.join(homeRoot, ".config", "msgcode", "log"));
    expect(payload.data.log.filePath).toBe(path.join(homeRoot, ".config", "msgcode", "log", "msgcode.log"));
    expect(typeof payload.data.startup.mode).toBe("string");
    expect(typeof payload.data.startup.supported).toBe("boolean");
    expect(typeof payload.data.startup.status).toBe("string");
    expect(typeof payload.data.startup.installed).toBe("boolean");
  });

  it("缺少 WORKSPACE_ROOT 时应返回 warning，但不发明默认值", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspacePath = path.join(root, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "general",
      "--workspace",
      workspacePath,
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: "",
      },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.status).toBe("warning");
    expect(payload.data.workspaceRoot).toBe("");
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_GENERAL_ROOT_MISSING")).toBe(true);
  });
});

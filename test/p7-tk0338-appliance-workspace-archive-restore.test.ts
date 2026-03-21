import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-workspace-archive-"));
}

describe("appliance workspace archive and restore", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应把工作区移动到 .archive 下", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(path.join(workspacePath, ".msgcode", "config.json"), "{}", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "archive-workspace",
      "--workspace",
      "family",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: { ...process.env, HOME: homeRoot, WORKSPACE_ROOT: workspaceRoot },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.status).toBe("pass");
    expect(payload.data.action).toBe("archive");
    expect(payload.data.workspacePath).toBe(workspacePath);
    expect(payload.data.archivedPath).toBe(path.join(workspaceRoot, ".archive", "family"));
    expect(await fs.stat(payload.data.archivedPath)).toBeTruthy();
    await expect(fs.stat(workspacePath)).rejects.toThrow();
  });

  it("应把归档工作区恢复回活跃根目录", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const archivedWorkspacePath = path.join(workspaceRoot, ".archive", "family");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(archivedWorkspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(path.join(archivedWorkspacePath, ".msgcode", "config.json"), "{}", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "restore-workspace",
      "--workspace",
      "family",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: { ...process.env, HOME: homeRoot, WORKSPACE_ROOT: workspaceRoot },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.status).toBe("pass");
    expect(payload.data.action).toBe("restore");
    expect(payload.data.workspacePath).toBe(path.join(workspaceRoot, "family"));
    expect(await fs.stat(payload.data.workspacePath)).toBeTruthy();
    await expect(fs.stat(archivedWorkspacePath)).rejects.toThrow();
  });

  it("同名冲突时应直接报错，不做隐式重命名", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const archivedWorkspacePath = path.join(workspaceRoot, ".archive", "family");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.mkdir(path.join(archivedWorkspacePath, ".msgcode"), { recursive: true });

    let payload: any = null;
    try {
      await execFileAsync("node", [
        "--import",
        "tsx",
        "src/cli.ts",
        "appliance",
        "archive-workspace",
        "--workspace",
        "family",
        "--json",
      ], {
        cwd: "/Users/admin/GitProjects/msgcode",
        env: { ...process.env, HOME: homeRoot, WORKSPACE_ROOT: workspaceRoot },
      });
    } catch (error: any) {
      payload = JSON.parse(error.stdout || error.stderr);
    }

    expect(payload).toBeTruthy();
    expect(payload.exitCode).toBe(1);
    expect(payload.status).toBe("error");
    expect(payload.errors.some((error: { code?: string }) => error.code === "WORKSPACE_ARCHIVE_CONFLICT")).toBe(true);
    expect(await fs.stat(workspacePath)).toBeTruthy();
    expect(await fs.stat(archivedWorkspacePath)).toBeTruthy();
  });
});

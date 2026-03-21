import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-thread-archive-"));
}

async function writeThreadFile(threadsDir: string, fileName: string, threadId: string, chatId: string): Promise<void> {
  await fs.writeFile(
    path.join(threadsDir, fileName),
    [
      "---",
      `threadId: ${threadId}`,
      `chatId: ${chatId}`,
      "---",
      "",
      "## Turn 1 - 2026-03-19T02:10:00.000Z",
      "",
      "### User",
      "你好",
      "",
      "### Assistant",
      "收到",
      "",
    ].join("\n"),
    "utf8"
  );
}

describe("appliance thread archive and restore", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应把活跃线程移动到 archived-threads", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const threadsDir = path.join(workspacePath, ".msgcode", "threads");
    const archivedThreadsDir = path.join(workspacePath, ".msgcode", "archived-threads");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(threadsDir, { recursive: true });
    await writeThreadFile(threadsDir, "2026-03-19_你好.md", "thread-1", "feishu:oc_family");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "archive-thread",
      "--workspace",
      "family",
      "--thread-id",
      "thread-1",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: { ...process.env, HOME: homeRoot, WORKSPACE_ROOT: workspaceRoot },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.status).toBe("pass");
    expect(payload.data.action).toBe("archive");
    expect(payload.data.threadId).toBe("thread-1");
    expect(payload.data.targetPath).toBe(path.join(archivedThreadsDir, "2026-03-19_你好.md"));
    expect(await fs.stat(payload.data.targetPath)).toBeTruthy();
    await expect(fs.stat(path.join(threadsDir, "2026-03-19_你好.md"))).rejects.toThrow();
  });

  it("应把 archived-threads 中的线程恢复到活跃列表", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const archivedThreadsDir = path.join(workspacePath, ".msgcode", "archived-threads");
    const threadsDir = path.join(workspacePath, ".msgcode", "threads");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(archivedThreadsDir, { recursive: true });
    await writeThreadFile(archivedThreadsDir, "2026-03-19_你好.md", "thread-1", "feishu:oc_family");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "restore-thread",
      "--workspace",
      "family",
      "--thread-id",
      "thread-1",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: { ...process.env, HOME: homeRoot, WORKSPACE_ROOT: workspaceRoot },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.status).toBe("pass");
    expect(payload.data.action).toBe("restore");
    expect(payload.data.targetPath).toBe(path.join(threadsDir, "2026-03-19_你好.md"));
    expect(await fs.stat(payload.data.targetPath)).toBeTruthy();
    await expect(fs.stat(path.join(archivedThreadsDir, "2026-03-19_你好.md"))).rejects.toThrow();
  });

  it("不存在的 threadId 应直接报错", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const threadsDir = path.join(workspacePath, ".msgcode", "threads");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(threadsDir, { recursive: true });

    let payload: any = null;
    try {
      await execFileAsync("node", [
        "--import",
        "tsx",
        "src/cli.ts",
        "appliance",
        "archive-thread",
        "--workspace",
        "family",
        "--thread-id",
        "missing-thread",
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
    expect(payload.errors.some((entry: { code?: string }) => entry.code === "WORKSPACE_THREAD_ARCHIVE_FAILED")).toBe(true);
  });
});

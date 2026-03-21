import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-archive-"));
}

describe("appliance archive contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应输出归档工作区与归档线程主视图", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const archiveRoot = path.join(workspaceRoot, ".archive");
    const archivedThreadsDir = path.join(workspacePath, ".msgcode", "archived-threads");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(archiveRoot, "smoke"), { recursive: true });
    await fs.mkdir(path.join(archiveRoot, "test-r9-smoke"), { recursive: true });
    await fs.mkdir(archivedThreadsDir, { recursive: true });

    await fs.writeFile(
      path.join(archivedThreadsDir, "2026-03-19_今天为什么没有提醒我.md"),
      [
        "---",
        "threadId: thread-reminder",
        "chatId: feishu:oc_family",
        "title: 今天为什么没有提醒我",
        "transport: feishu",
        "---",
        "",
        "## Turn 1 - 2026-03-19T02:10:00.000Z",
        "",
        "### User",
        "今天为什么没有提醒我",
        "",
        "### Assistant",
        "我去查一下。",
        "",
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(archivedThreadsDir, "2026-03-18_旧网页线程.md"),
      [
        "---",
        "threadId: thread-web-old",
        "chatId: web:family-main-2",
        "---",
        "",
        "## Turn 1 - 2026-03-18T01:00:00.000Z",
        "",
        "### User",
        "旧网页线程",
        "",
        "### Assistant",
        "收到。",
        "",
      ].join("\n"),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "archive",
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
    expect(payload.status).toBe("pass");
    expect(payload.data.workspacePath).toBe(workspacePath);
    expect(payload.data.workspaceArchiveRoot).toBe(archiveRoot);
    expect(payload.data.archivedThreadsPath).toBe(archivedThreadsDir);
    expect(payload.data.archivedWorkspaces.map((entry: { name: string }) => entry.name).sort()).toEqual(["smoke", "test-r9-smoke"]);
    expect(payload.data.archivedThreads).toHaveLength(2);
    expect(payload.data.archivedThreads[0].threadId).toBe("thread-reminder");
    expect(payload.data.archivedThreads[0].title).toBe("今天为什么没有提醒我");
    expect(payload.data.archivedThreads[0].source).toBe("feishu");
    expect(payload.data.archivedThreads[1].source).toBe("web");
  });

  it("缺少 archive 目录时应降级为空，而不是报错", async () => {
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
      "archive",
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
    expect(payload.status).toBe("pass");
    expect(payload.data.workspacePath).toBe(workspacePath);
    expect(payload.data.archivedWorkspaces).toEqual([]);
    expect(payload.data.archivedThreads).toEqual([]);
  });

  it("archive 根目录坏项与坏线程文件应给 warning，但仍返回可读数据", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const archiveRoot = path.join(workspaceRoot, ".archive");
    const archivedThreadsDir = path.join(workspacePath, ".msgcode", "archived-threads");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(archiveRoot, "smoke"), { recursive: true });
    await fs.mkdir(archivedThreadsDir, { recursive: true });
    await fs.writeFile(path.join(archiveRoot, "README.txt"), "bad", "utf8");
    await fs.writeFile(path.join(archivedThreadsDir, "broken.md"), "# bad archived thread", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "archive",
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
    expect(payload.status).toBe("warning");
    expect(payload.data.archivedWorkspaces.map((entry: { name: string }) => entry.name)).toEqual(["smoke"]);
    expect(payload.data.archivedThreads).toEqual([]);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_ARCHIVE_ROOT_INVALID_ENTRY")).toBe(true);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_ARCHIVED_THREAD_INVALID_FILE")).toBe(true);
  });
});

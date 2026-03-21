import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-workspace-tree-"));
}

describe("appliance workspace-tree contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应输出活跃工作区与线程树，并忽略 .archive", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const familyPath = path.join(workspaceRoot, "family");
    const defaultPath = path.join(workspaceRoot, "default");
    const archivePath = path.join(workspaceRoot, ".archive", "smoke");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(familyPath, ".msgcode", "threads"), { recursive: true });
    await fs.mkdir(path.join(defaultPath, ".msgcode"), { recursive: true });
    await fs.mkdir(archivePath, { recursive: true });

    await fs.writeFile(
      path.join(familyPath, ".msgcode", "threads", "2026-03-20_我在门口准备好了.md"),
      [
        "---",
        "threadId: thread-feishu",
        "chatId: feishu:oc_family",
        "title: 接娃主线",
        "transport: feishu",
        "---",
        "",
        "## Turn 1 - 2026-03-20T05:41:18.204Z",
        "",
        "### User",
        "我在门口准备好了",
        "",
        "### Assistant",
        "好的，去接小孩路上注意安全。",
        "",
      ].join("\n"),
      "utf8",
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "workspace-tree",
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
    expect(payload.data.workspaceRoot).toBe(workspaceRoot);
    expect(payload.data.workspaceArchiveRoot).toBe(path.join(workspaceRoot, ".archive"));
    expect(payload.data.workspaces.map((item: { name: string }) => item.name)).toEqual(["default", "family"]);
    expect(payload.data.workspaces[0].threads).toEqual([]);
    expect(payload.data.workspaces[1].threads).toHaveLength(1);
    expect(payload.data.workspaces[1].threads[0]).toMatchObject({
      threadId: "thread-feishu",
      title: "接娃主线",
      source: "feishu",
    });
  });

  it("坏线程文件应给 warning，但仍返回可读工作区", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const familyPath = path.join(workspaceRoot, "family");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(familyPath, ".msgcode", "threads"), { recursive: true });
    await fs.writeFile(path.join(familyPath, ".msgcode", "threads", "broken.md"), "# broken\n", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "workspace-tree",
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
    expect(payload.data.workspaces).toHaveLength(1);
    expect(payload.data.workspaces[0].name).toBe("family");
    expect(payload.data.workspaces[0].threads).toEqual([]);
    expect(payload.warnings[0].code).toBe("APPLIANCE_THREAD_INVALID_FILE");
  });

  it("工作区根目录不存在时应返回正式错误", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "missing-workspaces");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });

    await expect(execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "workspace-tree",
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

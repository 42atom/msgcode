import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendWorkspaceStatus } from "../src/runtime/status-log.js";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-threads-"));
}

describe("appliance threads contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应从 threads markdown、status.log 和 schedules 输出主界面线程数据", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const msgcodeDir = path.join(workspacePath, ".msgcode");
    const threadsDir = path.join(msgcodeDir, "threads");
    const schedulesDir = path.join(msgcodeDir, "schedules");
    const sessionsDir = path.join(msgcodeDir, "sessions");
    const identityDir = path.join(msgcodeDir, "character-identity");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(threadsDir, { recursive: true });
    await fs.mkdir(schedulesDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.mkdir(identityDir, { recursive: true });

    await fs.writeFile(
      path.join(msgcodeDir, "config.json"),
      JSON.stringify({
        "runtime.current_transport": "feishu",
        "runtime.current_chat_guid": "feishu:oc_family",
      }, null, 2),
      "utf8"
    );

    await fs.writeFile(
      path.join(threadsDir, "2026-03-20_我在门口准备好了.md"),
      [
        "---",
        "threadId: thread-feishu",
        "chatId: feishu:oc_family",
        "workspace: family",
        `workspacePath: ${workspacePath}`,
        "createdAt: 2026-03-20T05:41:18.203Z",
        "runtimeKind: agent",
        "agentProvider: minimax",
        "tmuxClient: none",
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
      "utf8"
    );

    await fs.writeFile(
      path.join(threadsDir, "2026-03-19_今天为什么没有提醒我.md"),
      [
        "---",
        "threadId: thread-web",
        "chatId: web:family-main",
        "workspace: family",
        `workspacePath: ${workspacePath}`,
        "createdAt: 2026-03-19T02:10:00.000Z",
        "runtimeKind: agent",
        "agentProvider: minimax",
        "tmuxClient: none",
        "---",
        "",
        "## Turn 1 - 2026-03-19T02:10:00.000Z",
        "",
        "### User",
        "今天为什么没有提醒我",
        "",
        "### Assistant",
        "我去查一下今天的定时任务情况。",
        "",
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(schedulesDir, "pickup-kid.json"),
      JSON.stringify({
        version: 1,
        enabled: true,
        tz: "Asia/Shanghai",
        cron: "0 16 * * 1-5",
        message: "通知用户去学校接娃",
      }, null, 2),
      "utf8"
    );

    await fs.writeFile(
      path.join(identityDir, "feishu-oc_family.csv"),
      [
        "channel,chat_id,sender_id,alias,role,notes,first_seen_at,last_seen_at",
        "feishu,feishu:oc_family,ou_sam,sam,主用户,默认主要服务对象,2026-03-21T10:00:00Z,2026-03-21T11:00:00Z",
        "feishu,feishu:oc_family,ou_mom,妈妈,家人,负责接娃,2026-03-21T10:10:00Z,2026-03-21T11:10:00Z",
      ].join("\n"),
      "utf8"
    );

    const refPath = path.join(sessionsDir, "feishu.jsonl");
    await fs.writeFile(refPath, "{\"id\":1}\n", "utf8");
    appendWorkspaceStatus({
      workspacePath,
      thread: "飞书线程",
      kind: "decision",
      summary: "先出门接娃",
      refPath,
      refLine: 1,
      timestamp: "2026-03-21T08:00:00.000Z",
    });

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "threads",
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
    expect(payload.data.currentThreadId).toBe("thread-feishu");
    expect(payload.data.threads).toHaveLength(2);
    expect(payload.data.threads[0].threadId).toBe("thread-feishu");
    expect(payload.data.threads[0].source).toBe("feishu");
    expect(payload.data.currentThread.threadId).toBe("thread-feishu");
    expect(payload.data.currentThread.messages[0].user).toContain("我在门口准备好了");
    expect(payload.data.people.count).toBe(2);
    expect(payload.data.workStatus.updatedAt).toBe("2026-03-21T08:00:00.000Z");
    expect(payload.data.workStatus.currentThreadEntries[0].summary).toBe("先出门接娃");
    expect(payload.data.workStatus.recentEntries[0].summary).toBe("先出门接娃");
    expect(payload.data.schedules[0].id).toBe("pickup-kid");
    expect(payload.data.schedules[0].message).toBe("通知用户去学校接娃");
  });

  it("缺少线程与 schedule 文件时应降级为空，而不是报错", async () => {
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
      "threads",
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
    expect(payload.data.currentThreadId).toBe("");
    expect(payload.data.threads).toEqual([]);
    expect(payload.data.currentThread).toBeNull();
    expect(payload.data.people.count).toBe(0);
    expect(payload.data.workStatus.currentThreadEntries).toEqual([]);
    expect(payload.data.workStatus.recentEntries).toEqual([]);
    expect(payload.data.schedules).toEqual([]);
  });

  it("坏 config、坏线程文件和坏 schedule 应给 warning，但仍返回可读数据", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const threadsDir = path.join(workspacePath, ".msgcode", "threads");
    const schedulesDir = path.join(workspacePath, ".msgcode", "schedules");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(threadsDir, { recursive: true });
    await fs.mkdir(schedulesDir, { recursive: true });

    await fs.writeFile(path.join(workspacePath, ".msgcode", "config.json"), "{bad-json", "utf8");
    await fs.writeFile(path.join(threadsDir, "broken.md"), "# bad thread", "utf8");
    await fs.writeFile(path.join(schedulesDir, "broken.json"), "{bad-json", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "threads",
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
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "APPLIANCE_THREAD_CONFIG_INVALID")).toBe(true);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "APPLIANCE_THREAD_INVALID_FILE")).toBe(true);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "APPLIANCE_SCHEDULE_INVALID_JSON")).toBe(true);
  });

  it("配置里只有 current_chat_id 时也应能命中当前线程", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const threadsDir = path.join(workspacePath, ".msgcode", "threads");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(threadsDir, { recursive: true });

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "runtime.current_transport": "feishu",
        "runtime.current_chat_id": "oc_family",
      }, null, 2),
      "utf8"
    );

    await fs.writeFile(
      path.join(threadsDir, "2026-03-20_我在门口准备好了.md"),
      [
        "---",
        "threadId: thread-feishu",
        "chatId: feishu:oc_family",
        "workspace: family",
        `workspacePath: ${workspacePath}`,
        "createdAt: 2026-03-20T05:41:18.203Z",
        "runtimeKind: agent",
        "agentProvider: minimax",
        "tmuxClient: none",
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
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "threads",
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
    expect(payload.data.currentThreadId).toBe("thread-feishu");
  });

  it("配置里有 stale current chat 时不应偷退到最近线程", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const threadsDir = path.join(workspacePath, ".msgcode", "threads");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(threadsDir, { recursive: true });

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "runtime.current_transport": "feishu",
        "runtime.current_chat_guid": "feishu:missing-thread",
      }, null, 2),
      "utf8"
    );

    await fs.writeFile(
      path.join(threadsDir, "2026-03-20_我在门口准备好了.md"),
      [
        "---",
        "threadId: thread-feishu",
        "chatId: feishu:oc_family",
        "workspace: family",
        `workspacePath: ${workspacePath}`,
        "createdAt: 2026-03-20T05:41:18.203Z",
        "runtimeKind: agent",
        "agentProvider: minimax",
        "tmuxClient: none",
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
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "threads",
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
    expect(payload.data.currentThreadId).toBe("");
    expect(payload.data.currentThread).toBeNull();
    expect(payload.data.threads).toHaveLength(1);
  });

  it("合法但缺 cron/message 的 schedule 应 warning 并跳过", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const schedulesDir = path.join(workspacePath, ".msgcode", "schedules");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(schedulesDir, { recursive: true });

    await fs.writeFile(
      path.join(schedulesDir, "broken.json"),
      JSON.stringify({
        version: 1,
        enabled: true,
        tz: "Asia/Shanghai",
      }, null, 2),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "threads",
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
    expect(payload.status).toBe("warning");
    expect(payload.data.schedules).toEqual([]);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "APPLIANCE_SCHEDULE_INCOMPLETE")).toBe(true);
  });
});

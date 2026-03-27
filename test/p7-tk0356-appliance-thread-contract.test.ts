import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendWorkspaceStatus } from "../src/runtime/status-log.js";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-thread-"));
}

describe("appliance thread contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应按 threadId 输出单条线程正文与右栏所需数据", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const msgcodeDir = path.join(workspacePath, ".msgcode");
    const threadsDir = path.join(msgcodeDir, "threads");
    const schedulesDir = path.join(msgcodeDir, "schedules");
    const identityDir = path.join(msgcodeDir, "character-identity");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(threadsDir, { recursive: true });
    await fs.mkdir(schedulesDir, { recursive: true });
    await fs.mkdir(identityDir, { recursive: true });

    await fs.writeFile(
      path.join(msgcodeDir, "config.json"),
      JSON.stringify({
        "runtime.current_chat_guid": "feishu:oc_family",
      }, null, 2),
      "utf8"
    );

    await fs.writeFile(
      path.join(threadsDir, "2026-03-20_feishu-main.md"),
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
      "utf8"
    );

    await fs.writeFile(
      path.join(threadsDir, "2026-03-19_web-main.md"),
      [
        "---",
        "threadId: thread-web",
        "chatId: web:family-main",
        "title: 家庭网页线程",
        "transport: web",
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

    const refPath = path.join(msgcodeDir, "sessions", "web.jsonl");
    await fs.mkdir(path.dirname(refPath), { recursive: true });
    await fs.writeFile(refPath, "{\"id\":1}\n", "utf8");
    appendWorkspaceStatus({
      workspacePath,
      thread: "家庭网页线程",
      kind: "state",
      summary: "等待用户确认提醒规则",
      refPath,
      refLine: 1,
      timestamp: "2026-03-21T08:00:00.000Z",
    });

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "thread",
      "--workspace",
      "family",
      "--thread-id",
      "thread-web",
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
    expect(payload.data.threadId).toBe("thread-web");
    expect(payload.data.thread.threadId).toBe("thread-web");
    expect(payload.data.thread.title).toBe("家庭网页线程");
    expect(payload.data.thread.writable).toBe(true);
    expect(payload.data.thread.messages[0].user).toContain("今天为什么没有提醒我");
    expect(payload.data.people.count).toBe(2);
    expect(payload.data.workStatus.updatedAt).toBe("2026-03-21T08:00:00.000Z");
    expect(payload.data.workStatus.currentThreadEntries[0].summary).toBe("等待用户确认提醒规则");
    expect(payload.data.schedules[0].message).toBe("通知用户去学校接娃");
  });

  it("缺少目标线程时应报错，但其他侧栏数据仍可返回", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const msgcodeDir = path.join(workspacePath, ".msgcode");
    const schedulesDir = path.join(msgcodeDir, "schedules");
    const identityDir = path.join(msgcodeDir, "character-identity");

    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(schedulesDir, { recursive: true });
    await fs.mkdir(identityDir, { recursive: true });

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
      ].join("\n"),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "thread",
      "--workspace",
      "family",
      "--thread-id",
      "missing-thread",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    }).catch((error) => ({
      stdout: error.stdout,
    }));
    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(1);
    expect(payload.status).toBe("error");
    expect(payload.errors.some((entry: { code?: string }) => entry.code === "APPLIANCE_THREAD_MISSING")).toBe(true);
    expect(payload.data.thread).toBeNull();
    expect(payload.data.people.count).toBe(1);
    expect(payload.data.schedules[0].id).toBe("pickup-kid");
  });
});

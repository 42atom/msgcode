import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-people-"));
}

describe("appliance people contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应从 character-identity csv 与 people-pending.json 输出人物数据", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const identityDir = path.join(workspacePath, ".msgcode", "character-identity");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(identityDir, { recursive: true });

    await fs.writeFile(
      path.join(identityDir, "feishu-oc_family.csv"),
      [
        "channel,chat_id,sender_id,alias,role,notes,first_seen_at,last_seen_at",
        "feishu,feishu:oc_family,ou_sam,sam,主用户,默认主要服务对象,2026-03-21T10:00:00Z,2026-03-21T11:00:00Z",
        "feishu,feishu:oc_family,ou_mom,妈妈,家人,负责接娃,2026-03-21T10:10:00Z,2026-03-21T11:10:00Z",
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "people-pending.json"),
      JSON.stringify({
        pending: [
          {
            channel: "feishu",
            channelId: "ou_grandpa",
            username: "grandpa",
            displayName: "爷爷",
            seenAt: "2026-03-21T12:00:00Z",
          },
        ],
      }, null, 2),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "people",
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
    expect(payload.data.workspacePath).toBe(workspacePath);
    expect(payload.data.counts.people).toBe(2);
    expect(payload.data.counts.pending).toBe(1);
    expect(payload.data.people[0].alias).toBe("sam");
    expect(payload.data.people[0].role).toBe("主用户");
    expect(payload.data.people[0].channel).toBe("feishu");
    expect(payload.data.people[0].senderId).toBe("ou_sam");
    expect(payload.data.pending[0].displayName).toBe("爷爷");
    expect(payload.data.pendingPath).toBe(path.join(workspacePath, ".msgcode", "people-pending.json"));
  });

  it("缺少人物文件时应返回空列表", async () => {
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
      "people",
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
    expect(payload.data.people).toEqual([]);
    expect(payload.data.pending).toEqual([]);
  });

  it("坏行和坏 pending json 应给 warning", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const identityDir = path.join(workspacePath, ".msgcode", "character-identity");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(identityDir, { recursive: true });

    await fs.writeFile(
      path.join(identityDir, "feishu-oc_family.csv"),
      [
        "channel,chat_id,sender_id,alias,role,notes,first_seen_at,last_seen_at",
        "feishu,feishu:oc_family,,妈妈,家人,负责接娃,2026-03-21T10:10:00Z,2026-03-21T11:10:00Z",
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(path.join(workspacePath, ".msgcode", "people-pending.json"), "{bad-json", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "people",
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
    expect(payload.data.people).toEqual([]);
    expect(payload.data.pending).toEqual([]);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_PEOPLE_INVALID_ROW")).toBe(true);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_PEOPLE_PENDING_INVALID_JSON")).toBe(true);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-people-save-"));
}

describe("appliance people-save contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应在缺文件时创建 character-identity csv 并写入新人物", async () => {
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
      "people-save",
      "--workspace",
      "family",
      "--channel",
      "feishu",
      "--chat-id",
      "feishu:oc_family",
      "--sender-id",
      "ou_sam",
      "--alias",
      "sam",
      "--notes",
      "默认主要服务对象",
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
    expect(payload.data.created).toBe(true);
    expect(payload.data.person.alias).toBe("sam");
    expect(payload.data.person.notes).toBe("默认主要服务对象");
    expect(payload.data.changedFiles[0]).toBe(path.join(workspacePath, ".msgcode", "character-identity", "feishu-oc_family.csv"));

    const csv = await fs.readFile(payload.data.changedFiles[0], "utf8");
    expect(csv).toContain("channel,chat_id,sender_id,alias,role,notes,first_seen_at,last_seen_at");
    expect(csv).toContain("feishu,feishu:oc_family,ou_sam,sam,,默认主要服务对象,");
  });

  it("应按唯一键更新现有人物并保留 first_seen_at 与 role", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const identityDir = path.join(workspacePath, ".msgcode", "character-identity");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(identityDir, { recursive: true });

    const csvPath = path.join(identityDir, "feishu-oc_family.csv");
    await fs.writeFile(
      csvPath,
      [
        "channel,chat_id,sender_id,alias,role,notes,first_seen_at,last_seen_at",
        "feishu,feishu:oc_family,ou_sam,老哥,owner,旧备注,2026-03-10T14:19:49Z,2026-03-10T14:28:56Z",
      ].join("\n"),
      "utf8",
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "people-save",
      "--workspace",
      "family",
      "--channel",
      "feishu",
      "--chat-id",
      "feishu:oc_family",
      "--sender-id",
      "ou_sam",
      "--alias",
      "sam",
      "--notes",
      "新备注",
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
    expect(payload.data.created).toBe(false);
    expect(payload.data.person.alias).toBe("sam");
    expect(payload.data.person.role).toBe("owner");
    expect(payload.data.person.notes).toBe("新备注");
    expect(payload.data.person.firstSeenAt).toBe("2026-03-10T14:19:49Z");
    expect(payload.data.person.lastSeenAt).not.toBe("2026-03-10T14:28:56Z");

    const csv = await fs.readFile(csvPath, "utf8");
    expect(csv).toContain("feishu,feishu:oc_family,ou_sam,sam,owner,新备注,2026-03-10T14:19:49Z,");
  });

  it("notes 带换行或回车时应收成单行，避免写烂 csv", async () => {
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
      "people-save",
      "--workspace",
      "family",
      "--channel",
      "feishu",
      "--chat-id",
      "feishu:oc_family",
      "--sender-id",
      "ou_sam",
      "--alias",
      "sam",
      "--notes",
      "默认主要服务对象\r\n负责接娃",
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
    expect(payload.data.person.notes).toBe("默认主要服务对象 负责接娃");

    const csvPath = path.join(workspacePath, ".msgcode", "character-identity", "feishu-oc_family.csv");
    const csv = await fs.readFile(csvPath, "utf8");
    expect(csv).toContain("默认主要服务对象 负责接娃");
    expect(csv).not.toContain("默认主要服务对象\r\n负责接娃");
    expect(csv).not.toContain("\r");
  });
});

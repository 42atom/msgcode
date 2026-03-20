import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-neighbor-"));
}

describe("appliance neighbor contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应从 neighbor 文件输出节点列表、未读数和邮箱记录", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const neighborDir = path.join(workspacePath, ".msgcode", "neighbor");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(neighborDir, { recursive: true });

    await fs.writeFile(
      path.join(neighborDir, "config.json"),
      JSON.stringify({
        enabled: true,
        nodeId: "family-mini",
        publicIdentity: "sam@family",
      }, null, 2),
      "utf8"
    );

    await fs.writeFile(
      path.join(neighborDir, "neighbors.json"),
      JSON.stringify({
        neighbors: [
          {
            nodeId: "ops-room-mini",
            displayName: "运营同事节点",
            state: "contact",
            lastProbeAt: "2026-03-21T09:46:00.000Z",
            lastProbeOk: true,
            latencyMs: 132,
          },
          {
            nodeId: "finance-mini",
            displayName: "财务摘要节点",
            state: "known",
            lastMessageAt: "2026-03-20T21:12:00.000Z",
            lastProbeAt: "2026-03-21T09:30:00.000Z",
            lastProbeOk: false,
          },
        ],
      }, null, 2),
      "utf8"
    );

    await fs.writeFile(
      path.join(neighborDir, "mailbox.jsonl"),
      [
        JSON.stringify({
          at: "2026-03-21T09:46:00.000Z",
          nodeId: "ops-room-mini",
          direction: "in",
          type: "delivery",
          summary: "已回传一份摘要和截图",
          unread: true,
        }),
        JSON.stringify({
          at: "2026-03-20T21:12:00.000Z",
          nodeId: "finance-mini",
          direction: "in",
          type: "message",
          summary: "税务口径仍需人工复核",
          unread: false,
        }),
      ].join("\n"),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "neighbor",
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
    expect(payload.data.enabled).toBe(true);
    expect(payload.data.self.nodeId).toBe("family-mini");
    expect(payload.data.self.publicIdentity).toBe("sam@family");
    expect(payload.data.mailbox.updatedAt).toBe("2026-03-21T09:46:00.000Z");
    expect(payload.data.neighbors[0].nodeId).toBe("ops-room-mini");
    expect(payload.data.neighbors[0].unreadCount).toBe(1);
    expect(payload.data.neighbors[0].latencyMs).toBe(132);
    expect(payload.data.neighbors[1].unreadCount).toBe(0);
    expect(payload.data.mailbox.entries[0].summary).toBe("已回传一份摘要和截图");
    expect(payload.data.summary.lastMessageAt).toBe("2026-03-21T09:46:00.000Z");
    expect(payload.data.summary.lastProbeAt).toBe("2026-03-21T09:46:00.000Z");
    expect(payload.data.summary.reachableCount).toBe(1);
  });

  it("缺少 neighbor 文件时应返回空态", async () => {
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
      "neighbor",
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
    expect(payload.data.enabled).toBe(false);
    expect(payload.data.neighbors).toEqual([]);
    expect(payload.data.mailbox.entries).toEqual([]);
    expect(payload.data.summary.unreadCount).toBe(0);
    expect(payload.data.summary.reachableCount).toBe(0);
  });

  it("坏 config、坏 neighbors 和坏 mailbox 行应给 warning", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const neighborDir = path.join(workspacePath, ".msgcode", "neighbor");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(neighborDir, { recursive: true });

    await fs.writeFile(path.join(neighborDir, "config.json"), "{bad-json", "utf8");
    await fs.writeFile(
      path.join(neighborDir, "neighbors.json"),
      JSON.stringify({
        neighbors: [
          {
            nodeId: "ops-room-mini",
            state: "bad-state",
          },
        ],
      }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(neighborDir, "mailbox.jsonl"),
      [
        "{bad-json",
        JSON.stringify({
          at: "2026-03-21T09:46:00.000Z",
          nodeId: "ops-room-mini",
          direction: "in",
          type: "message",
        }),
      ].join("\n"),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "neighbor",
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
    expect(payload.data.neighbors).toEqual([]);
    expect(payload.data.mailbox.entries).toEqual([]);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_NEIGHBOR_CONFIG_INVALID_JSON")).toBe(true);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_NEIGHBOR_INCOMPLETE")).toBe(true);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_NEIGHBOR_MAILBOX_INVALID_JSONL")).toBe(true);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_NEIGHBOR_MAILBOX_INCOMPLETE")).toBe(true);
  });

  it("neighbors 顶层 schema 漂移时应给 warning，而不是静默空态", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const neighborDir = path.join(workspacePath, ".msgcode", "neighbor");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(neighborDir, { recursive: true });

    await fs.writeFile(
      path.join(neighborDir, "neighbors.json"),
      JSON.stringify({
        items: [
          {
            nodeId: "ops-room-mini",
            state: "contact",
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
      "neighbor",
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
    expect(payload.data.neighbors).toEqual([]);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_NEIGHBOR_LIST_INVALID_SCHEMA")).toBe(true);
  });
});

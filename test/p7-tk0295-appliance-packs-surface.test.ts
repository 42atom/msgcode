import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-packs-"));
}

describe("appliance hall packs surface", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应从 packs.json 输出默认内置和用户安装分组", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "ORG.md"),
      ["# 机构信息", "", "- 名称：Family", "- 交税地：Singapore", "- 统一社会信用代码：NA", ""].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "packs.json"),
      JSON.stringify({
        builtin: [
          {
            id: "core-calendar",
            name: "日历提醒",
            version: "0.1.0",
            enabled: true,
          },
        ],
        user: [
          {
            id: "company-finance",
            name: "公司财务包",
            version: "0.1.0",
            enabled: true,
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
      "hall",
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
    expect(payload.data.packs.builtin).toHaveLength(1);
    expect(payload.data.packs.user).toHaveLength(1);
    expect(payload.data.packs.builtin[0].id).toBe("core-calendar");
    expect(payload.data.packs.user[0].name).toBe("公司财务包");
  });

  it("缺少 packs.json 时应返回空分组而不是报错", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "ORG.md"),
      ["# 机构信息", "", "- 名称：Family", "- 交税地：Singapore", "- 统一社会信用代码：NA", ""].join("\n"),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "hall",
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
    expect(payload.data.packs.builtin).toEqual([]);
    expect(payload.data.packs.user).toEqual([]);
  });

  it("坏 packs.json 或缺字段项应给 warning 并跳过", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "ORG.md"),
      ["# 机构信息", "", "- 名称：Family", "- 交税地：Singapore", "- 统一社会信用代码：NA", ""].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "packs.json"),
      JSON.stringify({
        user: [
          {
            id: "broken-pack",
            name: "坏包",
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
      "hall",
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
    expect(payload.data.packs.user).toEqual([]);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_PACKS_INCOMPLETE")).toBe(true);
  });

  it("顶层 schema 漂移时应 warning，而不是静默空列表", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "ORG.md"),
      ["# 机构信息", "", "- 名称：Family", "- 交税地：Singapore", "- 统一社会信用代码：NA", ""].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "packs.json"),
      JSON.stringify({
        packs: [
          {
            id: "legacy-pack",
            name: "旧包",
            version: "0.1.0",
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
      "hall",
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
    expect(payload.data.packs.builtin).toEqual([]);
    expect(payload.data.packs.user).toEqual([]);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_PACKS_INVALID_SCHEMA")).toBe(true);
  });
});

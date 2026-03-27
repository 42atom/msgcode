import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-profile-"));
}

describe("appliance profile contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应输出我的资料读面，并优先读位置城市", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "profile.name": "sam",
      }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "SOUL.md"),
      "# SOUL\n\n- 风格：简洁、直接、可执行\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "ORG.md"),
      [
        "# 机构信息",
        "",
        "- 名称：Family Workspace",
        "- 位置城市：Singapore",
        "",
      ].join("\n"),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "profile",
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
    expect(payload.data.profile.name).toBe("sam");
    expect(payload.data.memory.enabled).toBe(true);
    expect(payload.data.memory.topK).toBe(5);
    expect(payload.data.soul.exists).toBe(true);
    expect(payload.data.soul.content).toContain("简洁、直接、可执行");
    expect(payload.data.organization.name).toBe("Family Workspace");
    expect(payload.data.organization.city).toBe("Singapore");
    expect(payload.data.organization.cityField).toBe("位置城市");
  });

  it("应兼容旧 ORG 字段交税地", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({ "profile.name": "sam" }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(workspacePath, ".msgcode", "SOUL.md"), "# SOUL\n", "utf8");
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "ORG.md"),
      [
        "# 机构信息",
        "",
        "- 名称：Family Workspace",
        "- 交税地：杭州",
        "- 统一社会信用代码：NA",
        "",
      ].join("\n"),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "profile",
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
    expect(payload.data.organization.city).toBe("杭州");
    expect(payload.data.organization.cityField).toBe("交税地");
  });

  it("缺少 profile.name / SOUL / ORG 时应返回 warning 空态", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(path.join(workspacePath, ".msgcode", "config.json"), JSON.stringify({}, null, 2), "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "profile",
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
    expect(payload.data.profile.name).toBe("");
    expect(payload.data.memory.enabled).toBe(true);
    expect(payload.data.soul.exists).toBe(false);
    expect(payload.data.organization.exists).toBe(false);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_PROFILE_NAME_MISSING")).toBe(true);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_PROFILE_SOUL_MISSING")).toBe(true);
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_PROFILE_ORG_MISSING")).toBe(true);
  });
});

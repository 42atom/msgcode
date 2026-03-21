import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-settings-"));
}

describe("appliance settings contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应聚合 core settings 三段，并保留分段状态", async () => {
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
        "runtime.kind": "agent",
      }, null, 2),
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
      "settings",
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
    expect(payload.command).toContain("msgcode appliance settings");
    expect(payload.exitCode).toBe(0);
    expect(payload.status).toBe("warning");
    expect(payload.data.workspacePath).toBe(workspacePath);
    expect(payload.warnings.some((warning: { details?: { section?: string } }) => warning.details?.section === "profile")).toBe(true);

    expect(payload.data.profile.status).toBe("warning");
    expect(payload.data.profile.data.profile.name).toBe("sam");
    expect(payload.data.profile.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_PROFILE_SOUL_MISSING")).toBe(true);

    expect(payload.data.general.status).toBe("pass");
    expect(payload.data.general.data.workspaceRoot).toBe(workspaceRoot);

    expect(payload.data.capabilities.status).toBe("pass");
    expect(Array.isArray(payload.data.capabilities.data.capabilities)).toBe(true);

    expect(payload.data.doctor).toBeUndefined();
  });

  it("工作区不存在时应返回顶层 error，且三段都为 error", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "settings",
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
    }).catch((error) => error);

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(1);
    expect(payload.status).toBe("error");
    expect(payload.errors.some((item: { code?: string }) => item.code === "APPLIANCE_WORKSPACE_MISSING")).toBe(true);
    expect(payload.data.profile.status).toBe("error");
    expect(payload.data.general.status).toBe("error");
    expect(payload.data.capabilities.status).toBe("error");
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-set-profile-"));
}

describe("appliance set-profile contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应通过正式 CLI 写入我的资料三份真相源", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(path.join(workspacePath, ".msgcode", "config.json"), JSON.stringify({}, null, 2), "utf8");
    await fs.writeFile(path.join(workspacePath, ".msgcode", "ORG.md"), "# 机构信息\n\n- 名称：旧组织\n- 位置城市：旧城市\n", "utf8");
    await fs.writeFile(path.join(workspacePath, ".msgcode", "SOUL.md"), "# SOUL\n\n- 风格：旧风格\n", "utf8");
    const soulDraftPath = path.join(root, "draft-soul.md");
    await fs.writeFile(soulDraftPath, "# SOUL\n\n- 风格：简洁、直接、可执行", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "set-profile",
      "--workspace",
      "family",
      "--name",
      "sam",
      "--organization-name",
      "Family Workspace",
      "--city",
      "Singapore",
      "--soul-file",
      soulDraftPath,
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
    expect(payload.data.changedFiles).toContain(path.join(workspacePath, ".msgcode", "config.json"));
    expect(payload.data.changedFiles).toContain(path.join(workspacePath, ".msgcode", "ORG.md"));
    expect(payload.data.changedFiles).toContain(path.join(workspacePath, ".msgcode", "SOUL.md"));
    expect(payload.data.profile.profile.name).toBe("sam");
    expect(payload.data.profile.organization.name).toBe("Family Workspace");
    expect(payload.data.profile.organization.city).toBe("Singapore");
    expect(payload.data.profile.soul.content).toContain("简洁、直接、可执行");

    const config = JSON.parse(await fs.readFile(path.join(workspacePath, ".msgcode", "config.json"), "utf8"));
    const orgContent = await fs.readFile(path.join(workspacePath, ".msgcode", "ORG.md"), "utf8");
    const soulContent = await fs.readFile(path.join(workspacePath, ".msgcode", "SOUL.md"), "utf8");

    expect(config["profile.name"]).toBe("sam");
    expect(orgContent).toContain("- 名称：Family Workspace");
    expect(orgContent).toContain("- 位置城市：Singapore");
    expect(soulContent).toContain("简洁、直接、可执行");
  });

  it("部分字段更新时不应顺手覆盖其他真相文件", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(path.join(workspacePath, ".msgcode", "config.json"), JSON.stringify({ "profile.name": "old" }, null, 2), "utf8");
    await fs.writeFile(path.join(workspacePath, ".msgcode", "ORG.md"), "# 机构信息\n\n- 名称：旧组织\n- 位置城市：旧城市\n", "utf8");
    await fs.writeFile(path.join(workspacePath, ".msgcode", "SOUL.md"), "# SOUL\n\n- 风格：旧风格\n", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "set-profile",
      "--workspace",
      "family",
      "--name",
      "new-name",
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
    expect(payload.data.changedFiles).toEqual([path.join(workspacePath, ".msgcode", "config.json")]);
    expect(payload.data.profile.profile.name).toBe("new-name");

    const orgContent = await fs.readFile(path.join(workspacePath, ".msgcode", "ORG.md"), "utf8");
    const soulContent = await fs.readFile(path.join(workspacePath, ".msgcode", "SOUL.md"), "utf8");
    expect(orgContent).toContain("- 名称：旧组织");
    expect(soulContent).toContain("旧风格");
  });

  it("单行字段应清掉内部换行，避免写烂 ORG.md", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(path.join(workspacePath, ".msgcode", "config.json"), JSON.stringify({}, null, 2), "utf8");
    await fs.writeFile(path.join(workspacePath, ".msgcode", "ORG.md"), "# 机构信息\n\n- 名称：旧组织\n- 位置城市：旧城市\n", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "set-profile",
      "--workspace",
      "family",
      "--organization-name",
      "ACME\nCorp",
      "--city",
      "New\nYork",
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
    expect(payload.data.profile.organization.name).toBe("ACME Corp");
    expect(payload.data.profile.organization.city).toBe("New York");

    const orgContent = await fs.readFile(path.join(workspacePath, ".msgcode", "ORG.md"), "utf8");
    expect(orgContent).toContain("- 名称：ACME Corp");
    expect(orgContent).toContain("- 位置城市：New York");
    expect(orgContent).not.toContain("ACME\nCorp");
    expect(orgContent).not.toContain("New\nYork");
  });

  it("缺字段时应把机构字段补回机构信息段，而不是文件末尾", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(path.join(workspacePath, ".msgcode", "config.json"), JSON.stringify({}, null, 2), "utf8");
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "ORG.md"),
      [
        "# 机构信息",
        "",
        "- 位置城市：旧城市",
        "",
        "## 注意事项",
        "",
        "- 这里只是备注",
      ].join("\n"),
      "utf8",
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "set-profile",
      "--workspace",
      "family",
      "--organization-name",
      "Family Workspace",
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

    const orgContent = await fs.readFile(path.join(workspacePath, ".msgcode", "ORG.md"), "utf8");
    const nameIndex = orgContent.indexOf("- 名称：Family Workspace");
    const noteIndex = orgContent.indexOf("## 注意事项");
    expect(nameIndex).toBeGreaterThan(-1);
    expect(noteIndex).toBeGreaterThan(-1);
    expect(nameIndex).toBeLessThan(noteIndex);
  });

  it("没有 mutation 参数时应返回真实错误", async () => {
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
      "set-profile",
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
    expect(payload.errors.some((item: { code?: string }) => item.code === "APPLIANCE_PROFILE_MUTATION_EMPTY")).toBe(true);
  });

  it("坏的 soul-file 路径也应返回正式 JSON 错误", async () => {
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
      "set-profile",
      "--workspace",
      "family",
      "--soul-file",
      path.join(root, "missing-soul.md"),
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
    expect(payload.errors.some((item: { code?: string }) => item.code === "APPLIANCE_PROFILE_SOUL_FILE_READ_FAILED")).toBe(true);
  });

  it("中途文件写失败时应诚实返回已落盘 changedFiles", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode", "SOUL.md"), { recursive: true });

    await fs.writeFile(path.join(workspacePath, ".msgcode", "config.json"), JSON.stringify({}, null, 2), "utf8");
    await fs.writeFile(path.join(workspacePath, ".msgcode", "ORG.md"), "# 机构信息\n\n- 名称：旧组织\n- 位置城市：旧城市\n", "utf8");
    const soulDraftPath = path.join(root, "draft-soul.md");
    await fs.writeFile(soulDraftPath, "# SOUL\n\n- 风格：简洁、直接、可执行", "utf8");

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "set-profile",
      "--workspace",
      "family",
      "--name",
      "sam",
      "--organization-name",
      "Family Workspace",
      "--city",
      "Singapore",
      "--soul-file",
      soulDraftPath,
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
    expect(payload.data.changedFiles).toContain(path.join(workspacePath, ".msgcode", "config.json"));
    expect(payload.data.changedFiles).toContain(path.join(workspacePath, ".msgcode", "ORG.md"));
    expect(payload.errors.some((item: { code?: string }) => item.code === "APPLIANCE_PROFILE_MUTATION_FAILED")).toBe(true);
    expect(payload.errors[0].details.failedFile).toBe(path.join(workspacePath, ".msgcode", "SOUL.md"));

    const config = JSON.parse(await fs.readFile(path.join(workspacePath, ".msgcode", "config.json"), "utf8"));
    const orgContent = await fs.readFile(path.join(workspacePath, ".msgcode", "ORG.md"), "utf8");
    expect(config["profile.name"]).toBe("sam");
    expect(orgContent).toContain("- 名称：Family Workspace");
  });

  it("坏 config.json 时不应静默当空对象覆盖回去", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    const configPath = path.join(workspacePath, ".msgcode", "config.json");
    await fs.writeFile(configPath, "{bad json", "utf8");
    await fs.writeFile(path.join(workspacePath, ".msgcode", "ORG.md"), "# 机构信息\n\n- 名称：旧组织\n- 位置城市：旧城市\n", "utf8");

    const result = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "set-profile",
      "--workspace",
      "family",
      "--name",
      "sam",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    }).catch((error) => error);

    const payload = JSON.parse(result.stdout);
    expect(payload.exitCode).toBe(1);
    expect(payload.status).toBe("error");
    expect(payload.errors.some((item: { code?: string; details?: { failedFile?: string } }) =>
      item.code === "APPLIANCE_PROFILE_MUTATION_FAILED" && item.details?.failedFile === configPath
    )).toBe(true);
    expect(await fs.readFile(configPath, "utf8")).toBe("{bad json");
  });
});

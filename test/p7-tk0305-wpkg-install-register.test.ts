import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-wpkg-install-"));
}

async function createWpkg(root: string, manifest: Record<string, unknown>): Promise<string> {
  const packDir = path.join(root, "pack-src");
  await fs.mkdir(path.join(packDir, "web"), { recursive: true });
  await fs.mkdir(path.join(packDir, "skills", "finance-index"), { recursive: true });
  await fs.writeFile(path.join(packDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(packDir, "web", "index.html"), "<html><body>finance</body></html>\n", "utf8");
  await fs.writeFile(path.join(packDir, "skills", "finance-index", "SKILL.md"), "# finance\n", "utf8");

  const archivePath = path.join(root, `${String(manifest.id ?? "pack")}.wpkg`);
  await execFileAsync("/usr/bin/zip", ["-qr", archivePath, "."], { cwd: packDir });
  return archivePath;
}

describe("tk0305: wpkg install register slice", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应安装 wpkg 并写入 packs.json 与 sites.json", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    const wpkgPath = await createWpkg(root, {
      id: "company-finance",
      name: "公司财务包",
      version: "0.1.0",
      author: "Acme Labs",
      commercial: true,
      licenseType: "paid",
      sites: [
        {
          id: "finance",
          title: "财税站",
          entry: "web/index.html",
          kind: "sidecar",
          description: "财税主题站",
        },
      ],
      skills: ["skills/finance-index/SKILL.md"],
      requires: ["memory"],
    });

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "install-pack",
      "--workspace",
      "family",
      "--file",
      wpkgPath,
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
    expect(payload.exitCode).toBe(0);
    expect(payload.data.pack.id).toBe("company-finance");
    expect(payload.data.counts.sites).toBe(1);
    expect(payload.data.counts.skills).toBe(1);

    const packs = JSON.parse(await fs.readFile(path.join(workspacePath, ".msgcode", "packs.json"), "utf8"));
    expect(packs.user).toHaveLength(1);
    expect(packs.user[0].id).toBe("company-finance");
    expect(packs.user[0].sourcePath).toBe(".msgcode/packs/user/company-finance");
    expect(packs.user[0].skills).toEqual([".msgcode/packs/user/company-finance/skills/finance-index/SKILL.md"]);

    const sites = JSON.parse(await fs.readFile(path.join(workspacePath, ".msgcode", "sites.json"), "utf8"));
    expect(sites.sites).toHaveLength(1);
    expect(sites.sites[0].id).toBe("finance");
    expect(sites.sites[0].entry).toBe(".msgcode/packs/user/company-finance/web/index.html");
    expect(sites.sites[0].packId).toBe("company-finance");

    const { stdout: hallStdout } = await execFileAsync("node", [
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
    const hall = JSON.parse(hallStdout);
    expect(hall.data.packs.user[0].id).toBe("company-finance");

    const { stdout: sitesStdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "sites",
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
    const sitesPayload = JSON.parse(sitesStdout);
    expect(sitesPayload.data.sites[0].id).toBe("finance");
  });

  it("重复安装同名 pack 时应报错，不得覆盖原注册表", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    const wpkgPath = await createWpkg(root, {
      id: "kitchen-recipes",
      name: "厨房菜谱",
      version: "0.1.0",
      sites: [{ id: "recipes", title: "菜谱站", entry: "web/index.html" }],
    });

    await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "install-pack",
      "--workspace",
      "family",
      "--file",
      wpkgPath,
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    });

    await expect(execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "install-pack",
      "--workspace",
      "family",
      "--file",
      wpkgPath,
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

    const packs = JSON.parse(await fs.readFile(path.join(workspacePath, ".msgcode", "packs.json"), "utf8"));
    expect(packs.user).toHaveLength(1);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-sites-"));
}

describe("appliance sites contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应从 .msgcode/sites.json 输出 sidecar 站点列表", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "acme", "ops");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "sites.json"),
      JSON.stringify({
        sites: [
          {
            id: "finance",
            title: "财税站",
            entry: "/sites/finance/index.html",
            kind: "sidecar",
            description: "财税主题站",
          },
          {
            id: "ops-board",
            title: "运营站",
            entry: "http://127.0.0.1:4312/ops",
            kind: "external",
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
      "sites",
      "--workspace",
      "acme/ops",
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
    expect(payload.data.sourcePath).toBe(path.join(workspacePath, ".msgcode", "sites.json"));
    expect(payload.data.sites).toHaveLength(2);
    expect(payload.data.sites[0].id).toBe("finance");
    expect(payload.data.sites[0].title).toBe("财税站");
    expect(payload.data.sites[1].kind).toBe("external");
  });

  it("缺少 sites.json 时应返回空列表而不是报错", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "acme", "ops");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "sites",
      "--workspace",
      "acme/ops",
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
    expect(payload.data.sites).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-hall-"));
}

describe("appliance hall contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应输出 Electron 壳可消费的门厅 JSON", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "acme", "ops");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "ORG.md"),
      [
        "# 机构信息",
        "",
        "- 名称：Acme Studio",
        "- 交税地：新加坡",
        "- 统一社会信用代码：91350211MA12345678",
        "",
      ].join("\n"),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "hall",
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
    expect(payload.command).toContain("msgcode appliance hall");
    expect(payload.exitCode).toBe(0);
    expect(payload.data.workspacePath).toBe(workspacePath);
    expect(payload.data.org.name).toBe("Acme Studio");
    expect(payload.data.org.taxRegion).toBe("新加坡");
    expect(payload.data.org.uscc).toBe("91350211MA12345678");
    expect(Array.isArray(payload.data.runtime.categories)).toBe(true);
    expect(Array.isArray(payload.data.packs.builtin)).toBe(true);
    expect(Array.isArray(payload.data.packs.user)).toBe(true);
    expect(Array.isArray(payload.data.sites)).toBe(true);
  });
});

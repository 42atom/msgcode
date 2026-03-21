import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureGlobalFirstRun, ensureWorkspaceFirstRun } from "../src/runtime/first-run-init.js";

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-first-run-"));
}

describe("first-run init", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应生成全局 first-run 骨架", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const configDir = path.join(root, ".config", "msgcode");
    const exampleEnvPath = path.join(root, ".env.example");
    await fs.writeFile(exampleEnvPath, "FEISHU_APP_ID=\n", "utf8");

    const result = await ensureGlobalFirstRun({ configDir, exampleEnvPath });

    expect(result.created).toContain(path.join(configDir, ".env"));
    expect(result.created).toContain(path.join(configDir, "souls", "default", "SOUL.md"));
    expect(result.created).toContain(path.join(configDir, "souls", "active.json"));
    expect(existsSync(path.join(configDir, "log"))).toBe(true);
  });

  it("应生成 workspace first-run 骨架", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const workspacePath = path.join(root, "acme", "ops");

    const result = await ensureWorkspaceFirstRun({ workspacePath });

    expect(result.created).toContain(path.join(workspacePath, ".msgcode", "SOUL.md"));
    expect(result.created).toContain(path.join(workspacePath, ".msgcode", "ORG.md"));
    expect(result.created).toContain(path.join(workspacePath, ".msgcode", "config.json"));
    expect(existsSync(path.join(workspacePath, "memory"))).toBe(true);
    expect(existsSync(path.join(workspacePath, "AIDOCS", "reports"))).toBe(true);

    const orgContent = await fs.readFile(path.join(workspacePath, ".msgcode", "ORG.md"), "utf8");
    const configContent = JSON.parse(await fs.readFile(path.join(workspacePath, ".msgcode", "config.json"), "utf8"));
    expect(orgContent).toContain("名称：");
    expect(orgContent).toContain("交税地：");
    expect(orgContent).toContain("统一社会信用代码：");
    expect(configContent["profile.name"]).toBe("");
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveRuntimeEntry } from "../src/runtime/runtime-entry.js";

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-runtime-entry-"));
}

async function ensureFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "export {};\n", "utf8");
}

describe("runtime entry resolution", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应优先使用 compiled daemon 入口", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const daemonPath = path.join(root, "dist", "daemon.js");
    await ensureFile(daemonPath);

    const result = resolveRuntimeEntry("daemon", {
      projectRoot: root,
      env: {},
      nodePath: "/usr/local/bin/node",
    });

    expect(result.mode).toBe("compiled");
    expect(result.command).toBe("/usr/local/bin/node");
    expect(result.args).toEqual([daemonPath]);
    expect(result.entryPath).toBe(daemonPath);
    expect(result.workingDirectory).toBe(root);
  });

  it("应允许环境变量覆盖 compiled 入口", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const cliPath = path.join(root, "custom", "cli.js");
    await ensureFile(cliPath);

    const result = resolveRuntimeEntry("cli", {
      projectRoot: root,
      env: { MSGCODE_CLI_ENTRY: cliPath },
      nodePath: "/usr/local/bin/node",
    });

    expect(result.mode).toBe("compiled");
    expect(result.entryPath).toBe(cliPath);
    expect(result.args).toEqual([cliPath]);
  });

  it("缺少 compiled 入口时应回退到源码 tsx", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    const daemonSource = path.join(root, "src", "daemon.ts");
    await ensureFile(tsxCli);
    await ensureFile(daemonSource);

    const result = resolveRuntimeEntry("daemon", {
      projectRoot: root,
      env: {},
      nodePath: "/usr/local/bin/node",
    });

    expect(result.mode).toBe("source-tsx");
    expect(result.command).toBe("/usr/local/bin/node");
    expect(result.args).toEqual([tsxCli, daemonSource]);
    expect(result.entryPath).toBe(daemonSource);
    expect(result.workingDirectory).toBe(root);
  });
});

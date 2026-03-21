import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildArtifact } from "../src/runtime/build-artifact.js";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-build-artifact-"));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await fs.chmod(filePath, 0o755);
}

async function createFakeProject(projectRoot: string): Promise<void> {
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "msgcode", version: "9.9.9-test" }, null, 2),
  );
  await writeFile(path.join(projectRoot, "dist", "cli.js"), "console.log('cli');\n");
  await writeFile(path.join(projectRoot, "dist", "daemon.js"), "console.log('daemon');\n");
  await writeFile(path.join(projectRoot, "node_modules", "fake-dep", "index.js"), "export default 'ok';\n");

  for (const scriptName of [
    "install-appliance.sh",
    "doctor-appliance.sh",
    "first-run-init.sh",
    "upgrade-appliance.sh",
    "rollback-appliance.sh",
    "lib-appliance-preinstall.sh",
  ]) {
    await writeExecutable(path.join(projectRoot, "bootstrap", scriptName), `#!/bin/sh\necho ${scriptName}\n`);
  }
}

describe("build artifact slice", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应生成可执行的 bundle-root 并使用 bundled node + compiled cli", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const projectRoot = path.join(root, "project");
    const outputRoot = path.join(root, "bundle-root");
    const logPath = path.join(root, "node.log");
    await createFakeProject(projectRoot);
    await writeExecutable(
      path.join(root, "fake-node"),
      `#!/bin/sh
set -eu
printf '%s\n' "$0" >> "$MSGCODE_TEST_LOG"
for arg in "$@"; do
  printf '%s\n' "$arg" >> "$MSGCODE_TEST_LOG"
done
`,
    );

    const result = await buildArtifact({
      projectRoot,
      outputRoot,
      nodeBinaryPath: path.join(root, "fake-node"),
    });

    expect(result.outputRoot).toBe(outputRoot);
    expect(existsSync(path.join(outputRoot, "runtime", "dist", "cli.js"))).toBe(true);
    expect(existsSync(path.join(outputRoot, "runtime", "dist", "daemon.js"))).toBe(true);
    expect(existsSync(path.join(outputRoot, "runtime", "node_modules", "fake-dep", "index.js"))).toBe(true);
    expect(existsSync(path.join(outputRoot, "bootstrap", "install-appliance.sh"))).toBe(true);
    expect(existsSync(path.join(outputRoot, "appliance.manifest"))).toBe(true);

    await execFileAsync(path.join(outputRoot, "bin", "msgcode"), ["status"], {
      env: {
        ...process.env,
        MSGCODE_TEST_LOG: logPath,
      },
    });

    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain(path.join(outputRoot, "runtime", "node", "bin", "node"));
    expect(log).toContain(path.join(outputRoot, "runtime", "dist", "cli.js"));
    expect(log).toContain("status");

    const manifest = await fs.readFile(path.join(outputRoot, "appliance.manifest"), "utf8");
    expect(manifest).toContain("MSGCODE_APPLIANCE_APP_VERSION=9.9.9-test");
    expect(manifest).toContain("MSGCODE_APPLIANCE_RUNTIME_DIR=runtime");
  });

  it("缺少 compiled cli 入口时应直接失败", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const projectRoot = path.join(root, "project");
    await createFakeProject(projectRoot);
    await fs.rm(path.join(projectRoot, "dist", "cli.js"));

    await expect(buildArtifact({
      projectRoot,
      outputRoot: path.join(root, "bundle-root"),
      nodeBinaryPath: process.execPath,
    })).rejects.toThrow("Missing compiled cli entry");
  });
});

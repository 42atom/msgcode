import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildAppBundle } from "../src/runtime/build-app-bundle.js";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-app-bundle-"));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await fs.chmod(filePath, 0o755);
}

async function createFakeBundleRoot(bundleRoot: string): Promise<void> {
  await writeExecutable(
    path.join(bundleRoot, "bin", "msgcode"),
    `#!/bin/sh
set -eu
printf '%s\n' "$0" >> "$MSGCODE_TEST_LOG"
printf '%s\n' "$MSGCODE_APP_BUNDLE_ROOT" >> "$MSGCODE_TEST_LOG"
for arg in "$@"; do
  printf '%s\n' "$arg" >> "$MSGCODE_TEST_LOG"
done
`,
  );
  await writeFile(path.join(bundleRoot, "runtime", "dist", "cli.js"), "console.log('cli');\n");
  await writeExecutable(path.join(bundleRoot, "bootstrap", "install-appliance.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(
    path.join(bundleRoot, "appliance.manifest"),
    [
      "MSGCODE_APPLIANCE_MANIFEST_VERSION=1",
      "MSGCODE_APPLIANCE_APP_VERSION=2.4.0-test",
      "MSGCODE_APPLIANCE_RUNTIME_DIR=runtime",
      "MSGCODE_APPLIANCE_LAUNCHER_REL=bin/msgcode",
      "",
    ].join("\n"),
  );
}

describe("app bundle host slice", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应只消费 bundle-root 并产出可启动的 .app 骨架", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot = path.join(root, "bundle-root");
    const outputPath = path.join(root, "MsgCode.app");
    const logPath = path.join(root, "host.log");
    await createFakeBundleRoot(bundleRoot);

    const result = await buildAppBundle({
      bundleRoot,
      outputPath,
    });

    expect(result.appPath).toBe(outputPath);
    expect(existsSync(path.join(outputPath, "Contents", "Info.plist"))).toBe(true);
    expect(existsSync(path.join(outputPath, "Contents", "PkgInfo"))).toBe(true);
    expect(existsSync(path.join(outputPath, "Contents", "Resources", "bundle-root", "appliance.manifest"))).toBe(true);
    expect(existsSync(path.join(outputPath, "Contents", "Resources", "bundle-root", "runtime", "dist", "cli.js"))).toBe(true);

    await execFileAsync(path.join(outputPath, "Contents", "MacOS", "msgcode-host"), ["status"], {
      env: {
        ...process.env,
        MSGCODE_TEST_LOG: logPath,
      },
    });

    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain(path.join(outputPath, "Contents", "Resources", "bundle-root", "bin", "msgcode"));
    expect(log).toContain(path.join(outputPath, "Contents", "Resources", "bundle-root"));
    expect(log).toContain("status");

    const plist = await fs.readFile(path.join(outputPath, "Contents", "Info.plist"), "utf8");
    expect(plist).toContain("<string>MsgCode</string>");
    expect(plist).toContain("<string>ai.msgcode.desktop</string>");
    expect(plist).toContain("<string>2.4.0-test</string>");
  });

  it("缺少 appliance.manifest 时应直接失败", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot = path.join(root, "bundle-root");
    await writeExecutable(path.join(bundleRoot, "bin", "msgcode"), "#!/bin/sh\nexit 0\n");
    await writeFile(path.join(bundleRoot, "runtime", "dist", "cli.js"), "console.log('cli');\n");
    await writeExecutable(path.join(bundleRoot, "bootstrap", "install-appliance.sh"), "#!/bin/sh\nexit 0\n");

    await expect(buildAppBundle({
      bundleRoot,
      outputPath: path.join(root, "MsgCode.app"),
    })).rejects.toThrow("Missing appliance manifest");
  });
});

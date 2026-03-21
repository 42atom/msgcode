import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-bootstrap-"));
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function createFakePreinstallDeps(
  root: string,
  options?: {
    managedBash?: boolean;
    zstd?: boolean;
  }
): Promise<NodeJS.ProcessEnv> {
  const managedBashPath = path.join(root, "deps", "bash");
  const zstdPath = path.join(root, "deps", "zstd");
  if (options?.managedBash !== false) {
    await writeExecutable(managedBashPath, "#!/bin/sh\nexit 0\n");
  }
  if (options?.zstd !== false) {
    await writeExecutable(zstdPath, "#!/bin/sh\nexit 0\n");
  }
  return {
    ...process.env,
    MSGCODE_MANAGED_BASH_CANDIDATES: managedBashPath,
    MSGCODE_ZSTD_CANDIDATES: zstdPath,
  };
}

async function createFakeBundle(
  bundleRoot: string,
  markerText: string,
  options?: {
    appVersion?: string;
    runtimeDir?: string;
    launcherRel?: string;
    runtimeBinRel?: string;
    nodeBinRel?: string;
  }
): Promise<void> {
  const appVersion = options?.appVersion ?? "test-1.0.0";
  const runtimeDir = options?.runtimeDir ?? "runtime";
  const launcherRel = options?.launcherRel ?? "bin/msgcode";
  const runtimeBinRel = options?.runtimeBinRel ?? `${runtimeDir}/bin/msgcode`;
  const nodeBinRel = options?.nodeBinRel ?? `${runtimeDir}/node/bin`;
  const runtimeRoot = path.join(bundleRoot, runtimeDir);
  await writeExecutable(
    path.join(runtimeRoot, "bin", "msgcode"),
    `#!/bin/sh
set -eu
printf '%s\\n' "$@" >> "$MSGCODE_TEST_LOG"
printf '${markerText}\\n' > "$MSGCODE_TEST_MARKER"
`
  );
  await fs.writeFile(
    path.join(bundleRoot, "appliance.manifest"),
    [
      "MSGCODE_APPLIANCE_MANIFEST_VERSION=1",
      `MSGCODE_APPLIANCE_APP_VERSION=${appVersion}`,
      `MSGCODE_APPLIANCE_RUNTIME_DIR=${runtimeDir}`,
      `MSGCODE_APPLIANCE_LAUNCHER_REL=${launcherRel}`,
      `MSGCODE_APPLIANCE_RUNTIME_BIN_REL=${runtimeBinRel}`,
      `MSGCODE_APPLIANCE_NODE_BIN_REL=${nodeBinRel}`,
      "",
    ].join("\n"),
    "utf8"
  );
}

describe("appliance bootstrap scripts", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("install-appliance 应复制 runtime 并写 launcher", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot = path.join(root, "bundle");
    const installRoot = path.join(root, "install");
    const env = await createFakePreinstallDeps(root);
    await createFakeBundle(bundleRoot, "installed");

    await execFileAsync("sh", [
      "bootstrap/install-appliance.sh",
      "--bundle-root",
      bundleRoot,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    expect(existsSync(path.join(installRoot, "runtime", "bin", "msgcode"))).toBe(true);
    expect(existsSync(path.join(installRoot, "bin", "msgcode"))).toBe(true);
    expect(existsSync(path.join(installRoot, "appliance.manifest"))).toBe(true);
  });

  it("install-appliance 应按 manifest 读取自定义 runtime 路径", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot = path.join(root, "bundle");
    const installRoot = path.join(root, "install");
    const env = await createFakePreinstallDeps(root);
    await createFakeBundle(bundleRoot, "manifest", {
      runtimeDir: "core-runtime",
      launcherRel: "launcher/msgcode",
      runtimeBinRel: "core-runtime/bin/msgcode",
      nodeBinRel: "core-runtime/node/bin",
    });

    await execFileAsync("sh", [
      "bootstrap/install-appliance.sh",
      "--bundle-root",
      bundleRoot,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    expect(existsSync(path.join(installRoot, "core-runtime", "bin", "msgcode"))).toBe(true);
    expect(existsSync(path.join(installRoot, "launcher", "msgcode"))).toBe(true);
    const installedManifest = await fs.readFile(path.join(installRoot, "appliance.manifest"), "utf8");
    expect(installedManifest).toContain("MSGCODE_APPLIANCE_MANIFEST_VERSION=1");
    expect(installedManifest).toContain("MSGCODE_APPLIANCE_APP_VERSION=test-1.0.0");
    expect(installedManifest).toContain("MSGCODE_APPLIANCE_RUNTIME_DIR=core-runtime");
    expect(installedManifest).toContain("MSGCODE_APPLIANCE_LAUNCHER_REL=launcher/msgcode");
  });

  it("first-run-init 应通过 launcher 调用 msgcode init", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot = path.join(root, "bundle");
    const installRoot = path.join(root, "install");
    const logPath = path.join(root, "msgcode.log");
    const markerPath = path.join(root, "marker.txt");
    const env = await createFakePreinstallDeps(root);
    await createFakeBundle(bundleRoot, "first-run");

    await execFileAsync("sh", [
      "bootstrap/install-appliance.sh",
      "--bundle-root",
      bundleRoot,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    await execFileAsync("sh", [
      "bootstrap/first-run-init.sh",
      "--install-root",
      installRoot,
      "--workspace",
      "acme/ops",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...env,
        MSGCODE_TEST_LOG: logPath,
        MSGCODE_TEST_MARKER: markerPath,
      },
    });

    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain("init");
    expect(log).toContain("--workspace");
    expect(log).toContain("acme/ops");
    expect(await fs.readFile(markerPath, "utf8")).toContain("first-run");
  });

  it("upgrade-appliance 应替换 runtime 但保留安装根", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot1 = path.join(root, "bundle-v1");
    const bundleRoot2 = path.join(root, "bundle-v2");
    const installRoot = path.join(root, "install");
    const logPath = path.join(root, "upgrade.log");
    const markerPath = path.join(root, "upgrade-marker.txt");
    const env = await createFakePreinstallDeps(root);
    await createFakeBundle(bundleRoot1, "v1");
    await createFakeBundle(bundleRoot2, "v2");

    await execFileAsync("sh", [
      "bootstrap/install-appliance.sh",
      "--bundle-root",
      bundleRoot1,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    await execFileAsync("sh", [
      "bootstrap/upgrade-appliance.sh",
      "--bundle-root",
      bundleRoot2,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    await execFileAsync(path.join(installRoot, "bin", "msgcode"), ["status"], {
      env: {
        ...env,
        MSGCODE_TEST_LOG: logPath,
        MSGCODE_TEST_MARKER: markerPath,
      },
    });

    expect(await fs.readFile(markerPath, "utf8")).toContain("v2");
    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain("status");
    expect(existsSync(path.join(installRoot, "runtime.prev", "bin", "msgcode"))).toBe(true);
    expect(existsSync(path.join(installRoot, "appliance.manifest.prev"))).toBe(true);
  });

  it("doctor-appliance 应按已安装 manifest 检查 runtime 与 launcher", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot = path.join(root, "bundle");
    const installRoot = path.join(root, "install");
    const env = await createFakePreinstallDeps(root);
    await createFakeBundle(bundleRoot, "doctor", {
      runtimeDir: "core-runtime",
      launcherRel: "launcher/msgcode",
      runtimeBinRel: "core-runtime/bin/msgcode",
      nodeBinRel: "core-runtime/node/bin",
    });

    await execFileAsync("sh", [
      "bootstrap/install-appliance.sh",
      "--bundle-root",
      bundleRoot,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    const { stdout } = await execFileAsync("sh", [
      "bootstrap/doctor-appliance.sh",
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    expect(stdout).toContain("[preinstall] managed-bash: ok");
    expect(stdout).toContain("[preinstall] zstd: ok");
    expect(stdout).toContain("Appliance doctor 通过");
    expect(stdout).toContain("version=test-1.0.0");
  });

  it("install-appliance 应在托管 Bash 缺失时前置失败", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot = path.join(root, "bundle");
    const installRoot = path.join(root, "install");
    const env = await createFakePreinstallDeps(root, { managedBash: false, zstd: true });
    await createFakeBundle(bundleRoot, "installed");

    await expect(execFileAsync("sh", [
      "bootstrap/install-appliance.sh",
      "--bundle-root",
      bundleRoot,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing Core Appliance preinstall dependency: managed bash"),
    });
  });

  it("doctor-appliance 应在 zstd 缺失时前置失败", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot = path.join(root, "bundle");
    const installRoot = path.join(root, "install");
    const installEnv = await createFakePreinstallDeps(root, { managedBash: true, zstd: true });
    await createFakeBundle(bundleRoot, "doctor");

    await execFileAsync("sh", [
      "bootstrap/install-appliance.sh",
      "--bundle-root",
      bundleRoot,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: installEnv,
    });

    const doctorEnv = await createFakePreinstallDeps(path.join(root, "doctor-missing"), { managedBash: true, zstd: false });
    await expect(execFileAsync("sh", [
      "bootstrap/doctor-appliance.sh",
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: doctorEnv,
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing Core Appliance preinstall dependency: zstd"),
    });
  });

  it("rollback-appliance 应恢复上一个 runtime 与 manifest", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const bundleRoot1 = path.join(root, "bundle-v1");
    const bundleRoot2 = path.join(root, "bundle-v2");
    const installRoot = path.join(root, "install");
    const logPath = path.join(root, "rollback.log");
    const markerPath = path.join(root, "rollback-marker.txt");
    const env = await createFakePreinstallDeps(root);
    await createFakeBundle(bundleRoot1, "v1", {
      runtimeDir: "core-runtime",
      launcherRel: "launcher/msgcode",
      runtimeBinRel: "core-runtime/bin/msgcode",
      nodeBinRel: "core-runtime/node/bin",
    });
    await createFakeBundle(bundleRoot2, "v2", {
      runtimeDir: "core-runtime",
      launcherRel: "launcher/msgcode",
      runtimeBinRel: "core-runtime/bin/msgcode",
      nodeBinRel: "core-runtime/node/bin",
    });

    await execFileAsync("sh", [
      "bootstrap/install-appliance.sh",
      "--bundle-root",
      bundleRoot1,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    await execFileAsync("sh", [
      "bootstrap/upgrade-appliance.sh",
      "--bundle-root",
      bundleRoot2,
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    await execFileAsync("sh", [
      "bootstrap/rollback-appliance.sh",
      "--install-root",
      installRoot,
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env,
    });

    await execFileAsync(path.join(installRoot, "launcher", "msgcode"), ["status"], {
      env: {
        ...env,
        MSGCODE_TEST_LOG: logPath,
        MSGCODE_TEST_MARKER: markerPath,
      },
    });

    expect(await fs.readFile(markerPath, "utf8")).toContain("v1");
    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain("status");
  });
});

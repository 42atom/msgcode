import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const REQUIRED_BOOTSTRAP_SCRIPTS = [
  "install-appliance.sh",
  "doctor-appliance.sh",
  "first-run-init.sh",
  "upgrade-appliance.sh",
  "rollback-appliance.sh",
  "lib-appliance-preinstall.sh",
] as const;

export interface BuildArtifactOptions {
  projectRoot: string;
  outputRoot: string;
  appVersion?: string;
  runtimeDistDir?: string;
  nodeModulesDir?: string;
  nodeBinaryPath?: string;
  clean?: boolean;
}

export interface BuildArtifactResult {
  outputRoot: string;
  appVersion: string;
  runtimeRoot: string;
  runtimeCliEntry: string;
  runtimeDaemonEntry: string;
  bundleLauncher: string;
  runtimeLauncher: string;
  manifestPath: string;
  bootstrapDir: string;
}

function resolveRequiredFile(label: string, filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Missing ${label}: ${resolved}`);
  }
  return resolved;
}

async function readAppVersionFromPackageJson(projectRoot: string): Promise<string> {
  const packageJsonPath = resolveRequiredFile("package.json", path.join(projectRoot, "package.json"));
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: string };
  const appVersion = packageJson.version?.trim();
  if (!appVersion) {
    throw new Error(`Missing package version in: ${packageJsonPath}`);
  }
  return appVersion;
}

function buildRuntimeLauncher(): string {
  return `#!/bin/sh
set -eu
SELF_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
RUNTIME_ROOT=$(cd "$SELF_DIR/.." && pwd)
NODE_BIN="$RUNTIME_ROOT/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  echo "Missing bundled node: $NODE_BIN" >&2
  exit 2
fi
export MSGCODE_RUNTIME_ROOT="$RUNTIME_ROOT"
exec "$NODE_BIN" "$RUNTIME_ROOT/dist/cli.js" "$@"
`;
}

function buildBundleLauncher(): string {
  return `#!/bin/sh
set -eu
SELF_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
BUNDLE_ROOT=$(cd "$SELF_DIR/.." && pwd)
RUNTIME_ROOT="$BUNDLE_ROOT/runtime"
if [ -d "$RUNTIME_ROOT/node/bin" ]; then
  PATH="$RUNTIME_ROOT/node/bin:$PATH"
  export PATH
fi
export MSGCODE_RUNTIME_ROOT="$RUNTIME_ROOT"
exec "$RUNTIME_ROOT/bin/msgcode" "$@"
`;
}

function buildManifest(appVersion: string): string {
  return [
    "MSGCODE_APPLIANCE_MANIFEST_VERSION=1",
    `MSGCODE_APPLIANCE_APP_VERSION=${appVersion}`,
    "MSGCODE_APPLIANCE_RUNTIME_DIR=runtime",
    "MSGCODE_APPLIANCE_LAUNCHER_REL=bin/msgcode",
    "MSGCODE_APPLIANCE_RUNTIME_BIN_REL=runtime/bin/msgcode",
    "MSGCODE_APPLIANCE_NODE_BIN_REL=runtime/node/bin",
    "",
  ].join("\n");
}

export async function buildArtifact(options: BuildArtifactOptions): Promise<BuildArtifactResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const outputRoot = path.resolve(options.outputRoot);
  const runtimeDistDir = resolveRequiredFile(
    "compiled runtime dir",
    options.runtimeDistDir || path.join(projectRoot, "dist")
  );
  const runtimeCliEntry = resolveRequiredFile("compiled cli entry", path.join(runtimeDistDir, "cli.js"));
  const runtimeDaemonEntry = resolveRequiredFile("compiled daemon entry", path.join(runtimeDistDir, "daemon.js"));
  const nodeModulesDir = resolveRequiredFile("node_modules dir", options.nodeModulesDir || path.join(projectRoot, "node_modules"));
  const nodeBinaryPath = resolveRequiredFile("node binary", options.nodeBinaryPath || process.execPath);
  const appVersion = options.appVersion?.trim() || await readAppVersionFromPackageJson(projectRoot);
  const bootstrapDir = path.join(projectRoot, "bootstrap");

  for (const scriptName of REQUIRED_BOOTSTRAP_SCRIPTS) {
    resolveRequiredFile(`bootstrap script ${scriptName}`, path.join(bootstrapDir, scriptName));
  }

  if (options.clean !== false) {
    await rm(outputRoot, { recursive: true, force: true });
  }

  const runtimeRoot = path.join(outputRoot, "runtime");
  const artifactBootstrapDir = path.join(outputRoot, "bootstrap");
  const runtimeDistTarget = path.join(runtimeRoot, "dist");
  const runtimeNodeModulesTarget = path.join(runtimeRoot, "node_modules");
  const runtimeNodeDir = path.join(runtimeRoot, "node", "bin");
  const runtimeLauncher = path.join(runtimeRoot, "bin", "msgcode");
  const bundleLauncher = path.join(outputRoot, "bin", "msgcode");
  const manifestPath = path.join(outputRoot, "appliance.manifest");

  await mkdir(outputRoot, { recursive: true });
  await cp(runtimeDistDir, runtimeDistTarget, { recursive: true });
  await cp(nodeModulesDir, runtimeNodeModulesTarget, { recursive: true });
  await mkdir(runtimeNodeDir, { recursive: true });
  const bundledNodePath = path.join(runtimeNodeDir, "node");
  await cp(nodeBinaryPath, bundledNodePath);
  await chmod(bundledNodePath, 0o755);

  await mkdir(path.dirname(runtimeLauncher), { recursive: true });
  await writeFile(runtimeLauncher, buildRuntimeLauncher(), "utf8");
  await chmod(runtimeLauncher, 0o755);

  await mkdir(path.dirname(bundleLauncher), { recursive: true });
  await writeFile(bundleLauncher, buildBundleLauncher(), "utf8");
  await chmod(bundleLauncher, 0o755);

  await mkdir(artifactBootstrapDir, { recursive: true });
  for (const scriptName of REQUIRED_BOOTSTRAP_SCRIPTS) {
    await cp(path.join(bootstrapDir, scriptName), path.join(artifactBootstrapDir, scriptName));
  }

  await writeFile(manifestPath, buildManifest(appVersion), "utf8");

  return {
    outputRoot,
    appVersion,
    runtimeRoot,
    runtimeCliEntry,
    runtimeDaemonEntry,
    bundleLauncher,
    runtimeLauncher,
    manifestPath,
    bootstrapDir: artifactBootstrapDir,
  };
}

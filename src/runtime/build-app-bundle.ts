import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface BuildAppBundleOptions {
  bundleRoot: string;
  outputPath: string;
  appName?: string;
  bundleIdentifier?: string;
  executableName?: string;
  clean?: boolean;
}

export interface BuildAppBundleResult {
  appPath: string;
  contentsPath: string;
  resourcesPath: string;
  embeddedBundleRoot: string;
  launcherPath: string;
  plistPath: string;
  appVersion: string;
}

function resolveRequiredPath(label: string, targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (!existsSync(resolved)) {
    throw new Error(`Missing ${label}: ${resolved}`);
  }
  return resolved;
}

async function readManifestValue(manifestPath: string, key: string): Promise<string> {
  const content = await readFile(manifestPath, "utf8");
  const line = content
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim();
  if (!value) {
    throw new Error(`Missing manifest key ${key}: ${manifestPath}`);
  }
  return value;
}

function buildLauncherScript(executableName: string): string {
  return `#!/bin/sh
set -eu
SELF_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
CONTENTS_DIR=$(cd "$SELF_DIR/.." && pwd)
BUNDLE_ROOT="$CONTENTS_DIR/Resources/bundle-root"
LAUNCHER="$BUNDLE_ROOT/bin/msgcode"
if [ ! -x "$LAUNCHER" ]; then
  echo "Missing bundled launcher: $LAUNCHER" >&2
  exit 2
fi
export MSGCODE_APP_HOST_EXECUTABLE="${executableName}"
export MSGCODE_APP_BUNDLE_ROOT="$BUNDLE_ROOT"
exec "$LAUNCHER" "$@"
`;
}

function escapePlist(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function buildInfoPlist(params: {
  appName: string;
  executableName: string;
  bundleIdentifier: string;
  appVersion: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${escapePlist(params.appName)}</string>
  <key>CFBundleExecutable</key>
  <string>${escapePlist(params.executableName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${escapePlist(params.bundleIdentifier)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${escapePlist(params.appName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${escapePlist(params.appVersion)}</string>
  <key>CFBundleVersion</key>
  <string>${escapePlist(params.appVersion)}</string>
</dict>
</plist>
`;
}

export async function buildAppBundle(options: BuildAppBundleOptions): Promise<BuildAppBundleResult> {
  const bundleRoot = resolveRequiredPath("bundle-root", options.bundleRoot);
  const manifestPath = resolveRequiredPath("appliance manifest", path.join(bundleRoot, "appliance.manifest"));
  resolveRequiredPath("bundled launcher", path.join(bundleRoot, "bin", "msgcode"));
  resolveRequiredPath("bundled runtime dir", path.join(bundleRoot, "runtime"));
  resolveRequiredPath("bundled bootstrap dir", path.join(bundleRoot, "bootstrap"));

  const outputPath = path.resolve(options.outputPath);
  const appName = options.appName?.trim() || "MsgCode";
  const executableName = options.executableName?.trim() || "msgcode-host";
  const bundleIdentifier = options.bundleIdentifier?.trim() || "ai.msgcode.desktop";
  const appVersion = await readManifestValue(manifestPath, "MSGCODE_APPLIANCE_APP_VERSION");

  if (options.clean !== false) {
    await rm(outputPath, { recursive: true, force: true });
  }

  const contentsPath = path.join(outputPath, "Contents");
  const macosPath = path.join(contentsPath, "MacOS");
  const resourcesPath = path.join(contentsPath, "Resources");
  const embeddedBundleRoot = path.join(resourcesPath, "bundle-root");
  const launcherPath = path.join(macosPath, executableName);
  const plistPath = path.join(contentsPath, "Info.plist");

  await mkdir(macosPath, { recursive: true });
  await mkdir(resourcesPath, { recursive: true });
  await cp(bundleRoot, embeddedBundleRoot, { recursive: true });
  await writeFile(launcherPath, buildLauncherScript(executableName), "utf8");
  await chmod(launcherPath, 0o755);
  await writeFile(
    plistPath,
    buildInfoPlist({ appName, executableName, bundleIdentifier, appVersion }),
    "utf8"
  );
  await writeFile(path.join(contentsPath, "PkgInfo"), "APPL????", "utf8");

  return {
    appPath: outputPath,
    contentsPath,
    resourcesPath,
    embeddedBundleRoot,
    launcherPath,
    plistPath,
    appVersion,
  };
}

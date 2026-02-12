/**
 * msgcode: 版本信息（动态读取 package.json）
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PackageJson {
  version: string;
  name: string;
}

let cachedVersion: string | undefined;

/**
 * 获取版本号（从 package.json 读取）
 */
export function getVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const require = createRequire(import.meta.url);
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = require(pkgPath) as PackageJson;
    cachedVersion = pkg.version || "0.0.0";
    return cachedVersion;
  } catch {
    return "0.0.0";
  }
}

/**
 * 获取 bin 路径（运行时的 msgcode 可执行文件路径）
 */
export function getBinPath(): string {
  return process.argv[1] || "unknown";
}

/**
 * 获取 CLI 入口路径
 */
export function getCliEntry(): string {
  return __dirname;
}

/**
 * 获取完整版本信息
 */
export interface VersionInfo {
  appVersion: string;
  nodeVersion: string;
  binPath: string;
  cliEntry: string;
  configPath: string;
  imsgPath?: string;
  workspaceRoot?: string;
}

export function getVersionInfo(): VersionInfo {
  return {
    appVersion: getVersion(),
    nodeVersion: process.version,
    binPath: getBinPath(),
    cliEntry: getCliEntry(),
    configPath: path.join(process.env.HOME || "", ".config/msgcode/.env"),
    imsgPath: process.env.IMSG_PATH,
    workspaceRoot: process.env.WORKSPACE_ROOT,
  };
}

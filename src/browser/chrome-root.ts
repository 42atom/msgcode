/**
 * msgcode: 共享工作 Chrome 根目录解析
 *
 * 目标：
 * - 统一 Chrome 工作数据根目录口径
 * - 默认落在 WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>
 * - 给人和 agent 提供同一套工作浏览器入口信息
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_WORKSPACE_ROOT = join(homedir(), "msgcode-workspaces");
const DEFAULT_CHROME_PROFILES_ROOT = "chrome-profiles";
const DEFAULT_CHROME_ROOT_NAME = "work-default";
const DEFAULT_REMOTE_DEBUGGING_PORT = 9222;
const CHROME_BINARY_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const CHROME_ROOT_ERROR_CODES = {
  BAD_ARGS: "BROWSER_BAD_ARGS",
  ROOT_CREATE_FAILED: "BROWSER_ROOT_CREATE_FAILED",
} as const;

export type ChromeRootErrorCode =
  typeof CHROME_ROOT_ERROR_CODES[keyof typeof CHROME_ROOT_ERROR_CODES];

export interface ChromeRootInfo {
  workspaceRoot: string;
  profilesRoot: string;
  chromeRoot: string;
  rootName: string;
  exists: boolean;
  remoteDebuggingPort: number;
  profileDirectory?: string;
  launchCommand: string;
}

export class ChromeRootCommandError extends Error {
  readonly code: ChromeRootErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ChromeRootErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ChromeRootCommandError";
    this.code = code;
    this.details = details;
  }
}

export interface ChromeRootOptions {
  name?: string;
  port?: number;
  profileDirectory?: string;
}

function resolveWorkspaceRoot(): string {
  const raw = (process.env.WORKSPACE_ROOT || "").trim();
  return raw || DEFAULT_WORKSPACE_ROOT;
}

export function getChromeProfilesRoot(): string {
  const override = (process.env.MSGCODE_CHROME_PROFILES_ROOT || "").trim();
  if (override) {
    return override;
  }
  return join(resolveWorkspaceRoot(), ".msgcode", DEFAULT_CHROME_PROFILES_ROOT);
}

function normalizeRootName(name?: string): string {
  const value = (name || DEFAULT_CHROME_ROOT_NAME).trim();
  if (!value) {
    throw new ChromeRootCommandError(
      CHROME_ROOT_ERROR_CODES.BAD_ARGS,
      "root name must be a non-empty string"
    );
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new ChromeRootCommandError(
      CHROME_ROOT_ERROR_CODES.BAD_ARGS,
      "root name may only contain letters, numbers, dot, underscore, and dash",
      { name: value }
    );
  }
  return value;
}

function normalizePort(port?: number): number {
  const value = port ?? DEFAULT_REMOTE_DEBUGGING_PORT;
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new ChromeRootCommandError(
      CHROME_ROOT_ERROR_CODES.BAD_ARGS,
      "remote debugging port must be an integer between 1 and 65535",
      { port: value }
    );
  }
  return value;
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function buildLaunchCommand(
  chromeRoot: string,
  port: number,
  profileDirectory?: string
): string {
  const parts = [
    `${CHROME_BINARY_PATH.replace(/ /g, "\\ ")} \\`,
    `  --user-data-dir=${shellQuote(chromeRoot)} \\`,
    `  --remote-debugging-port=${port}`,
  ];

  if (profileDirectory && profileDirectory.trim()) {
    parts[parts.length - 1] += " \\";
    parts.push(`  --profile-directory=${shellQuote(profileDirectory.trim())}`);
  }

  return parts.join("\n");
}

export function getChromeBinaryPath(): string {
  return CHROME_BINARY_PATH;
}

export function getChromeRootInfo(options: ChromeRootOptions = {}): ChromeRootInfo {
  const rootName = normalizeRootName(options.name);
  const remoteDebuggingPort = normalizePort(options.port);
  const profilesRoot = getChromeProfilesRoot();
  const chromeRoot = join(profilesRoot, rootName);

  return {
    workspaceRoot: resolveWorkspaceRoot(),
    profilesRoot,
    chromeRoot,
    rootName,
    exists: existsSync(chromeRoot),
    remoteDebuggingPort,
    ...(options.profileDirectory?.trim()
      ? { profileDirectory: options.profileDirectory.trim() }
      : {}),
    launchCommand: buildLaunchCommand(
      chromeRoot,
      remoteDebuggingPort,
      options.profileDirectory?.trim()
    ),
  };
}

export async function ensureChromeRoot(
  options: ChromeRootOptions = {}
): Promise<ChromeRootInfo> {
  const info = getChromeRootInfo(options);

  try {
    await mkdir(info.chromeRoot, { recursive: true });
  } catch (error) {
    throw new ChromeRootCommandError(
      CHROME_ROOT_ERROR_CODES.ROOT_CREATE_FAILED,
      error instanceof Error ? error.message : String(error),
      { chromeRoot: info.chromeRoot }
    );
  }

  return {
    ...info,
    exists: true,
  };
}

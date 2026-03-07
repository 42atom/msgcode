/**
 * RETIRED / HISTORICAL / ROLLBACK ONLY
 * 当前正式浏览器主链已切到 src/runners/browser-patchright.ts。
 * 本文件保留仅作历史参考与回滚锚点，不得重新接回正式运行时。
 *
 * msgcode: PinchTab 运行时真相源
 *
 * 目标：
 * - 统一 PinchTab baseUrl / binary path 解析口径
 * - 在本地 orchestrator 未启动时提供最小预启动能力
 * - 给启动链、browser runner、执行核提示词共享同一份浏览器底座信息
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";

const DEFAULT_PINCHTAB_BASE_URL = "http://127.0.0.1:9867";
const DEFAULT_BOOT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

const require = createRequire(import.meta.url);

export interface PinchtabRuntimeInfo {
  baseUrl: string;
  host: string;
  port: number;
  isLocal: boolean;
  binaryPath: string;
  binaryExists: boolean;
}

export interface PinchtabHealth {
  status?: string;
  mode?: string;
  tabs?: number;
  cdp?: string;
  [key: string]: unknown;
}

export interface PinchtabBootstrapResult extends PinchtabRuntimeInfo {
  startedByMsgcode: boolean;
  health: PinchtabHealth;
}

export interface PinchtabEnsureOptions {
  timeoutMs?: number;
  spawnProcess?: (
    command: string,
    args: string[],
    options: SpawnOptions
  ) => ChildProcess;
  fetchImpl?: typeof fetch;
}

export class PinchtabBootstrapError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PinchtabBootstrapError";
    this.code = code;
    this.details = details;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(raw: string): string {
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "127.0.0.1"
    || hostname === "localhost"
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || hostname === "[::1]";
}

function getBinaryName(): string {
  const platform = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "amd64";

  if (platform === "darwin") {
    return `pinchtab-darwin-${arch}`;
  }
  if (platform === "linux") {
    return `pinchtab-linux-${arch}`;
  }
  if (platform === "win32") {
    return `pinchtab-windows-${arch}.exe`;
  }

  throw new PinchtabBootstrapError("PINCHTAB_UNSUPPORTED_PLATFORM", `Unsupported platform: ${platform}`);
}

function getInstalledPinchtabVersion(): string {
  const pkgPath = require.resolve("pinchtab/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown };
  const version = typeof pkg.version === "string" ? pkg.version.trim() : "";
  if (!version) {
    throw new PinchtabBootstrapError("PINCHTAB_VERSION_UNAVAILABLE", "Unable to resolve pinchtab package version");
  }
  return version;
}

export function getPinchtabBaseUrl(): string {
  const raw = process.env.PINCHTAB_BASE_URL
    || process.env.PINCHTAB_URL
    || DEFAULT_PINCHTAB_BASE_URL;
  return normalizeBaseUrl(raw);
}

export function getPinchtabHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = process.env.PINCHTAB_TOKEN || process.env.BRIDGE_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function getPinchtabBinaryPath(): string {
  const envOverride = (process.env.PINCHTAB_BINARY_PATH || "").trim();
  if (envOverride) {
    return envOverride;
  }

  const version = getInstalledPinchtabVersion();
  const binaryName = getBinaryName();
  const versioned = join(homedir(), ".pinchtab", "bin", version, binaryName);
  if (existsSync(versioned)) {
    return versioned;
  }
  return join(homedir(), ".pinchtab", "bin", binaryName);
}

export function getPinchtabRuntimeInfo(): PinchtabRuntimeInfo {
  const baseUrl = getPinchtabBaseUrl();
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new PinchtabBootstrapError(
      "PINCHTAB_BAD_BASE_URL",
      error instanceof Error ? error.message : String(error),
      { baseUrl }
    );
  }

  const binaryPath = getPinchtabBinaryPath();
  return {
    baseUrl,
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "https:" ? "443" : "80")),
    isLocal: isLocalHost(parsed.hostname),
    binaryPath,
    binaryExists: existsSync(binaryPath),
  };
}

async function fetchHealth(
  runtime: PinchtabRuntimeInfo,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<PinchtabHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${runtime.baseUrl}/health`, {
      method: "GET",
      headers: getPinchtabHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new PinchtabBootstrapError(
        "PINCHTAB_HEALTH_HTTP_ERROR",
        `health check failed with status ${response.status}`,
        { baseUrl: runtime.baseUrl, status: response.status }
      );
    }

    const health = await response.json() as PinchtabHealth;
    if (health.mode !== "dashboard") {
      throw new PinchtabBootstrapError(
        "PINCHTAB_ORCHESTRATOR_URL_REQUIRED",
        "PINCHTAB_BASE_URL/PINCHTAB_URL must point to the orchestrator/dashboard URL",
        { baseUrl: runtime.baseUrl, health }
      );
    }

    return health;
  } catch (error) {
    if (error instanceof PinchtabBootstrapError) {
      throw error;
    }

    if (error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError") {
      throw new PinchtabBootstrapError(
        "PINCHTAB_HEALTH_TIMEOUT",
        `health check timed out after ${timeoutMs}ms`,
        { baseUrl: runtime.baseUrl, timeoutMs }
      );
    }

    throw new PinchtabBootstrapError(
      "PINCHTAB_UNAVAILABLE",
      error instanceof Error ? error.message : String(error),
      { baseUrl: runtime.baseUrl }
    );
  } finally {
    clearTimeout(timer);
  }
}

function spawnPinchtabProcess(
  runtime: PinchtabRuntimeInfo,
  spawnProcess?: PinchtabEnsureOptions["spawnProcess"]
): void {
  if (!runtime.binaryExists) {
    throw new PinchtabBootstrapError(
      "PINCHTAB_BINARY_MISSING",
      `PinchTab binary not found: ${runtime.binaryPath}`,
      { ...runtime }
    );
  }

  const run = spawnProcess ?? spawn;
  const child = run(
    runtime.binaryPath,
    ["serve", `--port=${runtime.port}`],
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
      shell: false,
    }
  );
  child.unref();
}

export async function ensurePinchtabReady(
  options: PinchtabEnsureOptions = {}
): Promise<PinchtabBootstrapResult> {
  const runtime = getPinchtabRuntimeInfo();
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const health = await fetchHealth(runtime, Math.min(timeoutMs, 1_500), fetchImpl);
    return {
      ...runtime,
      startedByMsgcode: false,
      health,
    };
  } catch (error) {
    if (!runtime.isLocal) {
      throw error;
    }

    if (error instanceof PinchtabBootstrapError && error.code === "PINCHTAB_ORCHESTRATOR_URL_REQUIRED") {
      throw error;
    }
  }

  spawnPinchtabProcess(runtime, options.spawnProcess);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    await sleep(DEFAULT_POLL_INTERVAL_MS);
    try {
      const health = await fetchHealth(runtime, Math.min(timeoutMs, 1_500), fetchImpl);
      return {
        ...runtime,
        startedByMsgcode: true,
        health,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new PinchtabBootstrapError(
    "PINCHTAB_BOOT_TIMEOUT",
    `PinchTab did not become ready within ${timeoutMs}ms`,
    {
      ...runtime,
      lastError: lastError instanceof Error ? lastError.message : String(lastError ?? ""),
    }
  );
}

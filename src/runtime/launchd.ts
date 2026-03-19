/**
 * msgcode: macOS launchd 守护辅助
 *
 * 目标：
 * - 将 daemon 的“进程保活”责任交给 launchd
 * - 提供最小的 plist / runtime / start / stop / restart / status 能力
 * - 不在应用内再发明 watchdog
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveRuntimeEntry } from "./runtime-entry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const MSGCODE_LAUNCH_AGENT_LABEL = "ai.msgcode.daemon";
const RETIRED_DAEMON_ENV_KEYS = ["IMSG_PATH", "IMSG_DB_PATH"] as const;

export type LaunchAgentStatus = "running" | "stopped" | "missing" | "unknown";

export type LaunchAgentRuntime = {
  label: string;
  plistPath: string;
  stdoutPath: string;
  stderrPath: string;
  installed: boolean;
  loaded: boolean;
  status: LaunchAgentStatus;
  pid?: number;
  state?: string;
  lastExitStatus?: number;
  lastExitReason?: string;
  detail?: string;
};

type LaunchctlResult = {
  stdout: string;
  stderr: string;
  code: number;
};

type LaunchAgentPlistArgs = {
  label: string;
  programArguments: string[];
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
  environment: Record<string, string | undefined>;
};

type ParsedLaunchctlPrint = {
  state?: string;
  pid?: number;
  lastExitStatus?: number;
  lastExitReason?: string;
};

export function isLaunchdSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

export function resolveMsgcodeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MSGCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "msgcode");
}

export function resolveMsgcodeLogDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveMsgcodeConfigDir(env), "log");
}

export function resolveLaunchAgentLabel(): string {
  return MSGCODE_LAUNCH_AGENT_LABEL;
}

export function resolveGuiDomain(uid = typeof process.getuid === "function" ? process.getuid() : 501): string {
  return `gui/${uid}`;
}

export function resolveLaunchAgentPlistPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${resolveLaunchAgentLabel()}.plist`);
}

export function resolveLaunchAgentLogPaths(env: NodeJS.ProcessEnv = process.env): {
  logDir: string;
  stdoutPath: string;
  stderrPath: string;
} {
  const logDir = resolveMsgcodeLogDir(env);
  return {
    logDir,
    stdoutPath: path.join(logDir, "daemon.stdout.log"),
    stderrPath: path.join(logDir, "daemon.stderr.log"),
  };
}

function resolveDaemonEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {
    ...env,
    LOG_CONSOLE: "false",
    MSGCODE_DAEMON_SUPERVISOR: "launchd",
    MSGCODE_ENV_BOOTSTRAPPED: "1",
    // LaunchAgent 是正式守护入口，不允许把 retired transport 从 shell env 回流进 daemon。
    MSGCODE_TRANSPORTS: "feishu",
    PATH: env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  };

  for (const key of RETIRED_DAEMON_ENV_KEYS) {
    delete environment[key];
  }

  return environment;
}

export function resolveDaemonCommandConfig(env: NodeJS.ProcessEnv = process.env): {
  programArguments: string[];
  workingDirectory: string;
  environment: Record<string, string | undefined>;
} {
  const daemonEntry = resolveRuntimeEntry("daemon", { projectRoot: PROJECT_ROOT, env });

  return {
    programArguments: [daemonEntry.command, ...daemonEntry.args],
    workingDirectory: daemonEntry.workingDirectory,
    environment: resolveDaemonEnvironment(env),
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildLaunchAgentPlist(args: LaunchAgentPlistArgs): string {
  const envEntries = Object.entries(args.environment)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(String(value))}</string>`
    )
    .join("\n");

  const programArgs = args.programArguments
    .map((value) => `    <string>${escapeXml(value)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(args.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(args.workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(args.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(args.stderrPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
</dict>
</plist>
`;
}

export function parseLaunchctlPrint(output: string): ParsedLaunchctlPrint {
  const parsed: ParsedLaunchctlPrint = {};
  const lines = output.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = line.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();

    if (key === "state") {
      parsed.state = value;
      continue;
    }

    if (key === "pid") {
      const pid = Number(value);
      if (Number.isFinite(pid) && pid > 0) {
        parsed.pid = pid;
      }
      continue;
    }

    if (key === "last exit status") {
      const exitStatus = Number(value);
      if (Number.isFinite(exitStatus)) {
        parsed.lastExitStatus = exitStatus;
      }
      continue;
    }

    if (key === "last exit reason") {
      parsed.lastExitReason = value;
    }
  }

  return parsed;
}

async function execLaunchctl(args: string[]): Promise<LaunchctlResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("launchctl", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        code: code ?? 1,
      });
    });
  });
}

function isLaunchctlNotLoaded(result: LaunchctlResult): boolean {
  const detail = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    detail.includes("no such process") ||
    detail.includes("could not find service") ||
    detail.includes("not found")
  );
}

function isUnsupportedGuiDomain(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("domain does not support specified action") ||
    normalized.includes("bootstrap failed: 125")
  );
}

async function ensureLaunchAgentFiles(env: NodeJS.ProcessEnv = process.env): Promise<{
  label: string;
  plistPath: string;
  stdoutPath: string;
  stderrPath: string;
}> {
  const { programArguments, workingDirectory, environment } = resolveDaemonCommandConfig(env);
  const label = resolveLaunchAgentLabel();
  const plistPath = resolveLaunchAgentPlistPath(env);
  const { logDir, stdoutPath, stderrPath } = resolveLaunchAgentLogPaths(env);

  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.mkdir(logDir, { recursive: true });

  const plist = buildLaunchAgentPlist({
    label,
    programArguments,
    workingDirectory,
    stdoutPath,
    stderrPath,
    environment,
  });
  await fs.writeFile(plistPath, plist, "utf8");

  return {
    label,
    plistPath,
    stdoutPath,
    stderrPath,
  };
}

export async function readLaunchAgentRuntime(
  env: NodeJS.ProcessEnv = process.env
): Promise<LaunchAgentRuntime> {
  const label = resolveLaunchAgentLabel();
  const plistPath = resolveLaunchAgentPlistPath(env);
  const { stdoutPath, stderrPath } = resolveLaunchAgentLogPaths(env);
  const installed = existsSync(plistPath);

  if (!isLaunchdSupported()) {
    return {
      label,
      plistPath,
      stdoutPath,
      stderrPath,
      installed,
      loaded: false,
      status: "missing",
      detail: "当前平台不支持 launchd",
    };
  }

  const domain = resolveGuiDomain();
  const result = await execLaunchctl(["print", `${domain}/${label}`]);
  if (result.code !== 0) {
    return {
      label,
      plistPath,
      stdoutPath,
      stderrPath,
      installed,
      loaded: false,
      status: installed ? "stopped" : "missing",
      detail: (result.stderr || result.stdout).trim() || undefined,
    };
  }

  const parsed = parseLaunchctlPrint(result.stdout || result.stderr || "");
  const state = parsed.state?.toLowerCase();
  return {
    label,
    plistPath,
    stdoutPath,
    stderrPath,
    installed,
    loaded: true,
    status: state === "running" || typeof parsed.pid === "number" ? "running" : state ? "stopped" : "unknown",
    pid: parsed.pid,
    state: parsed.state,
    lastExitStatus: parsed.lastExitStatus,
    lastExitReason: parsed.lastExitReason,
  };
}

async function bootstrapLaunchAgent(plistPath: string): Promise<void> {
  const domain = resolveGuiDomain();
  const label = resolveLaunchAgentLabel();
  await execLaunchctl(["bootout", domain, plistPath]);
  await execLaunchctl(["unload", plistPath]);
  await execLaunchctl(["enable", `${domain}/${label}`]);
  const boot = await execLaunchctl(["bootstrap", domain, plistPath]);
  if (boot.code !== 0) {
    const detail = (boot.stderr || boot.stdout).trim();
    if (isUnsupportedGuiDomain(detail)) {
      throw new Error(
        [
          `launchctl bootstrap failed: ${detail}`,
          `LaunchAgent 需要 macOS 图形登录会话 (${domain})。`,
          "请以当前桌面登录用户运行，不要在纯 SSH/headless/sudo 上直接安装。",
        ].join("\n"),
      );
    }
    throw new Error(`launchctl bootstrap failed: ${detail}`);
  }
}

async function kickstartLaunchAgent(): Promise<void> {
  const domain = resolveGuiDomain();
  const label = resolveLaunchAgentLabel();
  const kick = await execLaunchctl(["kickstart", "-k", `${domain}/${label}`]);
  if (kick.code !== 0) {
    throw new Error(`launchctl kickstart failed: ${(kick.stderr || kick.stdout).trim()}`);
  }
}

export async function ensureLaunchAgentStarted(
  env: NodeJS.ProcessEnv = process.env
): Promise<LaunchAgentRuntime> {
  const { plistPath } = await ensureLaunchAgentFiles(env);
  const runtime = await readLaunchAgentRuntime(env);
  if (!runtime.loaded) {
    await bootstrapLaunchAgent(plistPath);
  }
  await kickstartLaunchAgent();
  return await readLaunchAgentRuntime(env);
}

export async function restartLaunchAgent(
  env: NodeJS.ProcessEnv = process.env
): Promise<LaunchAgentRuntime> {
  const { plistPath } = await ensureLaunchAgentFiles(env);
  await bootstrapLaunchAgent(plistPath);
  await kickstartLaunchAgent();
  return await readLaunchAgentRuntime(env);
}

export async function stopLaunchAgent(
  env: NodeJS.ProcessEnv = process.env
): Promise<LaunchAgentRuntime> {
  const domain = resolveGuiDomain();
  const label = resolveLaunchAgentLabel();
  const stop = await execLaunchctl(["bootout", `${domain}/${label}`]);
  if (stop.code !== 0 && !isLaunchctlNotLoaded(stop)) {
    throw new Error(`launchctl bootout failed: ${(stop.stderr || stop.stdout).trim()}`);
  }
  return await readLaunchAgentRuntime(env);
}

async function readLastNonEmptyLine(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim());
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i]) {
        return lines[i];
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function readLastDaemonErrorLine(
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const { stdoutPath, stderrPath } = resolveLaunchAgentLogPaths(env);
  return (await readLastNonEmptyLine(stderrPath)) ?? (await readLastNonEmptyLine(stdoutPath));
}

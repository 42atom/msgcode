import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type CliEnvOverrides = Record<string, string | undefined>;

function buildCliEnv(tempHome: string, overrides: CliEnvOverrides = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tempHome,
    LOG_FILE: "false",
    LOG_LEVEL: "warn",
    MY_EMAIL: "test@example.com",
    NODE_OPTIONS: "--import tsx",
  };

  delete env.MSGCODE_TRANSPORTS;
  delete env.IMSG_PATH;
  delete env.IMSG_DB_PATH;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

export function runCliIsolated(
  args: string[],
  options: {
    cwd?: string;
    env?: CliEnvOverrides;
  } = {}
): SpawnSyncReturns<string> {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-cli-home-"));

  try {
    return spawnSync("node", ["src/cli.ts", ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: buildCliEnv(tempHome, options.env),
      encoding: "utf-8",
    });
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

export function execCliStdoutIsolated(
  args: string[],
  options: {
    cwd?: string;
    env?: CliEnvOverrides;
  } = {}
): string {
  const result = runCliIsolated(args, options);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `child exit=${result.status ?? 1}`);
  }
  return result.stdout ?? "";
}

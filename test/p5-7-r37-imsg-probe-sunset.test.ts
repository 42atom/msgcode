import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROBE_CONFIG_URL = pathToFileURL(path.join(process.cwd(), "src/probe/probes/config.ts")).href;

type JsonRecord = Record<string, unknown>;

function writeExecutable(binDir: string, name: string, body: string): void {
  const target = path.join(binDir, name);
  fs.writeFileSync(target, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function withProbeSandbox<T>(
  overrides: Record<string, string | undefined>,
  fn: (ctx: { env: NodeJS.ProcessEnv; cwd: string }) => T
): T {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-probe-home-"));
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-probe-cwd-"));
  const tempBin = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-probe-bin-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".config", "msgcode"), { recursive: true });
    fs.mkdirSync(path.join(tempHome, "workspaces"), { recursive: true });

    writeExecutable(tempBin, "claude", "echo 'claude 1.0.0'");
    writeExecutable(tempBin, "tmux", [
      "if [ \"$1\" = \"-V\" ]; then",
      "  echo 'tmux 3.4'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"list-sessions\" ]; then",
      "  exit 1",
      "fi",
      "exit 0",
    ].join("\n"));

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.MSGCODE_TRANSPORTS;
    delete env.IMSG_PATH;
    delete env.FEISHU_APP_ID;
    delete env.FEISHU_APP_SECRET;

    env.NODE_ENV = "test";
    env.HOME = tempHome;
    env.WORKSPACE_ROOT = path.join(tempHome, "workspaces");
    env.PATH = `${tempBin}:${process.env.PATH ?? ""}`;

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    return fn({ env, cwd: tempCwd });
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
    fs.rmSync(tempBin, { recursive: true, force: true });
  }
}

function runProbe(moduleUrl: string, exportName: string, overrides: Record<string, string | undefined>): JsonRecord {
  return withProbeSandbox(overrides, ({ env, cwd }) => {
    const script = `
      const mod = await import(${JSON.stringify(moduleUrl)});
      const result = await mod[${JSON.stringify(exportName)}]();
      console.log(JSON.stringify(result));
    `;
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd,
      env,
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `child exit=${result.status}`);
    }

    return JSON.parse(result.stdout.trim()) as JsonRecord;
  });
}

function runProbeFailure(moduleUrl: string, exportName: string, overrides: Record<string, string | undefined>): string {
  return withProbeSandbox(overrides, ({ env, cwd }) => {
    const script = `
      const mod = await import(${JSON.stringify(moduleUrl)});
      const result = await mod[${JSON.stringify(exportName)}]();
      console.log(JSON.stringify(result));
    `;
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd,
      env,
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);
    return `${result.stdout}\n${result.stderr}`;
  });
}

function runAboutJson(overrides: Record<string, string | undefined>): JsonRecord {
  return withProbeSandbox(overrides, ({ env, cwd }) => {
    const result = spawnSync(process.execPath, ["run", "src/cli.ts", "about", "--json"], {
      cwd: process.cwd(),
      env,
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `child exit=${result.status}`);
    }

    return JSON.parse(result.stdout.trim()) as JsonRecord;
  });
}

describe("P5.7-R37: imsg probe sunset", () => {
  it("config probe 不再暴露 imsg_path_set", () => {
    const result = runProbe(PROBE_CONFIG_URL, "probeConfig", {
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret_test",
    });

    const details = result.details as JsonRecord;
    expect(details.transports).toEqual(["feishu"]);
    expect(details).not.toHaveProperty("imsg_path_set");
  });

  it("legacy MSGCODE_TRANSPORTS=imsg 时，config probe 应直接报 sunset 错误", () => {
    const output = runProbeFailure(PROBE_CONFIG_URL, "probeConfig", {
      MSGCODE_ENV_BOOTSTRAPPED: "1",
      MSGCODE_TRANSPORTS: "imsg",
    });

    expect(output).toContain("MSGCODE_TRANSPORTS 已退役为 Feishu-only");
  });

  it("about --json 不再回显 imsgPath", () => {
    const info = runAboutJson({});

    expect(info).not.toHaveProperty("imsgPath");
    expect(typeof info.configPath).toBe("string");
  });
});

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG_MODULE_URL = pathToFileURL(path.join(process.cwd(), "src/config.ts")).href;
const LOAD_MANIFEST_MODULE_URL = pathToFileURL(path.join(process.cwd(), "src/deps/load.ts")).href;
const BIN_PATH = path.join(process.cwd(), "bin", "msgcode");

function withIsolatedEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: (ctx: { env: NodeJS.ProcessEnv; cwd: string; home: string }) => T
): T {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-feishu-only-home-"));
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-feishu-only-cwd-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".config", "msgcode"), { recursive: true });

    const env = { ...process.env };
    delete env.MSGCODE_TRANSPORTS;
    delete env.FEISHU_APP_ID;
    delete env.FEISHU_APP_SECRET;

    env.NODE_ENV = "test";
    env.HOME = tempHome;

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    return fn({ env, cwd: tempCwd, home: tempHome });
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
}

function readTransportsFromIsolatedProcess(overrides: Record<string, string | undefined>): string[] {
  return withIsolatedEnv(overrides, ({ env, cwd }) => {
    const script = `const mod = await import(${JSON.stringify(CONFIG_MODULE_URL)}); console.log(JSON.stringify(mod.config.transports));`;
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd,
      env,
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `child exit=${result.status}`);
    }

    return JSON.parse(result.stdout.trim());
  });
}

function readConfigErrorFromIsolatedProcess(overrides: Record<string, string | undefined>): string {
  return withIsolatedEnv(overrides, ({ env, cwd }) => {
    const script = `await import(${JSON.stringify(CONFIG_MODULE_URL)});`;
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd,
      env,
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);
    return `${result.stdout}\n${result.stderr}`;
  });
}

function readManifestSummaryFromIsolatedProcess(
  overrides: Record<string, string | undefined>
): { requiredForStart: string[]; optional: string[] } {
  return withIsolatedEnv(overrides, ({ env, cwd }) => {
    const script = `
      const { loadManifest } = await import(${JSON.stringify(LOAD_MANIFEST_MODULE_URL)});
      const manifest = await loadManifest();
      console.log(JSON.stringify({
        requiredForStart: manifest.requiredForStart.map((dep) => dep.id),
        optional: manifest.optional.map((dep) => dep.id),
      }));
    `;
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd,
      env,
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `child exit=${result.status}`);
    }

    return JSON.parse(result.stdout.trim());
  });
}

function runPreflightFromIsolatedProcess(
  overrides: Record<string, string | undefined>
): { requiredForStart: string[]; optional: string[]; status: string } {
  return withIsolatedEnv(overrides, ({ env, cwd }) => {
    const result = spawnSync(BIN_PATH, ["preflight", "--json"], {
      cwd,
      env,
      encoding: "utf-8",
    });

    if (!result.stdout.trim()) {
      throw new Error(result.stderr || `child exit=${result.status}`);
    }

    const parsed = JSON.parse(result.stdout);
    return {
      status: parsed.status,
      requiredForStart: parsed.data.preflight.requiredForStart.map((dep: { dependencyId: string }) => dep.dependencyId),
      optional: parsed.data.preflight.optional.map((dep: { dependencyId: string }) => dep.dependencyId),
    };
  });
}

describe("P5.7-R29: Feishu-only transport defaults", () => {
  it("有飞书凭据时，transport 仍固定为 feishu", () => {
    const transports = readTransportsFromIsolatedProcess({
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret_test",
    });

    expect(transports).toEqual(["feishu"]);
  });

  it("无飞书凭据时，transport 仍固定为 feishu", () => {
    const transports = readTransportsFromIsolatedProcess({});
    expect(transports).toEqual(["feishu"]);
  });

  it("显式 MSGCODE_TRANSPORTS=feishu 时，应保持 Feishu-only", () => {
    const transports = readTransportsFromIsolatedProcess({
      MSGCODE_TRANSPORTS: "feishu",
    });

    expect(transports).toEqual(["feishu"]);
  });

  it("显式 legacy MSGCODE_TRANSPORTS=imsg 时，应报 sunset 错误", () => {
    const output = readConfigErrorFromIsolatedProcess({
      MSGCODE_ENV_BOOTSTRAPPED: "1",
      MSGCODE_TRANSPORTS: "imsg",
    });

    expect(output).toContain("MSGCODE_TRANSPORTS 已退役为 Feishu-only");
    expect(output).toContain("imsg");
  });

  it("依赖清单应直接把飞书凭据列为启动必需，并移除 imsg/messages_db", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "src/deps/manifest.json"), "utf-8")
    ) as {
      requiredForStart: Array<{ id: string }>;
      optional: Array<{ id: string }>;
    };

    expect(manifest.requiredForStart.map((dep) => dep.id)).toEqual([
      "feishu_app_id",
      "feishu_app_secret",
    ]);
    expect(manifest.optional.map((dep) => dep.id)).not.toContain("imsg");
    expect(manifest.optional.map((dep) => dep.id)).not.toContain("messages_db");
  });

  it("loadManifest 不再动态提升 iMessage 依赖，只保留 Feishu-only 启动门槛", () => {
    const manifest = readManifestSummaryFromIsolatedProcess({});

    expect(manifest.requiredForStart).toEqual([
      "feishu_app_id",
      "feishu_app_secret",
    ]);
    expect(manifest.optional).not.toContain("imsg");
    expect(manifest.optional).not.toContain("messages_db");
  });

  it("CLI preflight 在 Feishu-only 场景下不应再列出 iMessage 依赖", () => {
    const preflight = runPreflightFromIsolatedProcess({});

    expect(preflight.requiredForStart).toEqual([
      "feishu_app_id",
      "feishu_app_secret",
    ]);
    expect(preflight.optional).not.toContain("imsg");
    expect(preflight.optional).not.toContain("messages_db");
  });
});

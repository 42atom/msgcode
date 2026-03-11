import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG_MODULE_URL = pathToFileURL(path.join(process.cwd(), "src/config.ts")).href;
const LOAD_MANIFEST_MODULE_URL = pathToFileURL(path.join(process.cwd(), "src/deps/load.ts")).href;
const BIN_PATH = path.join(process.cwd(), "bin", "msgcode");

function readTransportsFromIsolatedProcess(overrides: Record<string, string | undefined>): string[] {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-feishu-first-home-"));
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-feishu-first-cwd-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".config", "msgcode"), { recursive: true });

    const env = { ...process.env };
    delete env.MSGCODE_TRANSPORTS;
    delete env.FEISHU_APP_ID;
    delete env.FEISHU_APP_SECRET;
    delete env.IMSG_PATH;

    env.NODE_ENV = "test";
    env.HOME = tempHome;

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    const script = `const mod = await import(${JSON.stringify(CONFIG_MODULE_URL)}); console.log(JSON.stringify(mod.config.transports));`;
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd: tempCwd,
      env,
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `child exit=${result.status}`);
    }

    return JSON.parse(result.stdout.trim());
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
}

function readManifestSummaryFromIsolatedProcess(
  overrides: Record<string, string | undefined>,
  envFileContent?: string
): { requiredForStart: string[]; optional: string[] } {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-feishu-first-home-"));
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-feishu-first-cwd-"));

  try {
    const confDir = path.join(tempHome, ".config", "msgcode");
    fs.mkdirSync(confDir, { recursive: true });
    if (envFileContent) {
      fs.writeFileSync(path.join(confDir, ".env"), envFileContent, "utf-8");
    }

    const env = { ...process.env };
    delete env.MSGCODE_TRANSPORTS;
    delete env.FEISHU_APP_ID;
    delete env.FEISHU_APP_SECRET;
    delete env.IMSG_PATH;
    env.NODE_ENV = "test";
    env.HOME = tempHome;

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    const script = `
      const { loadManifest } = await import(${JSON.stringify(LOAD_MANIFEST_MODULE_URL)});
      const manifest = await loadManifest();
      console.log(JSON.stringify({
        requiredForStart: manifest.requiredForStart.map((dep) => dep.id),
        optional: manifest.optional.map((dep) => dep.id),
      }));
    `;
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd: tempCwd,
      env,
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `child exit=${result.status}`);
    }

    return JSON.parse(result.stdout.trim());
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
}

function runPreflightFromIsolatedProcess(
  overrides: Record<string, string | undefined>,
  envFileContent?: string
): { requiredForStart: string[]; optional: string[] } {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-feishu-first-home-"));
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-feishu-first-cwd-"));

  try {
    const confDir = path.join(tempHome, ".config", "msgcode");
    fs.mkdirSync(confDir, { recursive: true });
    if (envFileContent) {
      fs.writeFileSync(path.join(confDir, ".env"), envFileContent, "utf-8");
    }

    const env = { ...process.env };
    delete env.MSGCODE_TRANSPORTS;
    delete env.FEISHU_APP_ID;
    delete env.FEISHU_APP_SECRET;
    delete env.IMSG_PATH;
    env.NODE_ENV = "test";
    env.HOME = tempHome;

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    const result = spawnSync(BIN_PATH, ["preflight", "--json"], {
      cwd: tempCwd,
      env,
      encoding: "utf-8",
    });

    if (!result.stdout.trim()) {
      throw new Error(result.stderr || `child exit=${result.status}`);
    }

    const parsed = JSON.parse(result.stdout);
    return {
      requiredForStart: parsed.data.preflight.requiredForStart.map((dep: { dependencyId: string }) => dep.dependencyId),
      optional: parsed.data.preflight.optional.map((dep: { dependencyId: string }) => dep.dependencyId),
    };
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
}

describe("P5.7-R29: Feishu-first transport defaults", () => {
  it("有飞书凭据且未显式配置 MSGCODE_TRANSPORTS 时，应默认只启 feishu", () => {
    const transports = readTransportsFromIsolatedProcess({
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret_test",
    });

    expect(transports).toEqual(["feishu"]);
  });

  it("无飞书凭据时，应回退到 imsg 默认值", () => {
    const transports = readTransportsFromIsolatedProcess({
      IMSG_PATH: "/bin/echo",
    });

    expect(transports).toEqual(["imsg"]);
  });

  it("显式 MSGCODE_TRANSPORTS 时，应尊重用户配置", () => {
    const transports = readTransportsFromIsolatedProcess({
      MSGCODE_TRANSPORTS: "imsg, feishu",
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret_test",
      IMSG_PATH: "/bin/echo",
    });

    expect(transports).toEqual(["imsg", "feishu"]);
  });

  it("依赖清单中不应再把 imsg/messages_db 作为启动硬依赖", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "src/deps/manifest.json"), "utf-8")
    ) as {
      requiredForStart: Array<{ id: string }>;
      optional: Array<{ id: string }>;
    };

    expect(manifest.requiredForStart.map((dep) => dep.id)).not.toContain("imsg");
    expect(manifest.requiredForStart.map((dep) => dep.id)).not.toContain("messages_db");
    expect(manifest.optional.map((dep) => dep.id)).toContain("imsg");
    expect(manifest.optional.map((dep) => dep.id)).toContain("messages_db");
  });

  it("fallback-imsg 时，loadManifest 应把 imsg/messages_db 提升为启动必需", () => {
    const manifest = readManifestSummaryFromIsolatedProcess({});

    expect(manifest.requiredForStart).toContain("imsg");
    expect(manifest.requiredForStart).toContain("messages_db");
    expect(manifest.optional).not.toContain("imsg");
    expect(manifest.optional).not.toContain("messages_db");
  });

  it("feishu-only 时，loadManifest 不应把 iMessage 依赖提升为启动必需", () => {
    const manifest = readManifestSummaryFromIsolatedProcess({}, [
      "FEISHU_APP_ID=cli_test",
      "FEISHU_APP_SECRET=secret_test",
    ].join("\n"));

    expect(manifest.requiredForStart).not.toContain("imsg");
    expect(manifest.requiredForStart).not.toContain("messages_db");
    expect(manifest.optional).toContain("imsg");
    expect(manifest.optional).toContain("messages_db");
  });

  it("显式 imsg,feishu 双通道时，不应把 iMessage 再拉回全局启动硬门槛", () => {
    const manifest = readManifestSummaryFromIsolatedProcess({
      MSGCODE_TRANSPORTS: "imsg,feishu",
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret_test",
    });

    expect(manifest.requiredForStart).not.toContain("imsg");
    expect(manifest.requiredForStart).not.toContain("messages_db");
  });

  it("CLI preflight 在 fallback-imsg 场景下不应再显示 0/0 启动必需", () => {
    const preflight = runPreflightFromIsolatedProcess({});

    expect(preflight.requiredForStart).toContain("imsg");
    expect(preflight.requiredForStart).toContain("messages_db");
  });

  it("CLI preflight 在 feishu-only 场景下不应把 iMessage 依赖列为启动必需", () => {
    const preflight = runPreflightFromIsolatedProcess({}, [
      "FEISHU_APP_ID=cli_test",
      "FEISHU_APP_SECRET=secret_test",
    ].join("\n"));

    expect(preflight.requiredForStart).not.toContain("imsg");
    expect(preflight.requiredForStart).not.toContain("messages_db");
    expect(preflight.optional).toContain("imsg");
  });
});

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG_MODULE_URL = pathToFileURL(path.join(process.cwd(), "src/config.ts")).href;

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
});

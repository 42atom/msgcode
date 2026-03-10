import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG_MODULE_URL = pathToFileURL(path.join(process.cwd(), "src/config.ts")).href;

function readPrimaryOwnerIdsFromIsolatedProcess(overrides: Record<string, string | undefined>) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-primary-owner-home-"));
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-primary-owner-cwd-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".config", "msgcode"), { recursive: true });

    const env = { ...process.env };
    env.NODE_ENV = "production";
    env.HOME = tempHome;
    env.MY_EMAIL = "owner@example.com";
    env.FEISHU_APP_ID = "cli_test";
    env.FEISHU_APP_SECRET = "secret_test";

    delete env.MSGCODE_PRIMARY_OWNER_IMESSAGE_IDS;
    delete env.MSGCODE_PRIMARY_OWNER_FEISHU_IDS;
    delete env.MSGCODE_PRIMARY_OWNER_TELEGRAM_IDS;
    delete env.MSGCODE_PRIMARY_OWNER_DISCORD_IDS;

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    const script = `
      const mod = await import(${JSON.stringify(CONFIG_MODULE_URL)});
      console.log(JSON.stringify(mod.config.primaryOwnerIds));
    `;
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd: tempCwd,
      env,
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `child exit=${result.status}`);
    }

    return JSON.parse(result.stdout.trim()) as {
      imessage: string[];
      feishu: string[];
      telegram: string[];
      discord: string[];
    };
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
}

describe("P5.7-R31: channel primary owner ids", () => {
  it("应按渠道分别读取 primary owner ids", () => {
    const owners = readPrimaryOwnerIdsFromIsolatedProcess({
      MSGCODE_PRIMARY_OWNER_FEISHU_IDS: "ou_owner_1, ou_owner_2",
      MSGCODE_PRIMARY_OWNER_TELEGRAM_IDS: "12345678",
      MSGCODE_PRIMARY_OWNER_DISCORD_IDS: "9988776655",
    });

    expect(owners.feishu).toEqual(["ou_owner_1", "ou_owner_2"]);
    expect(owners.telegram).toEqual(["12345678"]);
    expect(owners.discord).toEqual(["9988776655"]);
    expect(owners.imessage).toEqual([]);
  });
});

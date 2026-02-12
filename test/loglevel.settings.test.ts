/**
 * msgcode: /loglevel（持久化层）最小单测
 *
 * 目标：
 * - 不改动全局 HOME / LOG_LEVEL（避免影响其它测试）
 * - 仅验证 settings.json 的落盘与读取
 * - 验证 getLogLevelSource 在 LOG_LEVEL 存在时返回 env
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const TEST_DIR = path.join(os.tmpdir(), `msgcode-test-config-${process.pid}-${Math.random().toString(16).slice(2)}`);

async function rmDirSafe(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("loglevel settings persistence", () => {
  beforeEach(async () => {
    process.env.MSGCODE_CONFIG_DIR = TEST_DIR;
    await rmDirSafe(TEST_DIR);
  });

  afterEach(async () => {
    delete process.env.MSGCODE_CONFIG_DIR;
    await rmDirSafe(TEST_DIR);
  });

  it("writes settings.json with logLevel", async () => {
    const { setLogLevel, readSettings } = await import("../src/config/settings.js");
    await setLogLevel("debug");

    const settings = await readSettings();
    expect(settings.logLevel).toBe("debug");

    const settingsFile = path.join(TEST_DIR, "settings.json");
    const exists = await fs.access(settingsFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("getLogLevelSource returns env when LOG_LEVEL is set", async () => {
    const old = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    try {
      const { getLogLevelSource } = await import("../src/logger/index.js");
      const { level, source } = getLogLevelSource();
      expect(source).toBe("env");
      expect(level).toBe("warn");
    } finally {
      if (old === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = old;
      }
    }
  });
});


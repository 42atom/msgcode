/**
 * msgcode: P5.7-R13 PinchTab 预启动回归锁
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ensurePinchtabReady,
  PinchtabBootstrapError,
} from "../src/browser/pinchtab-runtime.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("P5.7-R13: pinchtab bootstrap", () => {
  const originalBaseUrl = process.env.PINCHTAB_BASE_URL;
  const originalBinaryPath = process.env.PINCHTAB_BINARY_PATH;
  let tempDir = "";

  beforeEach(() => {
    tempDir = join(tmpdir(), `msgcode-pinchtab-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.PINCHTAB_BASE_URL;
    } else {
      process.env.PINCHTAB_BASE_URL = originalBaseUrl;
    }
    if (originalBinaryPath === undefined) {
      delete process.env.PINCHTAB_BINARY_PATH;
    } else {
      process.env.PINCHTAB_BINARY_PATH = originalBinaryPath;
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("本地 orchestrator 未启动时应自动拉起 PinchTab", async () => {
    const binaryPath = join(tempDir, "pinchtab-test");
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n", "utf-8");
    chmodSync(binaryPath, 0o755);

    process.env.PINCHTAB_BASE_URL = "http://127.0.0.1:9987";
    process.env.PINCHTAB_BINARY_PATH = binaryPath;

    let healthCalls = 0;
    const spawns: Array<{ command: string; args: string[] }> = [];

    const result = await ensurePinchtabReady({
      timeoutMs: 1200,
      fetchImpl: (async () => {
        healthCalls += 1;
        if (healthCalls < 3) {
          throw new Error("connect ECONNREFUSED 127.0.0.1:9987");
        }
        return jsonResponse({ status: "ok", mode: "dashboard" });
      }) as typeof fetch,
      spawnProcess: ((command, args) => {
        spawns.push({ command, args });
        return { unref() {} } as any;
      }) as NonNullable<Parameters<typeof ensurePinchtabReady>[0]>["spawnProcess"],
    });

    expect(result.startedByMsgcode).toBe(true);
    expect(result.baseUrl).toBe("http://127.0.0.1:9987");
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toEqual({
      command: binaryPath,
      args: ["serve", "--port=9987"],
    });
  });

  it("远端 baseUrl 不应尝试本地拉起 PinchTab", async () => {
    process.env.PINCHTAB_BASE_URL = "http://10.0.0.8:9867";
    process.env.PINCHTAB_BINARY_PATH = join(tempDir, "does-not-matter");

    let spawnCalled = false;

    await expect(
      ensurePinchtabReady({
        timeoutMs: 500,
        fetchImpl: (async () => {
          throw new Error("connect ETIMEDOUT 10.0.0.8:9867");
        }) as typeof fetch,
        spawnProcess: ((..._args) => {
          spawnCalled = true;
          return { unref() {} } as any;
        }) as NonNullable<Parameters<typeof ensurePinchtabReady>[0]>["spawnProcess"],
      })
    ).rejects.toBeInstanceOf(PinchtabBootstrapError);

    expect(spawnCalled).toBe(false);
  });
});

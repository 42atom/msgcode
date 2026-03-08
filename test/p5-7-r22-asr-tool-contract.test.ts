import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

describe("P5.7-R22: asr tool contract bridge", () => {
  let workspacePath = "";

  beforeEach(() => {
    workspacePath = join(tmpdir(), `msgcode-asr-${randomUUID()}`);
    mkdirSync(join(workspacePath, ".msgcode"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["asr"],
        "tooling.require_confirm": [],
      }),
      "utf-8"
    );
  });

  afterEach(() => {
    mock.restore();
    if (workspacePath && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("应优先接受 manifest 口径的 audioPath", async () => {
    const calls: Array<{ workspacePath: string; inputPath: string }> = [];

    mock.module("../src/runners/asr.js", () => ({
      runAsr: async (options: { workspacePath: string; inputPath: string }) => {
        calls.push(options);
        return {
          success: true,
          txtPath: join(workspacePath, "artifacts", "asr", "result.txt"),
        };
      },
    }));

    const { executeTool } = await import("../src/tools/bus.js");

    const result = await executeTool(
      "asr",
      { audioPath: "/tmp/test-audio.wav" },
      {
        workspacePath,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.inputPath).toBe("/tmp/test-audio.wav");
  });

  it("应继续兼容旧口径 inputPath", async () => {
    const calls: Array<{ workspacePath: string; inputPath: string }> = [];

    mock.module("../src/runners/asr.js", () => ({
      runAsr: async (options: { workspacePath: string; inputPath: string }) => {
        calls.push(options);
        return {
          success: true,
          txtPath: join(workspacePath, "artifacts", "asr", "legacy.txt"),
        };
      },
    }));

    const { executeTool } = await import("../src/tools/bus.js");

    const result = await executeTool(
      "asr",
      { inputPath: "/tmp/legacy-input.wav" },
      {
        workspacePath,
        source: "slash-command",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.inputPath).toBe("/tmp/legacy-input.wav");
  });
});

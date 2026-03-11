import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type EnvSnapshot = {
  ttsBackend: string | undefined;
  qwenRoot: string | undefined;
  qwenPython: string | undefined;
  qwenCustom: string | undefined;
  qwenClone: string | undefined;
};

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe("P5.7-R31: qwen-only tts mainline", () => {
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = {
      ttsBackend: process.env.TTS_BACKEND,
      qwenRoot: process.env.QWEN_TTS_ROOT,
      qwenPython: process.env.QWEN_TTS_PYTHON,
      qwenCustom: process.env.QWEN_TTS_MODEL_CUSTOM,
      qwenClone: process.env.QWEN_TTS_MODEL_CLONE,
    };
  });

  afterEach(() => {
    restoreEnv("TTS_BACKEND", snapshot.ttsBackend);
    restoreEnv("QWEN_TTS_ROOT", snapshot.qwenRoot);
    restoreEnv("QWEN_TTS_PYTHON", snapshot.qwenPython);
    restoreEnv("QWEN_TTS_MODEL_CUSTOM", snapshot.qwenCustom);
    restoreEnv("QWEN_TTS_MODEL_CLONE", snapshot.qwenClone);
  });

  it("probeTts 应忽略旧 TTS_BACKEND=indextts，并继续按 Qwen 主链检查", async () => {
    const root = join(tmpdir(), `msgcode-qwen-probe-${randomUUID()}`);
    const python = join(root, ".venv", "bin", "python");
    const custom = join(root, "models", "Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit");
    const clone = join(root, "models", "Qwen3-TTS-12Hz-0.6B-Base-8bit");

    mkdirSync(join(root, ".venv", "bin"), { recursive: true });
    mkdirSync(join(root, "models"), { recursive: true });
    writeFileSync(python, "");
    writeFileSync(custom, "");
    writeFileSync(clone, "");

    process.env.TTS_BACKEND = "indextts";
    process.env.QWEN_TTS_ROOT = root;
    process.env.QWEN_TTS_PYTHON = python;
    process.env.QWEN_TTS_MODEL_CUSTOM = custom;
    process.env.QWEN_TTS_MODEL_CLONE = clone;

    try {
      const { probeTts } = await import("../src/probe/probes/tts.js");
      const result = await probeTts();

      expect(result.status).toBe("pass");
      expect(result.message).toContain("已忽略旧 TTS_BACKEND=indextts");
      expect(result.details?.backend).toBe("auto:qwen");
      expect(result.details?.legacyBackendIgnored).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { __test as ttsTest } from "../src/runners/tts.js";
import type { TtsResult } from "../src/runners/tts/backends/types.js";
import { RuntimeRouterHandler, type HandlerContext } from "../src/handlers.js";
import type { InboundMessage } from "../src/imsg/types.js";

type EnvSnapshot = {
  ttsBackend: string | undefined;
  qwenRef: string | undefined;
  indexttsRef: string | undefined;
  statePath: string | undefined;
};

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function buildContext(chatId: string): HandlerContext {
  const inbound: InboundMessage = {
    id: `msg-${chatId}`,
    chatId,
    text: "/mode",
    isFromMe: false,
    sender: "tester@example.com",
    handle: "tester@example.com",
  };

  return {
    botType: "lmstudio",
    chatId,
    groupName: "contract",
    originalMessage: inbound,
  };
}

function buildBackendOptions(refAudioPath?: string) {
  return {
    workspacePath: "/tmp/msgcode-r2a",
    text: "contract-test",
    refAudioPath,
    artifactId: "artifact-r2a",
    wavPath: "/tmp/msgcode-r2a.wav",
    m4aPath: "/tmp/msgcode-r2a.m4a",
    outFormat: "wav" as const,
    timeoutMs: 1000,
  };
}

describe("P5.6.13-R2A: TTS Qwen 合同收口", () => {
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = {
      ttsBackend: process.env.TTS_BACKEND,
      qwenRef: process.env.QWEN_TTS_REF_AUDIO,
      indexttsRef: process.env.INDEXTTS_REF_AUDIO,
      statePath: process.env.STATE_FILE_PATH,
    };
    process.env.STATE_FILE_PATH = join(tmpdir(), `msgcode-state-r2a-${randomUUID()}.json`);
  });

  afterEach(() => {
    const tempStatePath = process.env.STATE_FILE_PATH;
    if (tempStatePath) {
      rmSync(tempStatePath, { force: true });
    }

    restoreEnv("TTS_BACKEND", snapshot.ttsBackend);
    restoreEnv("QWEN_TTS_REF_AUDIO", snapshot.qwenRef);
    restoreEnv("INDEXTTS_REF_AUDIO", snapshot.indexttsRef);
    restoreEnv("STATE_FILE_PATH", snapshot.statePath);
  });

  it("坏 ref + fallback 模式 => fail（不得回退）", async () => {
    let indexttsCalls = 0;
    const result = await ttsTest.executeWithBackends({
      options: buildBackendOptions("/tmp/invalid-ref.wav"),
      priorityBackends: ttsTest.resolvePriorityBackends(""),
      backends: [
        {
          name: "qwen",
          run: async (): Promise<TtsResult> => ({
            success: false,
            backend: "qwen",
            error: "QWEN_TTS_REF_AUDIO 不存在: /tmp/invalid-ref.wav",
          }),
        },
        {
          name: "indextts",
          run: async (): Promise<TtsResult> => {
            indexttsCalls += 1;
            return {
              success: true,
              backend: "indextts",
              audioPath: "/tmp/indextts-ok.m4a",
            };
          },
        },
      ],
    });

    expect(indexttsCalls).toBe(0);
    expect(result.result).toBeUndefined();
    expect(result.lastError).toContain("QWEN_TTS_REF_AUDIO 不存在");
  });

  it("无 ref + fallback 模式 => qwen 失败时允许回退 indextts", async () => {
    let indexttsCalls = 0;
    const result = await ttsTest.executeWithBackends({
      options: buildBackendOptions(),
      priorityBackends: ttsTest.resolvePriorityBackends(""),
      backends: [
        {
          name: "qwen",
          run: async (): Promise<TtsResult> => ({
            success: false,
            backend: "qwen",
            error: "Qwen Python 不存在: /tmp/missing-python",
          }),
        },
        {
          name: "indextts",
          run: async (): Promise<TtsResult> => {
            indexttsCalls += 1;
            return {
              success: true,
              backend: "indextts",
              audioPath: "/tmp/indextts-fallback.m4a",
            };
          },
        },
      ],
    });

    expect(indexttsCalls).toBe(1);
    expect(result.backend).toBe("indextts");
    expect(result.result?.success).toBe(true);
    expect(result.result?.audioPath).toBe("/tmp/indextts-fallback.m4a");
  });

  it("/mode 输出必须与执行模式一致（strict/fallback）", async () => {
    const handler = new RuntimeRouterHandler();
    const cases = [
      { envValue: "qwen", expected: "strict:qwen" },
      { envValue: "indextts", expected: "strict:indextts" },
      { envValue: "", expected: "fallback:qwen->indextts" },
    ];

    for (const item of cases) {
      if (item.envValue) {
        process.env.TTS_BACKEND = item.envValue;
      } else {
        delete process.env.TTS_BACKEND;
      }

      const chatId = `chat-${item.expected}`;
      const result = await handler.handle("/mode", buildContext(chatId));

      expect(result.success).toBe(true);
      expect(result.response).toContain(`TTS: mode=${item.expected}`);
    }
  });
});

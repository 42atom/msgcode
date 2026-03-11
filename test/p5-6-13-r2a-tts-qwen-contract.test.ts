import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { __test as ttsTest } from "../src/runners/tts.js";
import type { TtsResult } from "../src/runners/tts/backends/types.js";
import { RuntimeRouterHandler, type HandlerContext } from "../src/handlers.js";
import type { InboundMessage } from "../src/imsg/types.js";

type EnvSnapshot = {
  ttsBackend: string | undefined;
  agentBackend: string | undefined;
  qwenRef: string | undefined;
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
      agentBackend: process.env.AGENT_BACKEND,
      qwenRef: process.env.QWEN_TTS_REF_AUDIO,
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
    restoreEnv("AGENT_BACKEND", snapshot.agentBackend);
    restoreEnv("QWEN_TTS_REF_AUDIO", snapshot.qwenRef);
    restoreEnv("STATE_FILE_PATH", snapshot.statePath);
  });

  it("坏 ref => fail（单后端直接失败）", async () => {
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
      ],
    });

    expect(result.result).toBeUndefined();
    expect(result.lastError).toContain("QWEN_TTS_REF_AUDIO 不存在");
  });

  it("无 ref + qwen 失败 => 直接 fail（不得回退 indextts）", async () => {
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
      ],
    });

    expect(result.result).toBeUndefined();
    expect(result.lastError).toContain("Qwen Python 不存在");
  });

  it("/mode 输出必须与执行模式一致（strict/auto）", async () => {
    const handler = new RuntimeRouterHandler();
    const cases = [
      { envValue: "qwen", expected: "strict:qwen" },
      { envValue: "indextts", expected: "auto:qwen" },
      { envValue: "", expected: "auto:qwen" },
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

  it("workspace 当前分支的 tts-model 应优先于 TTS_BACKEND 环境变量", async () => {
    const workspacePath = join(tmpdir(), `msgcode-tts-config-${randomUUID()}`);
    mkdirSync(join(workspacePath, ".msgcode"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({ "model.local.tts": "qwen" }, null, 2),
      "utf-8",
    );

    process.env.TTS_BACKEND = "indextts";
    process.env.AGENT_BACKEND = "agent-backend";

    try {
      const selection = await ttsTest.resolveTtsBackendSelection({
        workspacePath,
        model: undefined,
      });
      expect(selection.backendMode).toBe("qwen");
      expect(selection.source).toBe("workspace");
      expect(selection.configuredValue).toBe("qwen");
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});

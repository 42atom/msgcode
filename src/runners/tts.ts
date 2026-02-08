/**
 * msgcode: 本地 TTS Runner（统一后端切换入口）
 *
 * 目标：
 * - 输入文本 → 生成音频文件 → 返回路径（供 iMessage 发送附件）
 * - 后端：IndexTTS（默认）
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { TtsBackend, TtsOptions, TtsResult, TtsBackendContext } from "./tts/backends/types.js";
import { logger } from "../logger/index.js";

// ============================================
// Backend Registry
// ============================================

interface BackendRunner {
  name: TtsBackend;
  run: (options: TtsOptions & TtsBackendContext) => Promise<TtsResult>;
}

const BACKENDS: BackendRunner[] = [
  {
    name: "indextts",
    run: async (opts) => (await import("./tts/backends/indexts.js")).runIndexTts(opts),
  },
];

// ============================================
// Main Entry Point
// ============================================

/**
 * Run TTS with backend switching
 *
 * @param options TTS options
 * @returns TTS result with audio path
 */
export async function runTts(options: TtsOptions): Promise<TtsResult> {
  // P0: 全局串行（稳定优先）
  // 原因：IndexTTS 在 MPS/统一内存下峰值非常高；跨 chat 并发 TTS 会极易触发 SIGKILL。
  // 这里把所有 TTS（显式 /tts 与自动语音 defer）统一串行化。
  const maxConcurrency = (() => {
    const raw = (process.env.TTS_MAX_CONCURRENCY || "").trim();
    if (!raw) return 1;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(4, Math.floor(n)));
  })();

  if (maxConcurrency <= 1) {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return await enqueueGlobalTts(() => runTtsInternal(options));
  }
  // 未来扩展：>1 并发
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  return await runTtsInternal(options);
}

let globalTtsQueue: Promise<void> = Promise.resolve();

async function enqueueGlobalTts<T>(fn: () => Promise<T>): Promise<T> {
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => { resolveDone = () => r(); });

  const prev = globalTtsQueue;
  globalTtsQueue = prev.catch(() => {}).then(() => done);

  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    resolveDone();
  }
}

async function runTtsInternal(options: TtsOptions): Promise<TtsResult> {
  const text = options.text || "";
  if (!text.trim()) {
    return { success: false, error: "缺少 text" };
  }

  const t0 = Date.now();
  const textDigest = createHash("sha256").update(text).digest("hex").slice(0, 12);

  const workspacePath = resolve(options.workspacePath);
  const artifactId = randomUUID().replace(/-/g, "").slice(0, 12);
  const artifactsDir = join(workspacePath, "artifacts", "tts");
  await mkdir(artifactsDir, { recursive: true });

  const base = join(artifactsDir, artifactId);
  const wavPath = `${base}.wav`;
  const outFormat = options.format || "m4a";
  const m4aPath = `${base}.m4a`;

  const envTimeoutMs = (() => {
    const raw = process.env.TTS_TIMEOUT_MS;
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n <= 0) return null;
    return Math.floor(n);
  })();

  const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : (envTimeoutMs ?? 120_000);

  logger.info("TTS 开始", {
    module: "tts",
    artifactId,
    workspacePath,
    textLen: text.length,
    textDigest,
    timeoutMs,
    format: outFormat,
  });

  // Backend context (shared across all backends)
  const backendContext: TtsBackendContext = {
    workspacePath,
    text,
    artifactId,
    wavPath,
    m4aPath,
    outFormat,
    timeoutMs,
  };

  // Only backend: indextts
  const priorityBackends: TtsBackend[] = ["indextts"];

  // Try backends in priority order
  let lastError: string | undefined;
  for (const backendName of priorityBackends) {
    const backend = BACKENDS.find(b => b.name === backendName);
    if (!backend) continue;

    try {
      const result = await backend.run({
        ...options,
        ...backendContext,
      });

      if (result.success) {
        // best-effort: file size
        let audioSizeBytes: number | undefined;
        try {
          if (result.audioPath) {
            const { stat } = await import("node:fs/promises");
            audioSizeBytes = (await stat(result.audioPath)).size;
          }
        } catch {
          // ignore
        }

        logger.info("TTS 完成", {
          module: "tts",
          artifactId,
          backend: backend.name,
          durationMs: Date.now() - t0,
          audioPath: result.audioPath,
          audioSizeBytes,
        });
        return { ...result, backend: backend.name };
      }

      // Store error for next fallback attempt
      lastError = result.error;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // All backends failed
  logger.warn("TTS 失败", {
    module: "tts",
    artifactId,
    durationMs: Date.now() - t0,
    error: lastError || "unknown",
  });
  return {
    success: false,
    artifactId,
    error: lastError || "所有 TTS 后端均失败",
  };
}

// ============================================
// Re-exports for compatibility
// ============================================

export type { TtsBackend, TtsOptions, TtsResult };

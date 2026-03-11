/**
 * msgcode: 本地 TTS Runner（统一后端切换入口）
 *
 * 目标：
 * - 输入文本 → 生成音频文件 → 返回路径（供 iMessage 发送附件）
 * - 主链：Qwen3-TTS（唯一正式后端）
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { TtsBackend, TtsOptions, TtsResult, TtsBackendContext } from "./tts/backends/types.js";
import { logger } from "../logger/index.js";
import { getCurrentLaneModel } from "../config/workspace.js";

// ============================================
// Backend Registry
// ============================================

interface BackendRunner {
  name: TtsBackend;
  run: (options: TtsOptions & TtsBackendContext) => Promise<TtsResult>;
}

type BackendExecutionInput = {
  options: TtsOptions & TtsBackendContext;
  priorityBackends: readonly TtsBackend[];
  backends: readonly BackendRunner[];
};

type BackendExecutionResult = {
  result?: TtsResult;
  backend?: TtsBackend;
  lastError?: string;
};

function shouldAbortFallback(backendName: TtsBackend, error?: string): boolean {
  if (backendName !== "qwen") return false;
  const msg = (error || "").trim();
  if (!msg) return false;

  // Qwen ref-audio path is explicitly configured but invalid.
  // Do not hide this misconfiguration behind fallback backends.
  return msg.includes("QWEN_TTS_REF_AUDIO 不存在");
}

function resolvePriorityBackends(rawBackendMode: string): TtsBackend[] {
  const backendMode = rawBackendMode.trim().toLowerCase();
  if (backendMode === "qwen") return ["qwen"];
  return ["qwen"];
}

function normalizeConfiguredTtsBackend(raw: string | undefined): TtsBackend | undefined {
  const normalized = (raw || "").trim().toLowerCase();
  if (normalized === "qwen") {
    return normalized;
  }
  return undefined;
}

type TtsBackendSelection = {
  backendMode: "" | TtsBackend;
  source: "options" | "workspace" | "env" | "default";
  configuredValue?: string;
};

async function resolveTtsBackendSelection(
  options: Pick<TtsOptions, "workspacePath" | "model">
): Promise<TtsBackendSelection> {
  const explicitBackend = normalizeConfiguredTtsBackend(options.model);
  if (explicitBackend) {
    return {
      backendMode: explicitBackend,
      source: "options",
      configuredValue: options.model?.trim(),
    };
  }

  const workspaceModel = await getCurrentLaneModel(options.workspacePath, "tts");
  const workspaceBackend = normalizeConfiguredTtsBackend(workspaceModel);
  if (workspaceBackend) {
    return {
      backendMode: workspaceBackend,
      source: "workspace",
      configuredValue: workspaceModel,
    };
  }

  const envBackend = normalizeConfiguredTtsBackend(process.env.TTS_BACKEND);
  if (envBackend) {
    return {
      backendMode: envBackend,
      source: "env",
      configuredValue: process.env.TTS_BACKEND,
    };
  }

  return {
    backendMode: "",
    source: "default",
  };
}

async function executeWithBackends(input: BackendExecutionInput): Promise<BackendExecutionResult> {
  let lastError: string | undefined;

  for (const backendName of input.priorityBackends) {
    const backend = input.backends.find((b) => b.name === backendName);
    if (!backend) continue;

    try {
      const result = await backend.run(input.options);
      if (result.success) {
        return { result, backend: backend.name };
      }
      lastError = result.error;
      if (shouldAbortFallback(backendName, result.error)) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (shouldAbortFallback(backendName, lastError)) break;
    }
  }

  return { lastError };
}

const BACKENDS: BackendRunner[] = [
  {
    name: "qwen",
    run: async (opts) => (await import("./tts/backends/qwen.js")).runQwenTts(opts),
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
  // 原因：本地 TTS 模型峰值高；跨 chat 并发 TTS 仍可能造成统一内存抖动。
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

  const ttsBackendSelection = await resolveTtsBackendSelection(options);

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
    backendMode: ttsBackendSelection.backendMode ? "strict:qwen" : "auto:qwen",
    backendSource: ttsBackendSelection.source,
    backendConfiguredValue: ttsBackendSelection.configuredValue,
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

  // Backend priority:
  // - TTS_BACKEND=qwen -> strict qwen only
  // - unset/other      -> auto:qwen
  const priorityBackends = resolvePriorityBackends(ttsBackendSelection.backendMode);

  const execResult = await executeWithBackends({
    options: {
      ...options,
      ...backendContext,
    },
    priorityBackends,
    backends: BACKENDS,
  });

  if (execResult.result && execResult.backend) {
    // best-effort: file size
    let audioSizeBytes: number | undefined;
    try {
      if (execResult.result.audioPath) {
        const { stat } = await import("node:fs/promises");
        audioSizeBytes = (await stat(execResult.result.audioPath)).size;
      }
    } catch {
      // ignore
    }

    logger.info("TTS 完成", {
      module: "tts",
      artifactId,
      backend: execResult.backend,
      durationMs: Date.now() - t0,
      audioPath: execResult.result.audioPath,
      audioSizeBytes,
    });
    return { ...execResult.result, backend: execResult.backend };
  }

  // All backends failed
  logger.warn("TTS 失败", {
    module: "tts",
    artifactId,
    durationMs: Date.now() - t0,
    error: execResult.lastError || "unknown",
  });
  return {
    success: false,
    artifactId,
    error: execResult.lastError || "所有 TTS 后端均失败",
  };
}

// ============================================
// Re-exports for compatibility
// ============================================

export type { TtsBackend, TtsOptions, TtsResult };

// Test hooks: keep pure and side-effect free.
export const __test = {
  shouldAbortFallback,
  resolvePriorityBackends,
  executeWithBackends,
  normalizeConfiguredTtsBackend,
  resolveTtsBackendSelection,
};

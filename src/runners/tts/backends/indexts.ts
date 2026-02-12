/**
 * msgcode: TTS Backend - IndexTTS
 *
 * IndexTTS backend using local Python installation with emotion vector support
 *
 * Environment variables:
 * - INDEX_TTS_ROOT: Root directory of IndexTTS repository
 * - INDEX_TTS_MODEL_DIR: Model checkpoints directory (default: $INDEX_TTS_ROOT/checkpoints)
 * - INDEX_TTS_CONFIG: Config file path (default: $INDEX_TTS_ROOT/checkpoints/config.yaml)
 * - INDEX_TTS_DEVICE: Device to use (cpu/cuda/mps/xpu)
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { TtsOptions, TtsBackendContext, TtsResult } from "./types.js";
import { convertWavToM4a, normalizeTtsText, resolveRefAudioToWav, runCmd, runCmdCapture } from "../utils.js";
import { analyzeEmotionVector, segmentTextForEmotion, type EmotionAnalysisResult, type EmotionVector, formatEmotionVector, parseEmotionVector } from "../emotion.js";
import { IndexTtsWorkerClient } from "./indexts-worker.js";
import { logger } from "../../../logger/index.js";

// ============================================
// Constants
// ============================================

const DEFAULT_INDEX_TTS_DEVICE = "mps";
// P0: 默认关闭常驻 worker（稳定优先）。
// - 常驻 worker 在 MPS/统一内存环境下容易出现 footprint 单边上涨，最终触发 SIGKILL。
// - 如你确认机器稳定且更追求速度，可在 ~/.config/msgcode/.env 显式设置：
//   INDEX_TTS_USE_WORKER=1
const DEFAULT_INDEX_TTS_USE_WORKER = "0";

let workerClient: IndexTtsWorkerClient | null = null;
let completedTtsJobs = 0;

function buildStableWorkerEnv(device: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // P0: 性能优化默认值（基于实测：PyTorch 2.10.0 + MPS）
  // - FP16=0: 精度模式切换，速度更稳定，内存更可控
  // - NUM_BEAMS=1: 降低解码成本，质量一般可接受
  // - DIFFUSION_STEPS=15: 20→15 理论上有 25% 加速空间（还可进一步试 12/10）
  // 允许用户通过 ~/.config/msgcode/.env 显式覆盖。
  if (!env.INDEX_TTS_MAX_SEQ_LENGTH) env.INDEX_TTS_MAX_SEQ_LENGTH = "4096";
  if (!env.INDEX_TTS_NUM_BEAMS) env.INDEX_TTS_NUM_BEAMS = "1";
  if (!env.INDEX_TTS_DIFFUSION_STEPS) env.INDEX_TTS_DIFFUSION_STEPS = "15";

  // MPS: 默认关闭 fp16（稳定性优先），用户可显式设 1 开启
  if (device === "mps" && !env.INDEX_TTS_FP16) env.INDEX_TTS_FP16 = "0";

  return env;
}

function shouldUseFp16FromEnv(env: NodeJS.ProcessEnv, device: string): boolean {
  const raw = (env.INDEX_TTS_FP16 || "").trim();
  if (raw) return raw === "1";
  return device === "mps";
}

function splitByMaxChars(text: string, maxChars: number): string[] {
  const s = (text || "").trim();
  if (!s) return [];
  if (s.length <= maxChars) return [s];
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += maxChars) {
    chunks.push(s.slice(i, i + maxChars));
  }
  return chunks.filter(Boolean);
}

function getMinSegmentTimeoutMs(): number {
  const raw = (process.env.INDEX_TTS_SEGMENT_TIMEOUT_MS_MIN || "").trim();
  // P0: 默认更保守（180s），避免“短句 OK / 长句经常超时”。
  // 如果你更追求速度，可显式调小该值。
  if (!raw) return 180_000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 180_000;
  return Math.max(10_000, Math.floor(n));
}

function shouldRetryWorkerError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  // 常见“可恢复”错误：
  // - worker 被系统杀死（SIGKILL）
  // - Node 侧超时（request timeout）
  // - worker exited（close 事件抛出）
  return /worker exited|SIGKILL|request timeout|timeout/i.test(msg);
}

function isNanProbabilityError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /probability tensor contains|inf|nan|element < 0/i.test(msg);
}

async function restartWorker(paths: ReturnType<typeof resolveIndexTtsPaths>): Promise<void> {
  if (!workerClient) return;
  try {
    await workerClient.stop();
  } catch {
    // ignore
  }
  // 立即触发下一次 ensureStarted()
  workerClient = new IndexTtsWorkerClient({
    python: paths.python,
    workerScript: paths.workerScript,
    env: buildStableWorkerEnv(paths.device),
  });
}

function looksLikePythonFatalError(stderr: string): boolean {
  const s = (stderr || "").trim();
  if (!s) return false;
  if (s.includes("Traceback (most recent call last):")) return true;
  // 只把明确的 "ERROR:" 当成失败，避免把 warning 当成 error
  if (/(^|\n)ERROR:/.test(s)) return true;
  // 一些环境会只打印异常名而不带完整 Traceback（保守兜底）
  if (/(^|\n)(RuntimeError|ValueError|ImportError|ModuleNotFoundError|AssertionError|OSError|TypeError):/.test(s)) {
    return true;
  }
  return false;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Resolve IndexTTS environment paths
 */
function resolveIndexTtsPaths(): {
  root: string;
  python: string;
  modelDir: string;
  config: string;
  cliScript: string;
  workerScript: string;
  device: string;
} {
  function expandHome(p: string): string {
    const home = process.env.HOME;
    if (!home) return p;
    if (p === "~") return home;
    if (p.startsWith("~/")) return join(home, p.slice(2));
    return p;
  }

  const root = process.env.INDEX_TTS_ROOT
    ? resolve(expandHome(process.env.INDEX_TTS_ROOT))
    : resolve(process.env.HOME || "~", "Models", "index-tts");

  const python = process.env.INDEX_TTS_PYTHON ? expandHome(process.env.INDEX_TTS_PYTHON) : join(root, ".venv/bin/python");

  const modelDir = process.env.INDEX_TTS_MODEL_DIR
    ? resolve(expandHome(process.env.INDEX_TTS_MODEL_DIR.replace("$INDEX_TTS_ROOT", root)))
    : join(root, "checkpoints");

  const config = process.env.INDEX_TTS_CONFIG
    ? resolve(expandHome(process.env.INDEX_TTS_CONFIG.replace("$INDEX_TTS_ROOT", root)))
    : join(root, "checkpoints", "config.yaml");

  const cliScript = resolve(process.cwd(), "scripts/indexts_cli.py");
  const workerScript = resolve(process.cwd(), "scripts/indexts_worker.py");

  const device = process.env.INDEX_TTS_DEVICE || DEFAULT_INDEX_TTS_DEVICE;

  return { root, python, modelDir, config, cliScript, workerScript, device };
}

function getIndexTtsWorker(params: { python: string; workerScript: string }): IndexTtsWorkerClient {
  if (workerClient) return workerClient;
  const device = process.env.INDEX_TTS_DEVICE || DEFAULT_INDEX_TTS_DEVICE;
  workerClient = new IndexTtsWorkerClient({
    python: params.python,
    workerScript: params.workerScript,
    env: buildStableWorkerEnv(device),
  });
  return workerClient;
}

function readEnvInt(name: string, fallback: number): number {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

async function getProcessRssMb(pid: number, timeoutMs: number): Promise<number | null> {
  try {
    const { stdout } = await runCmdCapture({
      cmd: "ps",
      args: ["-o", "rss=", "-p", String(pid)],
      timeoutMs: Math.min(Math.max(500, timeoutMs), 3000),
    });
    const kb = Number(String(stdout || "").trim());
    if (!Number.isFinite(kb) || kb <= 0) return null;
    return kb / 1024;
  } catch {
    return null;
  }
}

function shouldUseWorkerForText(text: string): boolean {
  const raw = (process.env.INDEX_TTS_WORKER_MAX_TEXT_CHARS || "").trim();
  // P0: 默认只让 worker 处理“中短文本”，长文本走一次性进程，避免 MPS/driver 缓存一路抬升直到爆。
  if (!raw) return text.length <= 480;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return true;
  return text.length <= Math.floor(n);
}

async function maybeRecycleWorkerAfterJob(params: { paths: ReturnType<typeof resolveIndexTtsPaths>; timeoutMs: number }): Promise<void> {
  const useWorker = (process.env.INDEX_TTS_USE_WORKER || DEFAULT_INDEX_TTS_USE_WORKER) !== "0";
  if (!useWorker || !workerClient) return;

  completedTtsJobs += 1;

  const recycleEveryJobs = readEnvInt("INDEX_TTS_WORKER_RECYCLE_EVERY_JOBS", 0);
  // P0: 默认启用“软回收”以避免长跑内存持续增长（macOS/MPS 常见现象）。
  // - 若用户显式设为 0，则关闭该策略。
  // - 阈值取“稳定优先”：超过 4.5GB 触发（避免长跑越堆越大直到 SIGKILL）。
  const recycleRssMb = readEnvInt("INDEX_TTS_WORKER_RECYCLE_RSS_MB", 4500);

  let reason: string | null = null;

  if (recycleEveryJobs > 0 && completedTtsJobs % recycleEveryJobs === 0) {
    reason = `every_jobs=${recycleEveryJobs}`;
  }

  if (!reason && recycleRssMb > 0) {
    const pid = workerClient.getPid();
    if (pid) {
      const rssMb = await getProcessRssMb(pid, params.timeoutMs);
      if (typeof rssMb === "number" && rssMb > recycleRssMb) {
        reason = `rss_mb=${rssMb.toFixed(0)}>${recycleRssMb}`;
      }
    }
  }

  // P0: RSS 不包含 MPS driver cache；用 worker.ping() 读取 driver_allocated 并按比例回收
  if (!reason) {
    try {
      const r = await workerClient.ping(1500);
      const mps = (r.mps as unknown) as { driverAllocatedBytes?: number; recommendedMaxBytes?: number } | undefined;
      const driver = typeof mps?.driverAllocatedBytes === "number" ? mps.driverAllocatedBytes : null;
      const recommended = typeof mps?.recommendedMaxBytes === "number" ? mps.recommendedMaxBytes : null;
      if (driver && recommended && recommended > 0) {
        const ratio = driver / recommended;
        const threshold = (() => {
          const raw = (process.env.INDEX_TTS_WORKER_RECYCLE_MPS_RATIO || "").trim();
          if (!raw) return 0.72; // 默认 72% 触发回收（稳定优先）
          const n = Number(raw);
          if (!Number.isFinite(n)) return 0.72;
          return Math.max(0.2, Math.min(0.95, n));
        })();
        if (ratio >= threshold) {
          reason = `mps_ratio=${(ratio * 100).toFixed(0)}%>=${Math.round(threshold * 100)}%`;
        }
        logger.debug("IndexTTS worker MPS stats", {
          module: "indextts",
          driverAllocatedBytes: driver,
          recommendedMaxBytes: recommended,
          ratio,
          threshold,
        });
      }
    } catch {
      // ignore ping failures
    }
  }

  if (!reason) return;

  // P0: 只做“安全回收”——排队到 idle 后优雅 shutdown，避免 SIGKILL。
  // 目的：缓解 MPS/torch 长跑“看起来越跑越大”的问题，提升稳定性。
  logger.info("IndexTTS worker recycle scheduled", { module: "indextts", reason });
  workerClient.shutdownWhenIdle();
}

function normalizeIndexTtsSpeed(speed: unknown): number {
  if (typeof speed === "number" && Number.isFinite(speed)) {
    return speed >= 1 ? 1 : 0;
  }
  const env = process.env.INDEX_TTS_SPEED;
  if (!env) return 1;
  const n = Number(env);
  if (!Number.isFinite(n)) return 1;
  return n >= 1 ? 1 : 0;
}

/**
 * Synthesize a single text segment with IndexTTS
 */
async function synthesizeSegment(params: {
  text: string;
  voicePrompt: string;
  outputPath: string;
  emotionVector?: number[];
  emotionAlpha: number;
  speed: number;
  python: string;
  cliScript: string;
  workerScript: string;
  modelDir: string;
  config: string;
  device: string;
  timeoutMs: number;
}): Promise<TtsResult> {
  const useWorker = (process.env.INDEX_TTS_USE_WORKER || DEFAULT_INDEX_TTS_USE_WORKER) !== "0";
  if (useWorker) {
    try {
      const worker = getIndexTtsWorker({ python: params.python, workerScript: params.workerScript });
      await worker.synthesize({
        text: params.text,
        voicePrompt: params.voicePrompt,
        outWav: params.outputPath,
        emotionVector: params.emotionVector,
        emotionAlpha: params.emotionAlpha,
        speed: params.speed,
        intervalSilenceMs: parseInt(process.env.INDEX_TTS_INTERVAL_SILENCE_MS || "200", 10),
        timeoutMs: params.timeoutMs,
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const args = [
    params.cliScript,
    "--text", params.text,
    "--voice-prompt", params.voicePrompt,
    "--out", params.outputPath,
    "--config", params.config,
    "--model-dir", params.modelDir,
    "--device", params.device,
    "--emo-alpha", String(params.emotionAlpha),
    "--speed", String(params.speed >= 1 ? 1 : 0),
  ];

  // P0: CLI wrapper 需要显式传 --fp16（仅设置 env 不会生效）
  const stableEnv = buildStableWorkerEnv(params.device);
  if (shouldUseFp16FromEnv(stableEnv, params.device)) {
    args.push("--fp16");
  }

  if (params.emotionVector) {
    args.push("--emo-vector", JSON.stringify(params.emotionVector));
  }

  const result = await runCmdCapture({
    cmd: params.python,
    args,
    timeoutMs: params.timeoutMs,
    // P0: CLI 路径也必须应用“稳定默认值”，否则会落回上游默认（8192/3/25）导致 OOM/慢/数值不稳。
    env: stableEnv,
  });

  if (!result.ok) {
    return {
      success: false,
      error: result.error || "TTS synthesis failed",
    };
  }

  // Check for Python errors in stderr
  const pythonErr = (result.stderr || "").trim();
  if (looksLikePythonFatalError(pythonErr)) {
    return {
      success: false,
      error: pythonErr.slice(0, 800) || "TTS synthesis failed",
    };
  }

  return { success: true };
}

/**
 * Concatenate multiple WAV files into one
 */
async function concatWavFiles(inputPaths: string[], outputPath: string, timeoutMs: number): Promise<boolean> {
  if (inputPaths.length === 0) return false;
  if (inputPaths.length === 1) {
    // Single file: just copy
    const { copyFile } = await import("node:fs/promises");
    await copyFile(inputPaths[0], outputPath);
    return true;
  }

  // Multiple files: use ffmpeg concat
  const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";

  // Create concat list file
  const listPath = `${outputPath}.txt`;
  const listContent = inputPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");

  const { writeFile } = await import("node:fs/promises");
  await writeFile(listPath, listContent);

  const result = await runCmd({
    cmd: ffmpeg,
    args: [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      outputPath,
    ],
    timeoutMs,
  });

  // Clean up list file
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(listPath);
  } catch {
    // Ignore cleanup errors
  }

  return result.ok;
}

// ============================================
// Main TTS Function
// ============================================

export async function runIndexTts(options: TtsOptions & TtsBackendContext): Promise<TtsResult> {
  const text = normalizeTtsText(options.text || "");
  if (!text) return { success: false, artifactId: options.artifactId, backend: "indextts", error: "缺少 text" };

  // Resolve IndexTTS paths
  const paths = resolveIndexTtsPaths();

  try {
    // Resolve voice prompt (convert to WAV if needed)
    const refAudio = (options.refAudioPath || process.env.INDEXTTS_REF_AUDIO || "").trim();
    const resolvedRefAudio = await resolveRefAudioToWav(refAudio, options.timeoutMs);

    if (!resolvedRefAudio) {
      return {
        success: false,
        artifactId: options.artifactId,
        backend: "indextts",
        error: "Voice prompt not found or invalid (set INDEXTTS_REF_AUDIO or refAudioPath)",
      };
    }

    // Get emotion settings
    const emotionAlpha = typeof options.emotionAlpha === "number"
      ? options.emotionAlpha
      : parseFloat(process.env.INDEX_TTS_EMO_ALPHA || process.env.INDEXTTS_EMO_ALPHA || "0.6");

    let emotionResult: EmotionAnalysisResult | null = null;

    // Determine emotion mode
    // P0: 默认避免走 IndexTTS 内置 emo_text（慢且易抖）。仅在 options.emotionText 明确指定时启用。
    // emoAuto 默认开启（让用户零配置也有“情绪”），/mode style 或 /tts 风格:xxx 仅作为 styleHint 提升情绪判断质量。
    const envEmoAutoRaw = (process.env.INDEXTTS_EMO_AUTO || process.env.INDEX_TTS_EMO_AUTO || "").trim();
    const envEmoAutoDefault = envEmoAutoRaw === "0" ? false : (envEmoAutoRaw === "1" ? true : true);
    const emoAuto = typeof options.emoAuto === "boolean" ? options.emoAuto : envEmoAutoDefault;
    const emoText = (options.emotionText || "").trim();
    const emoVectorEnv = parseEmotionVector(process.env.INDEXTTS_EMO_VECTOR || "");
    const emoVector = options.emotionVector ?? (emoVectorEnv ?? undefined);

    if (emoAuto) {
      // Auto-emotion: analyze using LM Studio
      console.log("[indextts] Auto-emotion enabled, analyzing with LM Studio...");
      emotionResult = await analyzeEmotionVector(text, { skipAnalysis: false, styleHint: options.instruct });
      if (emotionResult) {
        console.log(`[indextts] Emotion analysis complete: ${emotionResult.segments.length} segments, avg intensity: ${(emotionResult.averageIntensity * 100).toFixed(0)}%`);
      }
    } else if (emoText) {
      // Emotion from text: use IndexTTS's built-in emotion text analysis
      console.log(`[indextts] Using emotion text: ${emoText}`);
      // Will be passed via --emo-text flag
    } else if (emoVector && emoVector.length === 8) {
      // Direct emotion vector
      console.log(`[indextts] Using emotion vector: ${formatEmotionVector(emoVector as EmotionVector)}`);
    }

    const autoAvgVector = emoAuto && emotionResult ? emotionResult.averageVector : null;
    const emotionVectorToUse = emoVector ?? (autoAvgVector ?? undefined);

    // Decide synthesis mode
    //
    // P0: per-segment 合成“很戏”，但成本也最高。
    // - 长文本直接走 averageVector 单次合成，避免性能与内存爆炸。
    // - 阈值可配，默认 700 字符。
    const segmentSynthesisMaxChars = (() => {
      const raw = (process.env.TTS_EMO_SEGMENT_SYNTH_MAX_CHARS || "").trim();
      // P0: 默认更保守（180 字以内才做 per-segment 合成）
      // 理由：per-segment 的成本是线性叠加的（段数 × 推理耗时），在 MPS/统一内存环境下
      // 很容易带来“慢/爆内存/SIGKILL”。想要更“戏”，再通过 env 显式调大（如 700）。
      if (!raw) return 180;
      const n = Number(raw);
      if (!Number.isFinite(n)) return 180;
      return Math.max(80, Math.min(5000, Math.floor(n)));
    })();
    const useSegmentSynthesis = Boolean(
      emoAuto &&
      emotionResult &&
      emotionResult.segments.length > 1 &&
      text.length <= segmentSynthesisMaxChars
    );

    if (useSegmentSynthesis && emotionResult) {
      // Segment-by-segment synthesis with per-segment emotion vectors
      const segResult = await runSegmentSynthesis({
        emotionResult,
        voicePrompt: resolvedRefAudio,
        emotionAlpha,
        paths,
        options,
      });
      if (segResult.success) {
        return segResult;
      }
      // P0: 分段失败 → 回退到单次合成（averageVector），保证不丢内容
      console.warn(`[indextts] Segment synthesis failed, fallback to single synthesis: ${segResult.error ?? "unknown"}`);
    } else {
      // P0: 长文本稳态（非 emoAuto）→ 按句切段 + concat（避免一次推爆/超时/shape 膨胀）
      const longTextThreshold = (() => {
        const raw = process.env.TTS_LONG_TEXT_SEGMENT_CHARS;
        if (!raw) return 0;
        const n = Number(raw);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.floor(n));
      })();

      if (!emoAuto && longTextThreshold > 0 && text.length > longTextThreshold) {
        const chunks = segmentTextForEmotion(text);
        if (chunks.length > 1) {
          const longResult = await runLongTextSegmentSynthesis({
            chunks,
            voicePrompt: resolvedRefAudio,
            emotionAlpha,
            paths,
            options,
          });
          if (longResult.success) {
            return longResult;
          }
          console.warn(`[indextts] Long-text segmentation failed, fallback to single synthesis: ${longResult.error ?? "unknown"}`);
        }
      }

      // Single-pass synthesis (original mode)
      return await runSingleSynthesis({
        text,
        voicePrompt: resolvedRefAudio,
        emotionVector: emotionVectorToUse,
        emotionAlpha,
        emoText,
        paths,
        options,
      });
    }

    // Fallback: single synthesis (averageVector)
    return await runSingleSynthesis({
      text,
      voicePrompt: resolvedRefAudio,
      emotionVector: emotionVectorToUse,
      emotionAlpha,
      emoText,
      paths,
      options,
    });
  } finally {
    // Best-effort: long-run stability (avoid "memory keeps growing" on macOS/MPS).
    // Never block user reply: schedule recycle and return.
    void maybeRecycleWorkerAfterJob({ paths, timeoutMs: options.timeoutMs }).catch(() => {});
  }
}

/**
 * Long-text segmentation without emotion vectors.
 *
 * - 不启用 emoAuto
 * - 仅为了稳态与超时控制（每段独立 synthesize + concat）
 */
async function runLongTextSegmentSynthesis(params: {
  chunks: string[];
  voicePrompt: string;
  emotionAlpha: number;
  paths: ReturnType<typeof resolveIndexTtsPaths>;
  options: TtsOptions & TtsBackendContext;
}): Promise<TtsResult> {
  const { chunks, voicePrompt, emotionAlpha, paths, options } = params;
  const speed = normalizeIndexTtsSpeed(options.speed);

  console.log(`[indextts] Long-text segmentation: ${chunks.length} chunks (threshold=${process.env.TTS_LONG_TEXT_SEGMENT_CHARS})`);

  const segmentsDir = join(options.workspacePath, "artifacts", "tts", `${options.artifactId}_chunks`);
  await mkdir(segmentsDir, { recursive: true });

  const segmentPaths: string[] = [];
  // P0: 长文本“不会中断”优先：timeout 视为“每段请求”的上限，而非“整段总预算”。
  // 否则一旦切段多，均分会导致每段 timeout 过小 → worker 超时自杀（SIGKILL）。
  const segmentTimeout = Math.max(options.timeoutMs, getMinSegmentTimeoutMs());

  let failedCount = 0;
  // P0: 兜底硬切，避免“没有标点/逗号”导致单 chunk 过长。
  const maxChunkChars = (() => {
    const raw = (process.env.TTS_LONG_TEXT_CHUNK_MAX_CHARS || "").trim();
    if (!raw) return 120;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 120;
    return Math.max(40, Math.min(800, Math.floor(n)));
  })();

  const hardChunks = chunks.flatMap((c) => splitByMaxChars(c, maxChunkChars));

  for (let i = 0; i < hardChunks.length; i++) {
    const chunk = hardChunks[i];
    const segmentPath = join(segmentsDir, `seg_${i.toString().padStart(3, "0")}.wav`);

    const result = await synthesizeSegment({
      text: chunk,
      voicePrompt,
      outputPath: segmentPath,
      emotionVector: undefined,
      emotionAlpha,
      speed,
      python: paths.python,
      cliScript: paths.cliScript,
      workerScript: paths.workerScript,
      modelDir: paths.modelDir,
      config: paths.config,
      device: paths.device,
      timeoutMs: segmentTimeout,
    });

    if (result.success) {
      segmentPaths.push(segmentPath);
    } else {
      failedCount += 1;
    }
  }

  // P0: 严格模式：任何 chunk 失败都视为失败（避免“后半段丢失但仍发音频”）
  if (failedCount > 0) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "indextts",
      error: `Long-text segmentation failed: ${failedCount}/${hardChunks.length} chunks`,
    };
  }

  if (segmentPaths.length === 0) {
    return { success: false, artifactId: options.artifactId, backend: "indextts", error: "All chunks failed to synthesize" };
  }

  const concatOk = await concatWavFiles(segmentPaths, options.wavPath, options.timeoutMs);
  if (!concatOk) {
    return { success: false, artifactId: options.artifactId, backend: "indextts", error: "Failed to concatenate audio chunks" };
  }

  const { existsSync } = await import("node:fs");
  if (!existsSync(options.wavPath)) {
    return { success: false, artifactId: options.artifactId, backend: "indextts", error: "Concatenated output file not found" };
  }

  if (options.outFormat === "wav") {
    return { success: true, artifactId: options.artifactId, backend: "indextts", audioPath: options.wavPath };
  }

  const m4aResult = await convertWavToM4a({
    wavPath: options.wavPath,
    m4aPath: options.m4aPath,
    timeoutMs: options.timeoutMs,
  });

  return { success: true, artifactId: options.artifactId, audioPath: m4aResult.audioPath, backend: "indextts" };
}

// ============================================
// Synthesis Modes
// ============================================

/**
 * Single-pass synthesis (original IndexTTS mode)
 */
async function runSingleSynthesis(params: {
  text: string;
  voicePrompt: string;
  emotionVector?: number[];
  emotionAlpha: number;
  emoText?: string;
  paths: ReturnType<typeof resolveIndexTtsPaths>;
  options: TtsOptions & TtsBackendContext;
}): Promise<TtsResult> {
  const { text, voicePrompt, emotionVector, emotionAlpha, emoText, paths, options } = params;

  const speed = normalizeIndexTtsSpeed(options.speed);
  const useWorker = (process.env.INDEX_TTS_USE_WORKER || DEFAULT_INDEX_TTS_USE_WORKER) !== "0";
  const allowWorkerForThisText = shouldUseWorkerForText(text);
  if (useWorker) {
    const synthOnce = async (): Promise<void> => {
      const worker = getIndexTtsWorker({ python: paths.python, workerScript: paths.workerScript });
      await worker.synthesize({
        text,
        voicePrompt,
        outWav: options.wavPath,
        emotionVector,
        emotionAlpha,
        emotionText: emoText,
        speed,
        intervalSilenceMs: parseInt(process.env.INDEX_TTS_INTERVAL_SILENCE_MS || "200", 10),
        timeoutMs: options.timeoutMs,
      });
    };

    try {
      if (!allowWorkerForThisText) {
        throw new Error("skip worker for long text");
      }
      await synthOnce();
    } catch (e) {
      // P0: 数值不稳定（常见于 MPS/FP16/长文本）→ 自动降级配置后重试一次
      // - 不改变常驻 worker（保持“快模式”）
      // - 改用一次性 CLI 子进程走“稳模式”生成（仅影响当前请求）
      if (isNanProbabilityError(e)) {
        console.warn(`[indextts] NaN/Inf probability detected (worker fast mode), fallback to one-shot safe CLI: ${e instanceof Error ? e.message : String(e)}`);

        // 清理可能的半成品
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(options.wavPath);
        } catch {
          // ignore
        }

        const safeEnv: NodeJS.ProcessEnv = {
          ...buildStableWorkerEnv(paths.device),
          // 更稳：禁用 fp16 + 降低搜索/采样强度
          INDEX_TTS_FP16: "0",
          INDEX_TTS_NUM_BEAMS: "1",
          INDEX_TTS_DIFFUSION_STEPS: "15",
          // 更稳：允许 MPS fallback（仅影响当前子进程）
          PYTORCH_ENABLE_MPS_FALLBACK: "1",
        };

        const args = [
          paths.cliScript,
          "--text", text,
          "--voice-prompt", voicePrompt,
          "--out", options.wavPath,
          "--config", paths.config,
          "--model-dir", paths.modelDir,
          "--device", paths.device,
          "--emo-alpha", String(emotionAlpha),
          "--speed", String(speed),
        ];

        if (emotionVector) {
          args.push("--emo-vector", JSON.stringify(emotionVector));
        }
        if (emoText) {
          args.push("--emo-text", emoText);
        }

        // safe fallback 明确禁用 fp16：不传 --fp16

        const safeResult = await runCmdCapture({
          cmd: paths.python,
          args,
          timeoutMs: Math.max(options.timeoutMs, 180_000),
          env: safeEnv,
        });

        if (!safeResult.ok) {
          return {
            success: false,
            artifactId: options.artifactId,
            backend: "indextts",
            error: safeResult.error || "TTS 生成失败（NaN fallback）",
          };
        }

        const pythonErr = (safeResult.stderr || "").trim();
        if (looksLikePythonFatalError(pythonErr)) {
          return {
            success: false,
            artifactId: options.artifactId,
            backend: "indextts",
            error: pythonErr.slice(0, 800) || "TTS 生成失败（NaN fallback）",
          };
        }
      } else
      // P0: 可恢复错误 → 重启 worker 并重试一次（避免一次抖动让用户完全失败）
      if (shouldRetryWorkerError(e)) {
        console.warn(`[indextts] Worker error, retrying once after restart: ${e instanceof Error ? e.message : String(e)}`);
        await restartWorker(paths);
        try {
          await synthOnce();
        } catch (e2) {
          return {
            success: false,
            artifactId: options.artifactId,
            backend: "indextts",
            error: e2 instanceof Error ? e2.message : String(e2),
          };
        }
      } else {
        // 对“长文本主动跳过 worker”的情况：改走一次性 CLI（更稳）
        if (e instanceof Error && e.message.includes("skip worker for long text")) {
          // fall through to CLI path
        } else {
          return {
            success: false,
            artifactId: options.artifactId,
            backend: "indextts",
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }
    }
  }

  if (!useWorker || !allowWorkerForThisText) {
    // Build CLI arguments
    const args = [
      paths.cliScript,
      "--text", text,
      "--voice-prompt", voicePrompt,
      "--out", options.wavPath,
      "--config", paths.config,
      "--model-dir", paths.modelDir,
      "--device", paths.device,
      "--emo-alpha", String(emotionAlpha),
      "--speed", String(speed),
    ];

    // P0: CLI wrapper 需要显式传 --fp16（仅设置 env 不会生效）
    const stableEnv = buildStableWorkerEnv(paths.device);
    if (shouldUseFp16FromEnv(stableEnv, paths.device)) {
      args.push("--fp16");
    }

    if (emotionVector) {
      args.push("--emo-vector", JSON.stringify(emotionVector));
    }

    if (emoText) {
      args.push("--emo-text", emoText);
    }

    const result = await runCmdCapture({
      cmd: paths.python,
      args,
      timeoutMs: options.timeoutMs,
      // P0: CLI 路径也要应用稳定默认值（与 worker 保持一致）。
      env: stableEnv,
    });

    if (!result.ok) {
      return {
        success: false,
        artifactId: options.artifactId,
        backend: "indextts",
        error: result.error || "TTS 生成失败",
      };
    }

    // Check for Python errors
    const pythonErr = (result.stderr || "").trim();
    if (looksLikePythonFatalError(pythonErr)) {
      return {
        success: false,
        artifactId: options.artifactId,
        backend: "indextts",
        error: pythonErr.slice(0, 800) || "TTS 生成失败",
      };
    }
  }

  const { existsSync } = await import("node:fs");
  if (!existsSync(options.wavPath)) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "indextts",
      error: "TTS 输出文件未生成",
    };
  }

  // wav format: return immediately
  if (options.outFormat === "wav") {
    return {
      success: true,
      artifactId: options.artifactId,
      backend: "indextts",
      audioPath: options.wavPath,
    };
  }

  // m4a: ffmpeg conversion with silence trimming
  const m4aResult = await convertWavToM4a({
    wavPath: options.wavPath,
    m4aPath: options.m4aPath,
    timeoutMs: options.timeoutMs,
  });

  return {
    success: true,
    artifactId: options.artifactId,
    audioPath: m4aResult.audioPath,
    backend: "indextts",
  };
}

/**
 * Segment-by-segment synthesis with per-segment emotion vectors
 */
async function runSegmentSynthesis(params: {
  emotionResult: EmotionAnalysisResult;
  voicePrompt: string;
  emotionAlpha: number;
  paths: ReturnType<typeof resolveIndexTtsPaths>;
  options: TtsOptions & TtsBackendContext;
}): Promise<TtsResult> {
  const { emotionResult, voicePrompt, emotionAlpha, paths, options } = params;
  const speed = normalizeIndexTtsSpeed(options.speed);

  // P0: 再做一次“硬切兜底”，避免 capSegments() 合并后段过长导致推理抖动/OOM。
  const maxSegmentChars = (() => {
    const raw = (process.env.TTS_EMO_SEGMENT_MAX_CHARS || "").trim();
    if (!raw) return 120;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 120;
    return Math.max(40, Math.min(800, Math.floor(n)));
  })();

  const expandedSegments = emotionResult.segments.flatMap((seg) => {
    const parts = splitByMaxChars(seg.text, maxSegmentChars);
    return parts.map((t) => ({
      ...seg,
      text: t,
    }));
  });

  console.log(`[indextts] Segment synthesis: ${expandedSegments.length} segments`);

  // Create temporary directory for segment outputs
  const segmentsDir = join(options.workspacePath, "artifacts", "tts", `${options.artifactId}_segments`);
  await mkdir(segmentsDir, { recursive: true });

  const segmentPaths: string[] = [];
  const segmentTimeout = Math.max(options.timeoutMs, getMinSegmentTimeoutMs());
  let failedCount = 0;

  // Synthesize each segment
  for (let i = 0; i < expandedSegments.length; i++) {
    const segment = expandedSegments[i];
    const segmentPath = join(segmentsDir, `seg_${i.toString().padStart(3, "0")}.wav`);

    console.log(`[indextts] Synthesizing segment ${i + 1}/${expandedSegments.length}: "${segment.text.slice(0, 20)}..." (${segment.dominant}, ${(segment.intensity * 100).toFixed(0)}%)`);

    const result = await synthesizeSegment({
      text: segment.text,
      voicePrompt,
      outputPath: segmentPath,
      emotionVector: segment.vector,
      emotionAlpha,
      speed,
      python: paths.python,
      cliScript: paths.cliScript,
      workerScript: paths.workerScript,
      modelDir: paths.modelDir,
      config: paths.config,
      device: paths.device,
      timeoutMs: segmentTimeout,
    });

    if (!result.success) {
      console.error(`[indextts] Segment ${i + 1} failed: ${result.error}`);
      failedCount += 1;
    } else {
      segmentPaths.push(segmentPath);
    }
  }

  // P0: 严格模式：任何 segment 失败都视为失败（由上层 fallback 保证不丢内容）
  if (failedCount > 0) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "indextts",
      error: `Segment synthesis failed: ${failedCount}/${expandedSegments.length} segments`,
    };
  }

  if (segmentPaths.length === 0) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "indextts",
      error: "All segments failed to synthesize",
    };
  }

  // Concatenate segments
  console.log(`[indextts] Concatenating ${segmentPaths.length} segments...`);
  const concatOk = await concatWavFiles(segmentPaths, options.wavPath, options.timeoutMs);

  if (!concatOk) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "indextts",
      error: "Failed to concatenate audio segments",
    };
  }

  const { existsSync } = await import("node:fs");
  if (!existsSync(options.wavPath)) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "indextts",
      error: "Concatenated output file not found",
    };
  }

  console.log(`[indextts] Segment synthesis complete: ${options.wavPath}`);

  // wav format: return immediately
  if (options.outFormat === "wav") {
    return {
      success: true,
      artifactId: options.artifactId,
      backend: "indextts",
      audioPath: options.wavPath,
    };
  }

  // m4a: ffmpeg conversion with silence trimming
  const m4aResult = await convertWavToM4a({
    wavPath: options.wavPath,
    m4aPath: options.m4aPath,
    timeoutMs: options.timeoutMs,
  });

  return {
    success: true,
    artifactId: options.artifactId,
    audioPath: m4aResult.audioPath,
    backend: "indextts",
  };
}

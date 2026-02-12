/**
 * msgcode: TTS 探针
 *
 * 目标（只读、快）：
 * - 检查 IndexTTS 配置是否齐全（python/checkpoints/config）
 * - 观察 worker 是否在跑（ps aux 搜索 indexts_worker.py）
 *
 * 注意：
 * - 这个探针不会主动启动 worker（避免 doctor 变慢/有副作用）
 * - TTS 属于可选能力：缺失以 warning 呈现（不阻塞 msgcode 启动）
 */

import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ProbeOptions, ProbeResult } from "../types.js";
import { withTimeout } from "../types.js";

const execAsync = promisify(exec);

function expandHome(p: string): string {
  const home = process.env.HOME;
  if (!home) return p;
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

function resolveIndexTtsRoot(): string {
  const root = (process.env.INDEX_TTS_ROOT || "").trim();
  if (root) return resolve(expandHome(root));
  return resolve(process.env.HOME || "~", "Models", "index-tts");
}

function resolveIndexTtsPython(root: string): string {
  const raw = (process.env.INDEX_TTS_PYTHON || "").trim();
  if (raw) return expandHome(raw);
  return join(root, ".venv/bin/python");
}

function resolveIndexTtsModelDir(root: string): string {
  const raw = (process.env.INDEX_TTS_MODEL_DIR || "").trim();
  if (raw) return resolve(expandHome(raw.replaceAll("$INDEX_TTS_ROOT", root)));
  return join(root, "checkpoints");
}

function resolveIndexTtsConfig(root: string): string {
  const raw = (process.env.INDEX_TTS_CONFIG || "").trim();
  if (raw) return resolve(expandHome(raw.replaceAll("$INDEX_TTS_ROOT", root)));
  return join(root, "checkpoints", "config.yaml");
}

function parseWorkerPids(psOutput: string): number[] {
  const pids: number[] = [];
  const lines = (psOutput || "").split("\n");
  for (const line of lines) {
    if (!line.includes("indexts_worker.py")) continue;
    const parts = line.trim().split(/\s+/);
    // ps aux: USER PID ...
    const pid = parseInt(parts[1] || "", 10);
    if (Number.isFinite(pid)) pids.push(pid);
  }
  return pids;
}

async function getWorkerRssMb(pids: number[], timeoutMs: number): Promise<Record<string, number>> {
  if (pids.length === 0) return {};
  try {
    const { stdout } = await withTimeout(execAsync(`ps -o pid=,rss= -p ${pids.join(",")}`), timeoutMs, "ps rss");
    const map: Record<string, number> = {};
    for (const line of (stdout || "").split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const pid = parseInt(parts[0] || "", 10);
      const rssKb = parseInt(parts[1] || "", 10);
      if (!Number.isFinite(pid) || !Number.isFinite(rssKb)) continue;
      map[String(pid)] = Math.round((rssKb / 1024) * 10) / 10;
    }
    return map;
  } catch {
    return {};
  }
}

export async function probeTts(options?: ProbeOptions): Promise<ProbeResult> {
  const details: Record<string, unknown> = {};
  const issues: string[] = [];

  const timeout = options?.timeout ?? 1500;
  const backend = (process.env.TTS_BACKEND || "indextts").trim();
  // P0: 默认关闭常驻 worker（稳定优先）；只有显式配置 INDEX_TTS_USE_WORKER=1 才开启
  const useWorker = (process.env.INDEX_TTS_USE_WORKER || "0") !== "0";

  details.backend = backend;
  details.useWorker = useWorker;

  // P0: “生效值”口径（msgcode 会对缺省的 IndexTTS env 注入稳定默认值）
  const effective = {
    indexTtsDevice: process.env.INDEX_TTS_DEVICE || "mps",
    indexTtsMaxSeqLength: process.env.INDEX_TTS_MAX_SEQ_LENGTH || "4096",
    indexTtsDiffusionSteps: process.env.INDEX_TTS_DIFFUSION_STEPS || "20",
    indexTtsNumBeams: process.env.INDEX_TTS_NUM_BEAMS || "2",
    indexTtsFp16: process.env.INDEX_TTS_FP16 || ((process.env.INDEX_TTS_DEVICE || "mps") === "mps" ? "1" : ""),
    workerMaxTextChars: process.env.INDEX_TTS_WORKER_MAX_TEXT_CHARS || "480",
    workerRecycleRssMb: process.env.INDEX_TTS_WORKER_RECYCLE_RSS_MB || "4500",
    workerRecycleMpsRatio: process.env.INDEX_TTS_WORKER_RECYCLE_MPS_RATIO || "0.72",
    segmentTimeoutMinMs: process.env.INDEX_TTS_SEGMENT_TIMEOUT_MS_MIN || "180000",
    emoSegmentMaxChars: process.env.TTS_EMO_SEGMENT_MAX_CHARS || "120",
    emoSegmentSynthesisMaxChars: process.env.TTS_EMO_SEGMENT_SYNTH_MAX_CHARS || "700",
    longTextChunkMaxChars: process.env.TTS_LONG_TEXT_CHUNK_MAX_CHARS || "120",
  };
  details.effective = effective;

  const root = resolveIndexTtsRoot();
  const python = resolveIndexTtsPython(root);
  const modelDir = resolveIndexTtsModelDir(root);
  const config = resolveIndexTtsConfig(root);

  details.indexTtsRoot = root;
  details.indexTtsPython = python;
  details.indexTtsModelDir = modelDir;
  details.indexTtsConfig = config;
  // 配置值（原样展示，便于排查“用户以为设置了但实际没生效”）
  details.configured = {
    indexTtsDevice: process.env.INDEX_TTS_DEVICE || "",
    indexTtsMaxSeqLength: process.env.INDEX_TTS_MAX_SEQ_LENGTH || "",
    indexTtsDiffusionSteps: process.env.INDEX_TTS_DIFFUSION_STEPS || "",
    indexTtsNumBeams: process.env.INDEX_TTS_NUM_BEAMS || "",
    indexTtsFp16: process.env.INDEX_TTS_FP16 || "",
    indexTtsUseWorker: process.env.INDEX_TTS_USE_WORKER || "",
    indexTtsWorkerMaxTextChars: process.env.INDEX_TTS_WORKER_MAX_TEXT_CHARS || "",
    indexTtsWorkerRecycleEveryJobs: process.env.INDEX_TTS_WORKER_RECYCLE_EVERY_JOBS || "",
    indexTtsWorkerRecycleRssMb: process.env.INDEX_TTS_WORKER_RECYCLE_RSS_MB || "",
    indexTtsWorkerRecycleMpsRatio: process.env.INDEX_TTS_WORKER_RECYCLE_MPS_RATIO || "",
    indexTtsSegmentTimeoutMinMs: process.env.INDEX_TTS_SEGMENT_TIMEOUT_MS_MIN || "",
    indexTtsMpsMemoryFraction: process.env.INDEX_TTS_MPS_MEMORY_FRACTION || "",
    indexTtsEmptyCache: process.env.INDEX_TTS_EMPTY_CACHE || "",
    indexTtsGcCollect: process.env.INDEX_TTS_GC_COLLECT || "",
    ttsLongTextSegmentChars: process.env.TTS_LONG_TEXT_SEGMENT_CHARS || "",
    ttsEmoSegmentMaxChars: process.env.TTS_EMO_SEGMENT_MAX_CHARS || "",
    ttsEmoSegmentSynthesisMaxChars: process.env.TTS_EMO_SEGMENT_SYNTH_MAX_CHARS || "",
    ttsLongTextChunkMaxChars: process.env.TTS_LONG_TEXT_CHUNK_MAX_CHARS || "",
  };

  const rootOk = existsSync(root);
  const pythonOk = existsSync(python);
  const modelOk = existsSync(modelDir);
  const configOk = existsSync(config);

  details.rootOk = rootOk;
  details.pythonOk = pythonOk;
  details.modelDirOk = modelOk;
  details.configOk = configOk;

  if (!rootOk) issues.push("IndexTTS_ROOT 不存在");
  if (!pythonOk) issues.push("IndexTTS_PYTHON 不存在");
  if (!modelOk) issues.push("IndexTTS_MODEL_DIR 不存在");
  if (!configOk) issues.push("IndexTTS_CONFIG 不存在");

  // best-effort: worker 是否正在跑（不主动启动）
  try {
    const { stdout } = await withTimeout(execAsync("ps aux"), timeout, "ps aux");
    const pids = parseWorkerPids(stdout);
    details.workerPids = pids;
    details.workerCount = pids.length;
    details.workerRssMb = await getWorkerRssMb(pids, timeout);
  } catch {
    details.workerPids = [];
    details.workerCount = 0;
    details.workerRssMb = {};
  }

  let status: ProbeResult["status"] = "pass";
  if (!rootOk || !pythonOk || !modelOk || !configOk) {
    status = "warning";
  }

  return {
    name: "tts",
    status,
    message: issues.length > 0 ? `TTS 配置不完整: ${issues.join("; ")}` : "TTS 检查通过",
    details,
    fixHint: issues.length > 0
      ? "检查 ~/.config/msgcode/.env 的 IndexTTS 配置（INDEX_TTS_ROOT/INDEX_TTS_PYTHON/INDEX_TTS_MODEL_DIR/INDEX_TTS_CONFIG）"
      : undefined,
  };
}

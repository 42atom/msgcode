/**
 * msgcode: 本地 TTS Runner（Qwen3-TTS MLX）
 *
 * 目标：
 * - 输入文本 → 生成音频文件 → 返回路径（供 iMessage 发送附件）
 * - 尽量少依赖外部服务，默认走 /Users/admin/Models/qwen3-tts 的本地环境
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

export type TtsResult = {
  success: boolean;
  audioPath?: string;
  artifactId?: string;
  error?: string;
};

export async function runTts(options: {
  workspacePath: string;
  text: string;
  voice?: string;
  model?: string;
  instruct?: string;
  refAudioPath?: string;
  refText?: string;
  lang?: string;
  speed?: number;
  temperature?: number;
  maxTokens?: number;
  format?: "wav" | "m4a";
  timeoutMs?: number;
}): Promise<TtsResult> {
  const text = normalizeTtsText(options.text || "");
  if (!text) return { success: false, error: "缺少 text" };

  const workspacePath = resolve(options.workspacePath);
  const artifactId = randomUUID().replace(/-/g, "").slice(0, 12);
  const artifactsDir = join(workspacePath, "artifacts", "tts");
  await mkdir(artifactsDir, { recursive: true });

  const base = join(artifactsDir, artifactId);
  const wavPath = `${base}.wav`;
  const outFormat = options.format || "m4a";
  const audioPath = outFormat === "wav" ? wavPath : `${base}.m4a`;

  const python = process.env.QWEN3_TTS_PYTHON
    || (process.env.HOME ? join(process.env.HOME, "Models/qwen3-tts/venv/qwen3-tts/bin/python") : "python3");
  const script = process.env.QWEN3_TTS_CLI
    || resolve(process.cwd(), "scripts/qwen3_tts_cli.py");

  const voice = options.voice || process.env.QWEN3_TTS_VOICE || "Serena";
  const model = options.model || process.env.QWEN3_TTS_MODEL || "CustomVoice";
  const instruct = (options.instruct || process.env.QWEN3_TTS_INSTRUCT || "").trim();
  const refAudio = (options.refAudioPath || process.env.QWEN3_TTS_REF_AUDIO || "").trim();
  const refText = (options.refText || process.env.QWEN3_TTS_REF_TEXT || "").trim();
  const lang = (options.lang || process.env.QWEN3_TTS_LANG || "zh").trim();
  // 默认值“硬一点”：
  // - temperature 适当提高，让韵律更有起伏（但也更不稳定）
  // - speed 略快一点，减少“平铺直叙”的感觉
  const speed = typeof options.speed === "number" && Number.isFinite(options.speed)
    ? String(options.speed)
    : (process.env.QWEN3_TTS_SPEED || "1.05");
  const temperature = typeof options.temperature === "number" && Number.isFinite(options.temperature)
    ? String(options.temperature)
    : (process.env.QWEN3_TTS_TEMPERATURE || "0.4");
  const maxTokens = typeof options.maxTokens === "number" && Number.isFinite(options.maxTokens) ? String(Math.floor(options.maxTokens)) : (process.env.QWEN3_TTS_MAX_TOKENS || "1024");

  const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : 120_000;

  const resolvedRefAudio = await resolveRefAudioToWav(refAudio, timeoutMs);
  // mlx_audio 当前实现：只要传 ref_audio，就必须传 ref_text（否则要求 stt_model）
  // 我们不强制引入 stt_model，直接给一个短占位，保证功能可用。
  // 如果你想更拟真，可以在 ~/.config/msgcode/.env 里设置 QWEN3_TTS_REF_TEXT 为参考音频的内容。
  const effectiveRefText = resolvedRefAudio ? (refText || "参考音频") : "";

  const r1 = await runCmdCapture({
    cmd: python,
    args: [
      script,
      "--text", text,
      "--voice", voice,
      "--model", model,
      "--instruct", instruct,
      ...(resolvedRefAudio ? ["--ref-audio", resolvedRefAudio] : []),
      ...(resolvedRefAudio ? ["--ref-text", effectiveRefText] : []),
      "--out", wavPath,
      "--lang", lang,
      "--speed", speed,
      "--max-tokens", maxTokens,
      "--temperature", temperature,
    ],
    timeoutMs,
  });
  if (!r1.ok) {
    return { success: false, artifactId, error: r1.error || "TTS 生成失败" };
  }
  // 兼容：某些 Python 库会“打印 Traceback 但退出 0”，导致文件没写出来
  const pythonErr = (r1.stderr || "").trim();
  if (pythonErr.includes("Traceback (most recent call last):") || pythonErr.includes("Error loading model:")) {
    return { success: false, artifactId, error: pythonErr.slice(0, 800) || "TTS 生成失败" };
  }
  if (!existsSync(wavPath)) {
    return { success: false, artifactId, error: "TTS 输出文件未生成" };
  }

  if (outFormat === "wav") {
    return { success: true, artifactId, audioPath: wavPath };
  }

  // m4a: ffmpeg 转码（iMessage 发送更友好）
  // 仅裁切“尾部静音”（不会删除中间停顿），避免 iMessage 播放时出现一大段空白。
  // 可通过 TTS_TRIM_SILENCE=0 禁用。
  const trimSilence = (process.env.TTS_TRIM_SILENCE || "1") !== "0";
  // 阈值越小越保守，越不容易误切内容
  const silenceDb = process.env.TTS_SILENCE_DB || "-60dB";
  // 把“最小静音时长”默认提高到 2s，避免把句间停顿当作结尾
  const minSilenceSec =
    process.env.TTS_SILENCE_MIN_DURATION_SEC ||
    process.env.TTS_SILENCE_STOP_DURATION_SEC || // 兼容旧配置名
    "2.0";
  const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
  // 输出增益（dB）：提升响度但可能带来爆音风险；建议从 3~6dB 逐步调
  const outputGainDb = process.env.TTS_OUTPUT_GAIN_DB || "0";

  let audioFilter: string | undefined;
  if (trimSilence) {
    const trimEndSec = await detectTrailingSilenceStartSec({
      ffmpeg,
      wavPath,
      silenceDb,
      minSilenceSec,
      timeoutMs,
    });
    if (typeof trimEndSec === "number" && Number.isFinite(trimEndSec) && trimEndSec > 0.2) {
      audioFilter = `atrim=end=${trimEndSec},asetpts=N/SR/TB`;
    }
  }
  if (outputGainDb !== "0") {
    audioFilter = audioFilter
      ? `${audioFilter},volume=${outputGainDb}dB`
      : `volume=${outputGainDb}dB`;
  }
  const r2 = await runCmd({
    cmd: ffmpeg,
    args: [
      "-y",
      "-i",
      wavPath,
      ...(audioFilter ? ["-af", audioFilter] : []),
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      audioPath,
    ],
    timeoutMs,
  });
  if (!r2.ok) {
    // 降级：至少把 wav 返回
    return { success: true, artifactId, audioPath: wavPath };
  }
  if (!existsSync(audioPath)) {
    return { success: true, artifactId, audioPath: wavPath };
  }

  return { success: true, artifactId, audioPath };
}

async function resolveRefAudioToWav(refAudioPath: string, timeoutMs: number): Promise<string | null> {
  const p = (refAudioPath || "").trim();
  if (!p) return null;
  const abs = resolve(p);
  if (!existsSync(abs)) return null;
  if (abs.toLowerCase().endsWith(".wav")) return abs;

  // iMessage 保存的参考音频可能是 m4a/caf 等；统一转成 wav（缓存）
  const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
  const cacheRoot = process.env.MSGCODE_CONFIG_DIR
    ? join(process.env.MSGCODE_CONFIG_DIR, "cache", "tts_ref")
    : (process.env.HOME ? join(process.env.HOME, ".config", "msgcode", "cache", "tts_ref") : null);
  if (!cacheRoot) return null;
  await mkdir(cacheRoot, { recursive: true });

  const digest = createHash("sha256").update(abs).digest("hex").slice(0, 16);
  const out = join(cacheRoot, `${digest}.wav`);
  if (existsSync(out)) return out;

  // 16kHz mono：更稳定，且足够做“参考音色”
  const r = await runCmd({
    cmd: ffmpeg,
    args: [
      "-y",
      "-i",
      abs,
      "-ac",
      "1",
      "-ar",
      "16000",
      out,
    ],
    timeoutMs: Math.max(timeoutMs, 30_000),
  });
  if (!r.ok) return null;
  if (!existsSync(out)) return null;
  return out;
}

async function detectTrailingSilenceStartSec(params: {
  ffmpeg: string;
  wavPath: string;
  silenceDb: string;
  minSilenceSec: string;
  timeoutMs: number;
}): Promise<number | null> {
  // 用 silencedetect 找“直到结尾都没有结束”的 silence_start → 只裁尾巴
  const r = await runCmdCapture({
    cmd: params.ffmpeg,
    args: [
      "-hide_banner",
      "-i",
      params.wavPath,
      "-af",
      `silencedetect=noise=${params.silenceDb}:d=${params.minSilenceSec}`,
      "-f",
      "null",
      "-",
    ],
    timeoutMs: Math.max(params.timeoutMs, 30_000),
  });
  if (!r.ok) return null;

  const lines = (r.stderr || "").split("\n");
  let openStart: number | null = null;
  for (const line of lines) {
    const mStart = line.match(/silence_start:\s*([0-9.]+)/);
    if (mStart) {
      openStart = Number(mStart[1]);
      continue;
    }
    const mEnd = line.match(/silence_end:\s*([0-9.]+)/);
    if (mEnd) {
      openStart = null;
    }
  }
  return openStart;
}

function normalizeTtsText(input: string): string {
  // 默认开启（可通过 TTS_NORMALIZE_TEXT=0 关闭）
  if ((process.env.TTS_NORMALIZE_TEXT || "1") === "0") {
    return (input || "").trim();
  }

  let s = String(input || "");

  // 统一换行
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 连续空白/换行会被模型当“长停顿”，直接压平
  // - 多段落：用句号连接，避免生成长静音
  s = s.replace(/\n{2,}/g, "。");
  s = s.replace(/\n/g, "。");

  // 省略号/点点点会显著拉长停顿：限制长度
  s = s.replace(/\.{3,}/g, "…");
  s = s.replace(/…{2,}/g, "…");
  s = s.replace(/…{1,}\s*$/g, "。");

  // 波浪号常被 TTS 当成“拉长/拖尾”指令，容易导致长静音：直接收口
  s = s.replace(/[~～]+/g, "。");

  // 过多重复标点会触发不必要的停顿
  s = s.replace(/[，,]{2,}/g, "，");
  s = s.replace(/[。\.]{2,}/g, "。");
  s = s.replace(/[！!]{2,}/g, "！");
  s = s.replace(/[？?]{2,}/g, "？");

  // 压平多余空格
  s = s.replace(/[ \t]{2,}/g, " ");

  // 去掉收尾空白
  s = s.trim();

  // 末尾如果是逗号/顿号等，容易拖尾停顿，收口成句号
  s = s.replace(/[，、,:：;；]$/g, "。");

  return s.trim();
}

async function runCmd(params: { cmd: string; args: string[]; timeoutMs: number }): Promise<{ ok: boolean; error?: string }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(params.cmd, params.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, params.timeoutMs);

    child.stdout?.on("data", (d) => { stdout += String(d); });
    child.stderr?.on("data", (d) => { stderr += String(d); });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolvePromise({ ok: true });
      const err = (stderr || stdout).trim();
      resolvePromise({ ok: false, error: err ? err.slice(0, 800) : `exitCode=${code}` });
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      resolvePromise({ ok: false, error: e instanceof Error ? e.message : String(e) });
    });
  });
}

async function runCmdCapture(params: {
  cmd: string;
  args: string[];
  timeoutMs: number;
}): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(params.cmd, params.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, params.timeoutMs);

    child.stdout?.on("data", (d) => { stdout += String(d); });
    child.stderr?.on("data", (d) => { stderr += String(d); });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolvePromise({ ok: true, stdout, stderr });
      const err = (stderr || stdout).trim();
      resolvePromise({ ok: false, stdout, stderr, error: err ? err.slice(0, 800) : `exitCode=${code}` });
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      resolvePromise({ ok: false, stdout, stderr, error: e instanceof Error ? e.message : String(e) });
    });
  });
}

/**
 * msgcode: TTS Shared Utilities
 *
 * Shared utilities for all TTS backend implementations
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

export async function resolveRefAudioToWav(refAudioPath: string, timeoutMs: number): Promise<string | null> {
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

  // 16kHz mono：更稳定，且足够做"参考音色"
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

export async function detectTrailingSilenceStartSec(params: {
  ffmpeg: string;
  wavPath: string;
  silenceDb: string;
  minSilenceSec: string;
  timeoutMs: number;
}): Promise<number | null> {
  // 用 silencedetect 找"直到结尾都没有结束"的 silence_start → 只裁尾巴
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

export async function convertWavToM4a(params: {
  wavPath: string;
  m4aPath: string;
  timeoutMs: number;
}): Promise<{ success: boolean; audioPath?: string }> {
  const trimSilence = (process.env.TTS_TRIM_SILENCE || "1") !== "0";
  const silenceDb = process.env.TTS_SILENCE_DB || "-60dB";
  const minSilenceSec = process.env.TTS_SILENCE_MIN_DURATION_SEC || process.env.TTS_SILENCE_STOP_DURATION_SEC || "2.0";
  const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
  const outputGainDb = process.env.TTS_OUTPUT_GAIN_DB || "0";

  let audioFilter: string | undefined;
  if (trimSilence) {
    const trimEndSec = await detectTrailingSilenceStartSec({
      ffmpeg,
      wavPath: params.wavPath,
      silenceDb,
      minSilenceSec,
      timeoutMs: params.timeoutMs,
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

  const r = await runCmd({
    cmd: ffmpeg,
    args: [
      "-y",
      "-i",
      params.wavPath,
      ...(audioFilter ? ["-af", audioFilter] : []),
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      params.m4aPath,
    ],
    timeoutMs: params.timeoutMs,
  });

  if (!r.ok) {
    return { success: true, audioPath: params.wavPath };
  }

  if (!existsSync(params.m4aPath)) {
    return { success: true, audioPath: params.wavPath };
  }

  return { success: true, audioPath: params.m4aPath };
}

export function normalizeTtsText(input: string): string {
  // 默认开启（可通过 TTS_NORMALIZE_TEXT=0 关闭）
  if ((process.env.TTS_NORMALIZE_TEXT || "1") === "0") {
    return (input || "").trim();
  }

  let s = String(input || "");

  // 统一换行
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 连续空白/换行会被模型当"长停顿"，直接压平
  // - 多段落：用句号连接，避免生成长静音
  s = s.replace(/\n{2,}/g, "。");
  s = s.replace(/\n/g, "。");

  // 省略号/点点点会显著拉长停顿：限制长度
  s = s.replace(/\.{3,}/g, "…");
  s = s.replace(/…{2,}/g, "…");
  s = s.replace(/…{1,}\s*$/g, "。");

  // 波浪号常被 TTS 当成"拉长/拖尾"指令，容易导致长静音：直接收口
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

export async function runCmd(params: { cmd: string; args: string[]; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<{ ok: boolean; error?: string }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(params.cmd, params.args, { stdio: ["ignore", "pipe", "pipe"], env: params.env ?? process.env });
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

export async function runCmdCapture(params: {
  cmd: string;
  args: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(params.cmd, params.args, { stdio: ["ignore", "pipe", "pipe"], env: params.env ?? process.env });
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

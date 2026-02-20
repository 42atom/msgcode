/**
 * msgcode: TTS Backend - Qwen3-TTS (Apple Silicon local)
 *
 * Uses local qwen3-tts-apple-silicon runtime via:
 *   python -m mlx_audio.tts.generate
 *
 * Modes:
 * - CustomVoice: voice + instruct
 * - Clone: ref_audio (+ ref_text)
 */

import { existsSync } from "node:fs";
import { mkdir, rename, rm, unlink } from "node:fs/promises";
import { join, parse, resolve } from "node:path";

import type { TtsBackendContext, TtsOptions, TtsResult } from "./types.js";
import { convertWavToM4a, normalizeTtsText, runCmdCapture } from "../utils.js";

type QwenPaths = {
  root: string;
  python: string;
  customModel: string;
  cloneModel: string;
};

function resolveQwenRoot(): string {
  const envRoot = (process.env.QWEN_TTS_ROOT || "").trim();
  if (envRoot) return resolve(envRoot);

  const candidates = [
    "/Users/admin/GitProjects/GithubDown/qwen3-tts-apple-silicon",
    process.env.HOME ? join(process.env.HOME, "GitProjects", "GithubDown", "qwen3-tts-apple-silicon") : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate);
  }

  // Fallback: keep deterministic path even if missing (error will explain missing files)
  return resolve(candidates[0] || "qwen3-tts-apple-silicon");
}

function resolveQwenPaths(): QwenPaths {
  const root = resolveQwenRoot();

  const python = (process.env.QWEN_TTS_PYTHON || "").trim()
    ? resolve(process.env.QWEN_TTS_PYTHON as string)
    : join(root, ".venv", "bin", "python");

  const customModel = (process.env.QWEN_TTS_MODEL_CUSTOM || "").trim()
    ? resolve(process.env.QWEN_TTS_MODEL_CUSTOM as string)
    : join(root, "models", "Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit");

  const cloneModel = (process.env.QWEN_TTS_MODEL_CLONE || "").trim()
    ? resolve(process.env.QWEN_TTS_MODEL_CLONE as string)
    : join(root, "models", "Qwen3-TTS-12Hz-0.6B-Base-8bit");

  return {
    root,
    python,
    customModel,
    cloneModel,
  };
}

async function readOptionalTextFile(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(path, "utf-8");
    const trimmed = text.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function resolveRefAudio(options: TtsOptions): {
  audio: string | null;
  text: string | null;
  invalidRefAudioPath?: string;
} {
  const explicitRefAudio = (options.refAudioPath || "").trim() || (process.env.QWEN_TTS_REF_AUDIO || "").trim();
  const explicitRefText = (options.refText || "").trim() || (process.env.QWEN_TTS_REF_TEXT || "").trim();

  if (explicitRefAudio) {
    const audioPath = resolve(explicitRefAudio);
    if (!existsSync(audioPath)) {
      return { audio: null, text: explicitRefText || null, invalidRefAudioPath: audioPath };
    }
    return { audio: audioPath, text: explicitRefText || null };
  }

  return { audio: null, text: explicitRefText || null };
}

function sanitizeError(stderr: string, fallback: string): string {
  const msg = (stderr || "").trim();
  if (!msg) return fallback;
  return msg.slice(0, 800);
}

function resolveQwenSpeed(options: TtsOptions): number | null {
  if (typeof options.speed === "number" && Number.isFinite(options.speed) && options.speed > 0) {
    return options.speed;
  }
  const raw = (process.env.QWEN_TTS_SPEED || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export async function runQwenTts(options: TtsOptions & TtsBackendContext): Promise<TtsResult> {
  const text = normalizeTtsText(options.text || "");
  if (!text) return { success: false, artifactId: options.artifactId, backend: "qwen", error: "缺少 text" };

  const paths = resolveQwenPaths();
  if (!existsSync(paths.python)) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "qwen",
      error: `Qwen Python 不存在: ${paths.python}`,
    };
  }

  const ref = resolveRefAudio(options);
  if (ref.invalidRefAudioPath) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "qwen",
      error: `QWEN_TTS_REF_AUDIO 不存在: ${ref.invalidRefAudioPath}`,
    };
  }
  const modelPath = ref.audio ? paths.cloneModel : paths.customModel;
  if (!existsSync(modelPath)) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "qwen",
      error: `Qwen 模型不存在: ${modelPath}`,
    };
  }

  const tmpDir = join(options.workspacePath, "artifacts", "tts", `${options.artifactId}_qwen_tmp`);
  await mkdir(tmpDir, { recursive: true });
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  const filePrefix = options.artifactId;
  const args = [
    "-m",
    "mlx_audio.tts.generate",
    "--model", modelPath,
    "--text", text,
    "--output_path", tmpDir,
    "--file_prefix", filePrefix,
    "--audio_format", "wav",
  ];

  const speed = resolveQwenSpeed(options);
  if (speed !== null) args.push("--speed", String(speed));

  if (typeof options.temperature === "number" && Number.isFinite(options.temperature) && options.temperature > 0) {
    args.push("--temperature", String(options.temperature));
  }

  const langCode = (options.lang || process.env.QWEN_TTS_LANG_CODE || "").trim();
  if (langCode) args.push("--lang_code", langCode);

  if (ref.audio) {
    args.push("--ref_audio", ref.audio);
    const siblingRefTextPath = `${parse(ref.audio).name}.txt`;
    const siblingRefText = join(parse(ref.audio).dir, siblingRefTextPath);
    const inlineRefText = ref.text || await readOptionalTextFile(siblingRefText);
    if (inlineRefText) args.push("--ref_text", inlineRefText);
  } else {
    const voice = (options.voice || process.env.QWEN_TTS_VOICE || "Vivian").trim();
    const instruct = (options.instruct || process.env.QWEN_TTS_INSTRUCT || "Normal tone").trim();
    if (voice) args.push("--voice", voice);
    if (instruct) args.push("--instruct", instruct);
  }

  const run = await runCmdCapture({
    cmd: paths.python,
    args,
    timeoutMs: options.timeoutMs,
  });

  if (!run.ok) {
    return {
      success: false,
      artifactId: options.artifactId,
      backend: "qwen",
      error: sanitizeError(run.stderr || run.error || run.stdout, "Qwen TTS 执行失败"),
    };
  }

  const expectedWav = join(tmpDir, `${filePrefix}_000.wav`);
  let generatedWav = expectedWav;

  if (!existsSync(generatedWav)) {
    const fs = await import("node:fs/promises");
    const files = await fs.readdir(tmpDir);
    const firstWav = files.find((f) => f.toLowerCase().endsWith(".wav"));
    if (!firstWav) {
      return {
        success: false,
        artifactId: options.artifactId,
        backend: "qwen",
        error: "Qwen TTS 未生成输出音频",
      };
    }
    generatedWav = join(tmpDir, firstWav);
  }

  try {
    if (existsSync(options.wavPath)) await unlink(options.wavPath);
  } catch {
    // ignore cleanup
  }

  await rename(generatedWav, options.wavPath);

  if (options.outFormat === "wav") {
    return {
      success: true,
      artifactId: options.artifactId,
      backend: "qwen",
      audioPath: options.wavPath,
    };
  }

  const m4a = await convertWavToM4a({
    wavPath: options.wavPath,
    m4aPath: options.m4aPath,
    timeoutMs: options.timeoutMs,
  });

  return {
    success: true,
    artifactId: options.artifactId,
    backend: "qwen",
    audioPath: m4a.audioPath || options.wavPath,
  };
}

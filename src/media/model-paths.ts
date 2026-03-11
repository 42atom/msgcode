/**
 * msgcode: 本地模型路径解析
 *
 * 职责：
 * - 统一收口 TTS/ASR 本地模型路径解析
 * - 默认路径基于 ~/Models/<model-name> 语义
 * - 未配置时返回错误，不静默猜测开发机路径
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ============================================
// 基础工具
// ============================================

/**
 * 展开路径中的 ~
 */
export function expandHome(p: string): string {
  const home = process.env.HOME;
  if (!home) return p;
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

// ============================================
// Qwen TTS 路径解析
// ============================================

export interface QwenTtsPaths {
  /** 路径来源：env(显式配置) 或 default(默认) */
  source: "env" | "default";
  /** 模型根目录 */
  root: string;
  /** Python 可执行文件路径 */
  python: string;
  /** CustomVoice 模型目录 */
  customModel: string;
  /** Clone 模型目录 */
  cloneModel: string;
}

/**
 * 解析 Qwen TTS 路径
 *
 * 默认路径: ~/Models/qwen3-tts-apple-silicon
 */
export function resolveQwenTtsPaths(): QwenTtsPaths {
  const envRoot = (process.env.QWEN_TTS_ROOT || "").trim();
  let source: "env" | "default";
  let root: string;

  if (envRoot) {
    source = "env";
    root = resolve(expandHome(envRoot));
  } else {
    // 默认路径: ~/Models/qwen3-tts-apple-silicon
    source = "default";
    root = resolve(expandHome("~/Models/qwen3-tts-apple-silicon"));
  }

  const envPython = (process.env.QWEN_TTS_PYTHON || "").trim();
  const python = envPython
    ? resolve(expandHome(envPython))
    : join(root, ".venv", "bin", "python");

  const envCustom = (process.env.QWEN_TTS_MODEL_CUSTOM || "").trim();
  const customModel = envCustom
    ? resolve(expandHome(envCustom))
    : join(root, "models", "Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit");

  const envClone = (process.env.QWEN_TTS_MODEL_CLONE || "").trim();
  const cloneModel = envClone
    ? resolve(expandHome(envClone))
    : join(root, "models", "Qwen3-TTS-12Hz-0.6B-Base-8bit");

  return { source, root, python, customModel, cloneModel };
}

/**
 * 检查 Qwen TTS 根目录是否存在
 */
export function qwenTtsRootExists(): boolean {
  const paths = resolveQwenTtsPaths();
  return existsSync(paths.root);
}

// ============================================
// ASR (Whisper) 路径解析
// ============================================

export interface AsrPaths {
  source: "env" | "default";
  modelDir: string;
}

/**
 * 解析 ASR (Whisper) 模型路径
 *
 * 默认路径: ~/Models/whisper-large-v3-mlx
 * 支持 MODEL_ROOT 环境变量（用于多模型目录场景）
 */
export function resolveAsrPaths(): AsrPaths {
  // 优先使用 WHISPER_MODEL_DIR
  const envModelDir = (process.env.WHISPER_MODEL_DIR || "").trim();
  if (envModelDir) {
    return {
      source: "env",
      modelDir: resolve(expandHome(envModelDir)),
    };
  }

  // 其次使用 MODEL_ROOT（兼容性）
  const envModelRoot = (process.env.MODEL_ROOT || "").trim();
  if (envModelRoot) {
    return {
      source: "env",
      modelDir: resolve(join(envModelRoot, "whisper-large-v3-mlx")),
    };
  }

  // 默认路径
  return {
    source: "default",
    modelDir: resolve(expandHome("~/Models/whisper-large-v3-mlx")),
  };
}

/**
 * 检查 ASR 模型目录是否存在
 */
export function asrModelDirExists(): boolean {
  const paths = resolveAsrPaths();
  return existsSync(paths.modelDir);
}

/**
 * msgcode: TTS 探针
 *
 * 目标（只读、快）：
 * - 检查 Qwen TTS 配置是否齐全
 *
 * 注意：
 * - IndexTTS 已退出正式主链；若检测到旧 `TTS_BACKEND=indextts`，只记录“已忽略旧配置”
 * - TTS 属于可选能力：缺失以 warning 呈现（不阻塞 msgcode 启动）
 */

import { existsSync } from "node:fs";
import type { ProbeOptions, ProbeResult } from "../types.js";
import { expandHome, resolveQwenTtsPaths } from "../../media/model-paths.js";

export async function probeTts(_options?: ProbeOptions): Promise<ProbeResult> {
  const details: Record<string, unknown> = {};
  const issues: string[] = [];

  const configuredBackend = (process.env.TTS_BACKEND || "").trim().toLowerCase();
  const legacyBackendIgnored = configuredBackend === "indextts";
  const qwenPaths = resolveQwenTtsPaths();
  const refAudio = (process.env.QWEN_TTS_REF_AUDIO || "").trim();

  details.backend = configuredBackend === "qwen" ? "qwen" : "auto:qwen";
  details.legacyBackendIgnored = legacyBackendIgnored;
  details.qwen = {
    source: qwenPaths.source,
    root: qwenPaths.root,
    python: qwenPaths.python,
    customModel: qwenPaths.customModel,
    cloneModel: qwenPaths.cloneModel,
    refAudio: refAudio || undefined,
    voice: process.env.QWEN_TTS_VOICE || "Vivian",
    instruct: process.env.QWEN_TTS_INSTRUCT || "Normal tone",
  };

  const rootOk = existsSync(qwenPaths.root);
  const pythonOk = existsSync(qwenPaths.python);
  const customModelOk = existsSync(qwenPaths.customModel);
  const cloneModelOk = existsSync(qwenPaths.cloneModel);
  const refAudioOk = !refAudio || existsSync(expandHome(refAudio));

  details.qwenHealth = {
    rootOk,
    pythonOk,
    customModelOk,
    cloneModelOk,
    refAudioOk,
  };

  if (!rootOk) issues.push("QWEN_TTS_ROOT 不存在");
  if (!pythonOk) issues.push("QWEN_TTS_PYTHON 不存在");
  if (!customModelOk) issues.push("QWEN_TTS_MODEL_CUSTOM 不存在");
  if (!refAudioOk) issues.push("QWEN_TTS_REF_AUDIO 不存在");

  const status: ProbeResult["status"] = issues.length > 0 ? "warning" : "pass";
  const suffix = legacyBackendIgnored ? "（已忽略旧 TTS_BACKEND=indextts）" : "";

  return {
    name: "tts",
    status,
    message: issues.length > 0 ? `Qwen TTS 配置不完整: ${issues.join("; ")}` : `Qwen TTS 检查通过${suffix}`,
    details,
    fixHint: issues.length > 0
      ? "检查 ~/.config/msgcode/.env 的 Qwen 配置（QWEN_TTS_ROOT/QWEN_TTS_PYTHON/QWEN_TTS_MODEL_CUSTOM）"
      : undefined,
  };
}

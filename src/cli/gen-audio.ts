/**
 * msgcode: Gen Audio CLI 命令（P5.7-R6-3）
 *
 * 职责：
 * - msgcode gen tts --text <text> [--voice <voice>] [--json]
 * - msgcode gen music --prompt <text> [--format <fmt>] [--json]
 *
 * 后端：MiniMax API
 * 鉴权：MINIMAX_API_KEY 环境变量
 * 存储位置：AIDOCS/audio/
 */

import { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { Diagnostic } from "../memory/types.js";
import { createEnvelope } from "./command-runner.js";

// ============================================
// 错误码定义
// ============================================

export const GEN_AUDIO_ERROR_CODES = {
  API_KEY_MISSING: "GEN_API_KEY_MISSING",
  EMPTY_TEXT: "GEN_EMPTY_TEXT",
  TTS_FAILED: "GEN_TTS_FAILED",
  MUSIC_FAILED: "GEN_MUSIC_FAILED",
  OUTPUT_SAVE_FAILED: "GEN_OUTPUT_SAVE_FAILED",
} as const;

// ============================================
// 辅助函数
// ============================================

/**
 * 获取默认音频输出目录
 */
function getDefaultAudioDir(): string {
  return path.join(process.cwd(), "AIDOCS", "audio");
}

/**
 * 创建 Gen Audio 诊断信息
 */
function createGenAudioDiagnostic(
  code: string,
  message: string,
  hint?: string,
  details?: Record<string, unknown>
): Diagnostic {
  const diag: Diagnostic = {
    code,
    message,
  };
  if (hint) {
    diag.hint = hint;
  }
  if (details) {
    diag.details = details;
  }
  return diag;
}

/**
 * 获取 MiniMax API Key
 */
function getMinimaxApiKey(): string | null {
  return process.env.MINIMAX_API_KEY || null;
}

/**
 * 调用 MiniMax TTS API
 */
async function callMinimaxTTSAPI(
  text: string,
  voiceId: string = "male-qn-qingse"
): Promise<{ success: boolean; audioData?: string; error?: string }> {
  const apiKey = getMinimaxApiKey();
  if (!apiKey) {
    return { success: false, error: "缺失 MINIMAX_API_KEY 环境变量" };
  }

  // MiniMax TTS API v2
  const url = "https://api.minimax.chat/v1/t2a_v2";

  const body = {
    model: "speech-01-turbo",
    text,
    voice_setting: {
      voice_id: voiceId,
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      format: "mp3",
      bitrate: 128000,
      channel: 1,
      sample_rate: 32000,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `API 请求失败 (${response.status}): ${errorText}` };
    }

    // MiniMax TTS 返回的是 JSON，包含 base64 音频数据
    const result = await response.json() as { data?: { audio?: string } };

    if (result.data?.audio) {
      return { success: true, audioData: result.data.audio };
    }

    return { success: false, error: "API 返回中未找到音频数据" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `网络请求失败：${message}` };
  }
}

/**
 * 调用 MiniMax Music API
 */
async function callMinimaxMusicAPI(
  prompt: string
): Promise<{ success: boolean; audioData?: string; error?: string }> {
  const apiKey = getMinimaxApiKey();
  if (!apiKey) {
    return { success: false, error: "缺失 MINIMAX_API_KEY 环境变量" };
  }

  // MiniMax Music API
  const url = "https://api.minimax.chat/v1/music/generation";

  const body = {
    model: "music-01",
    prompt,
    audio_setting: {
      format: "mp3",
      bitrate: 128000,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `API 请求失败 (${response.status}): ${errorText}` };
    }

    // MiniMax Music 返回的是 JSON，包含 base64 音频数据
    const result = await response.json() as { data?: { audio?: string } };

    if (result.data?.audio) {
      return { success: true, audioData: result.data.audio };
    }

    return { success: false, error: "API 返回中未找到音频数据" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `网络请求失败：${message}` };
  }
}

// ============================================
// gen tts 命令
// ============================================

/**
 * gen tts 命令 - 文本转语音
 */
export function createGenTtsCommand(): Command {
  const cmd = new Command("tts");

  cmd
    .description("AI 语音合成（text-to-speech）")
    .requiredOption("--text <text>", "要合成的文本")
    .option("--voice <voice>", "音色 ID（默认 male-qn-qingse）", "male-qn-qingse")
    .option("--output <path>", "输出文件路径（默认 AIDOCS/audio/）")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode gen tts";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 校验 API Key
        const apiKey = getMinimaxApiKey();
        if (!apiKey) {
          errors.push(
            createGenAudioDiagnostic(
              GEN_AUDIO_ERROR_CODES.API_KEY_MISSING,
              "缺失 MINIMAX_API_KEY 环境变量",
              "请在 .env 文件中设置 MINIMAX_API_KEY=your_api_key"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误：缺失 MINIMAX_API_KEY 环境变量");
          }
          process.exit(1);
          return;
        }

        // 校验文本
        if (!options.text || options.text.trim().length === 0) {
          errors.push(
            createGenAudioDiagnostic(
              GEN_AUDIO_ERROR_CODES.EMPTY_TEXT,
              "合成文本不能为空",
              "请提供要合成的文本内容"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误：合成文本不能为空");
          }
          process.exit(1);
          return;
        }

        // 调用 API
        const result = await callMinimaxTTSAPI(options.text, options.voice);

        if (!result.success) {
          errors.push(
            createGenAudioDiagnostic(
              GEN_AUDIO_ERROR_CODES.TTS_FAILED,
              `语音合成失败：${result.error}`,
              "请检查 API Key 是否正确，网络连接是否通畅"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${result.error}`);
          }
          process.exit(1);
          return;
        }

        // 确定输出路径
        let outputPath: string;
        if (options.output) {
          outputPath = path.resolve(options.output);
        } else {
          const audioDir = getDefaultAudioDir();
          if (!existsSync(audioDir)) {
            mkdirSync(audioDir, { recursive: true });
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `tts-${timestamp}.mp3`;
          outputPath = path.join(audioDir, filename);
        }

        // 保存音频
        try {
          const dir = path.dirname(outputPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          const buffer = Buffer.from(result.audioData!, "base64");
          writeFileSync(outputPath, buffer);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(
            createGenAudioDiagnostic(
              GEN_AUDIO_ERROR_CODES.OUTPUT_SAVE_FAILED,
              `保存音频失败：${message}`
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误：保存音频失败");
          }
          process.exit(1);
          return;
        }

        // 成功
        const data = {
          text: options.text.slice(0, 50) + (options.text.length > 50 ? "..." : ""),
          voice: options.voice,
          outputPath,
          generatedAt: new Date().toISOString(),
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`语音合成成功：${outputPath}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createGenAudioDiagnostic(
            GEN_AUDIO_ERROR_CODES.TTS_FAILED,
            `语音合成失败：${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// gen music 命令
// ============================================

/**
 * gen music 命令 - 文本转音乐
 */
export function createGenMusicCommand(): Command {
  const cmd = new Command("music");

  cmd
    .description("AI 音乐生成（text-to-music）")
    .requiredOption("--prompt <text>", "音乐描述文本")
    .option("--format <fmt>", "输出格式（mp3/wav，默认 mp3）", "mp3")
    .option("--output <path>", "输出文件路径（默认 AIDOCS/audio/）")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode gen music";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 校验 API Key
        const apiKey = getMinimaxApiKey();
        if (!apiKey) {
          errors.push(
            createGenAudioDiagnostic(
              GEN_AUDIO_ERROR_CODES.API_KEY_MISSING,
              "缺失 MINIMAX_API_KEY 环境变量",
              "请在 .env 文件中设置 MINIMAX_API_KEY=your_api_key"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误：缺失 MINIMAX_API_KEY 环境变量");
          }
          process.exit(1);
          return;
        }

        // 校验 prompt
        if (!options.prompt || options.prompt.trim().length === 0) {
          errors.push(
            createGenAudioDiagnostic(
              GEN_AUDIO_ERROR_CODES.EMPTY_TEXT,
              "音乐描述不能为空",
              "请提供详细的音乐描述"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误：音乐描述不能为空");
          }
          process.exit(1);
          return;
        }

        // 调用 API
        const result = await callMinimaxMusicAPI(options.prompt);

        if (!result.success) {
          errors.push(
            createGenAudioDiagnostic(
              GEN_AUDIO_ERROR_CODES.MUSIC_FAILED,
              `音乐生成失败：${result.error}`,
              "请检查 API Key 是否正确，网络连接是否通畅"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${result.error}`);
          }
          process.exit(1);
          return;
        }

        // 确定输出路径
        let outputPath: string;
        const format = options.format === "wav" ? "wav" : "mp3";
        if (options.output) {
          outputPath = path.resolve(options.output);
        } else {
          const audioDir = getDefaultAudioDir();
          if (!existsSync(audioDir)) {
            mkdirSync(audioDir, { recursive: true });
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `music-${timestamp}.${format}`;
          outputPath = path.join(audioDir, filename);
        }

        // 保存音频
        try {
          const dir = path.dirname(outputPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          const buffer = Buffer.from(result.audioData!, "base64");
          writeFileSync(outputPath, buffer);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(
            createGenAudioDiagnostic(
              GEN_AUDIO_ERROR_CODES.OUTPUT_SAVE_FAILED,
              `保存音频失败：${message}`
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误：保存音频失败");
          }
          process.exit(1);
          return;
        }

        // 成功
        const data = {
          prompt: options.prompt.slice(0, 50) + (options.prompt.length > 50 ? "..." : ""),
          format,
          outputPath,
          generatedAt: new Date().toISOString(),
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`音乐生成成功：${outputPath}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createGenAudioDiagnostic(
            GEN_AUDIO_ERROR_CODES.MUSIC_FAILED,
            `音乐生成失败：${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// Gen Audio 命令组
// ============================================

export function createGenAudioCommandGroup(): Command {
  const cmd = new Command("gen-audio");

  cmd.description("AI 音频生成（tts/music）");

  cmd.addCommand(createGenTtsCommand());
  cmd.addCommand(createGenMusicCommand());

  return cmd;
}

// ============================================
// 合同导出（help-docs 使用）
// ============================================

/**
 * 获取 gen tts 命令合同
 */
export function getGenTtsContract() {
  return {
    name: "msgcode gen tts",
    description: "AI 语音合成（text-to-speech）",
    options: {
      required: {
        "--text": "要合成的文本",
      },
      optional: {
        "--voice": "音色 ID（默认 male-qn-qingse）",
        "--output": "输出文件路径",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      text: "合成的文本（截断预览）",
      voice: "使用的音色",
      outputPath: "生成音频的绝对路径",
      generatedAt: "生成时间（ISO 8601）",
    },
    errorCodes: [
      "GEN_API_KEY_MISSING",
      "GEN_EMPTY_TEXT",
      "GEN_TTS_FAILED",
      "GEN_OUTPUT_SAVE_FAILED",
    ],
  };
}

/**
 * 获取 gen music 命令合同
 */
export function getGenMusicContract() {
  return {
    name: "msgcode gen music",
    description: "AI 音乐生成（text-to-music）",
    options: {
      required: {
        "--prompt": "音乐描述文本",
      },
      optional: {
        "--format": "输出格式（mp3/wav，默认 mp3）",
        "--output": "输出文件路径",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      prompt: "使用的 prompt（截断预览）",
      format: "音频格式",
      outputPath: "生成音频的绝对路径",
      generatedAt: "生成时间（ISO 8601）",
    },
    errorCodes: [
      "GEN_API_KEY_MISSING",
      "GEN_EMPTY_TEXT",
      "GEN_MUSIC_FAILED",
      "GEN_OUTPUT_SAVE_FAILED",
    ],
  };
}

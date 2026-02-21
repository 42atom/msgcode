/**
 * msgcode: Gen Image CLI 命令（P5.7-R6-2）
 *
 * 职责：
 * - msgcode gen image --prompt <text> [--aspect-ratio <ar>] [--json]
 * - msgcode gen selfie --ref <image-path> [--json]
 *
 * 后端：Google Gemini API (Nano Banana Pro / gemini-3-pro-image-preview)
 * 鉴权：GEMINI_API_KEY 环境变量
 * 存储位置：AIDOCS/images/
 */

import { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import type { Diagnostic } from "../memory/types.js";
import { createEnvelope } from "./command-runner.js";
import { randomUUID } from "node:crypto";

// ============================================
// 错误码定义
// ============================================

export const GEN_IMAGE_ERROR_CODES = {
  API_KEY_MISSING: "GEN_API_KEY_MISSING",
  INVALID_PROMPT: "GEN_INVALID_PROMPT",
  IMAGE_GENERATION_FAILED: "GEN_IMAGE_GENERATION_FAILED",
  REF_IMAGE_NOT_FOUND: "GEN_REF_IMAGE_NOT_FOUND",
  OUTPUT_SAVE_FAILED: "GEN_OUTPUT_SAVE_FAILED",
} as const;

// ============================================
// 类型定义
// ============================================

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // base64
  };
}

interface GeminiContent {
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content: GeminiContent;
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
}

// ============================================
// 辅助函数
// ============================================

/**
 * 获取默认图片输出目录
 */
function getDefaultImagesDir(): string {
  return path.join(process.cwd(), "AIDOCS", "images");
}

/**
 * 创建 Gen Image 诊断信息
 */
function createGenImageDiagnostic(
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
 * 获取 Gemini API Key
 */
function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

/**
 * 调用 Gemini API 生成图片
 */
async function callGeminiImageAPI(
  prompt: string,
  referenceImageBase64?: string
): Promise<{ success: boolean; imageData?: string; error?: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { success: false, error: "缺失 GEMINI_API_KEY 环境变量" };
  }

  const model = "gemini-3-pro-image-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // 构建请求体
  const parts: GeminiPart[] = [];

  // 如果有参考图，先放图
  if (referenceImageBase64) {
    parts.push({
      inlineData: {
        mimeType: "image/png",
        data: referenceImageBase64,
      },
    });
  }

  // 添加文本 prompt
  parts.push({ text: prompt });

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `API 请求失败 (${response.status}): ${errorText}` };
    }

    const result = await response.json() as GeminiResponse;

    // 提取图片
    const candidate = result.candidates?.[0];
    if (!candidate) {
      return { success: false, error: "API 返回空响应" };
    }

    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.mimeType.startsWith("image/")) {
        return { success: true, imageData: part.inlineData.data };
      }
      if (part.text) {
        // 如果只有文本返回，可能是错误信息
        return { success: false, error: part.text };
      }
    }

    return { success: false, error: "API 返回中未找到图片数据" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `网络请求失败：${message}` };
  }
}

/**
 * 读取图片文件为 base64
 */
function imageToBase64(imagePath: string): { success: boolean; base64?: string; error?: string } {
  try {
    if (!existsSync(imagePath)) {
      return { success: false, error: `文件不存在：${imagePath}` };
    }

    const data = readFileSync(imagePath);
    return { success: true, base64: data.toString("base64") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `读取文件失败：${message}` };
  }
}

// ============================================
// gen image 命令
// ============================================

/**
 * gen image 命令 - 文本生成图片
 */
export function createGenImageCommand(): Command {
  const cmd = new Command("image");

  cmd
    .description("AI 图片生成（text-to-image）")
    .requiredOption("--prompt <text>", "图片描述文本")
    .option("--aspect-ratio <ar>", "宽高比（如 16:9, 4:3, 1:1）", "1:1")
    .option("--output <path>", "输出文件路径（默认 AIDOCS/images/）")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode gen image";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 校验 API Key
        const apiKey = getGeminiApiKey();
        if (!apiKey) {
          errors.push(
            createGenImageDiagnostic(
              GEN_IMAGE_ERROR_CODES.API_KEY_MISSING,
              "缺失 GEMINI_API_KEY 环境变量",
              "请在 .env 文件中设置 GEMINI_API_KEY=your_api_key"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误：缺失 GEMINI_API_KEY 环境变量");
          }
          process.exit(1);
          return;
        }

        // 校验 prompt
        if (!options.prompt || options.prompt.trim().length === 0) {
          errors.push(
            createGenImageDiagnostic(
              GEN_IMAGE_ERROR_CODES.INVALID_PROMPT,
              "图片描述不能为空",
              "请提供详细的图片描述文本"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误：图片描述不能为空");
          }
          process.exit(1);
          return;
        }

        // 调用 API
        const result = await callGeminiImageAPI(options.prompt);

        if (!result.success) {
          errors.push(
            createGenImageDiagnostic(
              GEN_IMAGE_ERROR_CODES.IMAGE_GENERATION_FAILED,
              `图片生成失败：${result.error}`,
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
          const imagesDir = getDefaultImagesDir();
          if (!existsSync(imagesDir)) {
            mkdirSync(imagesDir, { recursive: true });
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `gen-image-${timestamp}.png`;
          outputPath = path.join(imagesDir, filename);
        }

        // 保存图片
        try {
          const dir = path.dirname(outputPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          const buffer = Buffer.from(result.imageData!, "base64");
          writeFileSync(outputPath, buffer);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(
            createGenImageDiagnostic(
              GEN_IMAGE_ERROR_CODES.OUTPUT_SAVE_FAILED,
              `保存图片失败：${message}`
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：保存图片失败`);
          }
          process.exit(1);
          return;
        }

        // 成功
        const data = {
          prompt: options.prompt.slice(0, 50) + (options.prompt.length > 50 ? "..." : ""),
          outputPath,
          aspectRatio: options.aspectRatio,
          generatedAt: new Date().toISOString(),
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`图片生成成功：${outputPath}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createGenImageDiagnostic(
            GEN_IMAGE_ERROR_CODES.IMAGE_GENERATION_FAILED,
            `图片生成失败：${message}`
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
// gen selfie 命令
// ============================================

/**
 * gen selfie 命令 - 基于参考图的 selfie 生成
 */
export function createGenSelfieCommand(): Command {
  const cmd = new Command("selfie");

  cmd
    .description("AI 自拍生成（基于参考图）")
    .requiredOption("--ref <path>", "参考图片路径")
    .option("--prompt <text>", "可选的额外描述")
    .option("--output <path>", "输出文件路径（默认 AIDOCS/images/）")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode gen selfie";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 校验 API Key
        const apiKey = getGeminiApiKey();
        if (!apiKey) {
          errors.push(
            createGenImageDiagnostic(
              GEN_IMAGE_ERROR_CODES.API_KEY_MISSING,
              "缺失 GEMINI_API_KEY 环境变量",
              "请在 .env 文件中设置 GEMINI_API_KEY=your_api_key"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误：缺失 GEMINI_API_KEY 环境变量");
          }
          process.exit(1);
          return;
        }

        // 校验参考图
        const refImageResult = imageToBase64(options.ref);
        if (!refImageResult.success) {
          errors.push(
            createGenImageDiagnostic(
              GEN_IMAGE_ERROR_CODES.REF_IMAGE_NOT_FOUND,
              `参考图不存在：${refImageResult.error}`,
              "请确保参考图路径正确且可读"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：参考图不存在`);
          }
          process.exit(1);
          return;
        }

        // 构建 prompt
        const basePrompt = "基于这张图片生成一张高质量的自拍照片，保持人物特征一致。";
        const fullPrompt = options.prompt
          ? `${basePrompt} ${options.prompt}`
          : basePrompt;

        // 调用 API
        const result = await callGeminiImageAPI(fullPrompt, refImageResult.base64);

        if (!result.success) {
          errors.push(
            createGenImageDiagnostic(
              GEN_IMAGE_ERROR_CODES.IMAGE_GENERATION_FAILED,
              `自拍生成失败：${result.error}`,
              "请检查 API Key 是否正确，参考图是否清晰"
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
          const imagesDir = getDefaultImagesDir();
          if (!existsSync(imagesDir)) {
            mkdirSync(imagesDir, { recursive: true });
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `selfie-${timestamp}.png`;
          outputPath = path.join(imagesDir, filename);
        }

        // 保存图片
        try {
          const dir = path.dirname(outputPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          const buffer = Buffer.from(result.imageData!, "base64");
          writeFileSync(outputPath, buffer);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(
            createGenImageDiagnostic(
              GEN_IMAGE_ERROR_CODES.OUTPUT_SAVE_FAILED,
              `保存图片失败：${message}`
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：保存图片失败`);
          }
          process.exit(1);
          return;
        }

        // 成功
        const data = {
          refImage: options.ref,
          outputPath,
          generatedAt: new Date().toISOString(),
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`自拍生成成功：${outputPath}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createGenImageDiagnostic(
            GEN_IMAGE_ERROR_CODES.IMAGE_GENERATION_FAILED,
            `自拍生成失败：${message}`
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
// Gen Image 命令组
// ============================================

export function createGenImageCommandGroup(): Command {
  const cmd = new Command("gen-image");

  cmd.description("AI 图片生成（image/selfie）");

  cmd.addCommand(createGenImageCommand());
  cmd.addCommand(createGenSelfieCommand());

  return cmd;
}

// ============================================
// 合同导出（help-docs 使用）
// ============================================

/**
 * 获取 gen image 命令合同
 */
export function getGenImageContract() {
  return {
    name: "msgcode gen image",
    description: "AI 图片生成（text-to-image）",
    options: {
      required: {
        "--prompt": "图片描述文本",
      },
      optional: {
        "--aspect-ratio": "宽高比（如 16:9, 4:3, 1:1）",
        "--output": "输出文件路径",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      prompt: "使用的 prompt（截断预览）",
      outputPath: "生成图片的绝对路径",
      aspectRatio: "宽高比",
      generatedAt: "生成时间（ISO 8601）",
    },
    errorCodes: [
      "GEN_API_KEY_MISSING",
      "GEN_INVALID_PROMPT",
      "GEN_IMAGE_GENERATION_FAILED",
      "GEN_OUTPUT_SAVE_FAILED",
    ],
  };
}

/**
 * 获取 gen selfie 命令合同
 */
export function getGenSelfieContract() {
  return {
    name: "msgcode gen selfie",
    description: "AI 自拍生成（基于参考图）",
    options: {
      required: {
        "--ref": "参考图片路径",
      },
      optional: {
        "--prompt": "可选的额外描述",
        "--output": "输出文件路径",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      refImage: "参考图片路径",
      outputPath: "生成图片的绝对路径",
      generatedAt: "生成时间（ISO 8601）",
    },
    errorCodes: [
      "GEN_API_KEY_MISSING",
      "GEN_REF_IMAGE_NOT_FOUND",
      "GEN_IMAGE_GENERATION_FAILED",
      "GEN_OUTPUT_SAVE_FAILED",
    ],
  };
}

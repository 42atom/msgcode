/**
 * msgcode: 图片理解 Runner（M4-IMG-P0）
 *
 * 职责：
 * - 调用 LM Studio Vision API (GLM-4V) 理解图片
 * - 支持 heic/heif 转换（通过 sips）
 * - 输出 artifacts/vision/<digest>.txt
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { logger } from "../logger/index.js";

const execAsync = promisify(exec);

// ============================================
// 类型定义
// ============================================

export interface VisionOcrResult {
  /** 是否成功 */
  success: boolean;
  /** OCR 文本路径 */
  textPath?: string;
  /** OCR 文本预览（前 300 字） */
  textPreview?: string;
  /** 错误信息 */
  error?: string;
  /** 处理耗时（毫秒） */
  durationMs?: number;
  /** 使用的模型 ID */
  modelId?: string;
}

export interface VisionOcrOptions {
  /** 工作区路径 */
  workspacePath: string;
  /** 图片路径 */
  imagePath: string;
  /** 用户提问（用于生成合适的提示词） */
  userQuery?: string;
  /** 模型 ID（可选，默认从配置读取） */
  modelId?: string;
  /** 超时时间（毫秒，默认 120000） */
  timeoutMs?: number;
  /** 最大文件大小（字节，默认 10MB） */
  maxBytes?: number;
}

// ============================================
// 常量
// ============================================

const VISION_TIMEOUT_MS = 120000;
const VISION_MAX_BYTES = 10485760; // 10MB
const MAX_IMAGE_DIMENSION = 2048; // 图片最大尺寸（宽或高）

// ============================================
// 辅助函数
// ============================================

/**
 * 检查文件是否为 HEIC/HEIF 格式
 */
function isHeicFormat(filePath: string): boolean {
  const ext = filePath.toLowerCase().split(".").pop();
  return ext === "heic" || ext === "heif";
}

/**
 * 转换 HEIC 到 JPEG（使用 sips）
 */
async function convertHeicToJpeg(
  heicPath: string,
  outputDir: string,
  digest: string
): Promise<{ success: boolean; jpegPath?: string; error?: string }> {
  try {
    await execAsync(`mkdir -p "${outputDir}"`);

    const jpegPath = join(outputDir, `${digest}.jpg`);

    // 使用 sips 转换
    await execAsync(`sips -s format jpeg "${heicPath}" --out "${jpegPath}"`, {
      timeout: 30000,
    });

    if (!existsSync(jpegPath)) {
      return { success: false, error: "sips 转换失败，输出文件不存在" };
    }

    return { success: true, jpegPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检查图片是否需要缩放（返回图片尺寸）
 */
function getImageDimensions(imagePath: string): { width: number; height: number } | null {
  try {
    const result = execSync(`sips -g pixelWidth -g pixelHeight "${imagePath}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const match = result.match(/pixelWidth: (\d+)\s+pixelHeight: (\d+)/);
    if (match) {
      return {
        width: parseInt(match[1], 10),
        height: parseInt(match[2], 10),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 缩放大图片（使用 sips，保持宽高比）
 */
async function resizeLargeImage(
  imagePath: string,
  outputDir: string,
  digest: string
): Promise<{ success: boolean; resizedPath?: string; error?: string }> {
  try {
    await execAsync(`mkdir -p "${outputDir}"`);

    const resizedPath = join(outputDir, `${digest}_resized.jpg`);

    // 使用 sips 缩放到最大尺寸（保持宽高比）
    await execAsync(
      `sips --resampleWidthMax ${MAX_IMAGE_DIMENSION} --resampleHeightMax ${MAX_IMAGE_DIMENSION} "${imagePath}" --out "${resizedPath}"`,
      { timeout: 30000 }
    );

    if (!existsSync(resizedPath)) {
      return { success: false, error: "sips 缩放失败，输出文件不存在" };
    }

    return { success: true, resizedPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 读取图片并转换为 base64
 */
async function readImageAsBase64(imagePath: string): Promise<{ success: boolean; base64?: string; error?: string }> {
  try {
    const buffer = await readFile(imagePath);
    const base64 = buffer.toString("base64");
    return { success: true, base64 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 获取 MIME 类型
 */
function getImageMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop();
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return mimeMap[ext || ""] || "image/jpeg";
}

// ============================================
// LM Studio Vision OCR
// ============================================

/**
 * 调用 LM Studio OpenAI 兼容 API 进行 Vision/OCR（带重试机制）
 *
 * P0-3: 硬策略处理 content 为空的情况：
 * - 如果 content 为空但有 reasoning_content → 视为失败（不要用 reasoning 做 OCR 文本）
 *
 * 重试机制：模型刚加载时可能不稳定，遇到 5xx 错误自动重试
 */
async function callLmStudioVisionOcr(
  imagePath: string,
  mimeType: string,
  modelId: string,
  timeoutMs: number,
  explicitOcr: boolean,
  userQuery?: string
): Promise<{ success: boolean; text?: string; error?: string; hasReasoningOnly?: boolean }> {
  // 重试配置：最多 2 次重试（总共 3 次尝试）
  const maxRetries = 2;
  const retryDelays = [1000, 2000]; // 重试间隔：1秒、2秒

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      logger.info(`Vision API 重试 ${attempt}/${maxRetries}`, {
        module: "vision_ocr",
        model: modelId,
        delay: retryDelays[attempt - 1],
      });
      await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
    }

    const result = await callLmStudioVisionOcrOnce(imagePath, mimeType, modelId, timeoutMs, explicitOcr, userQuery);

    if (result.success) {
      if (attempt > 0) {
        logger.info(`Vision API 重试成功`, {
          module: "vision_ocr",
          attempt,
        });
      }
      return result;
    }

    // 检查是否是可重试的错误（5xx 服务器错误）
    const isRetryable = result.error?.includes("LM Studio API 错误 (5") ||
                        result.error?.includes("503") ||
                        result.error?.includes("502") ||
                        result.error?.includes("500") ||
                        result.error?.includes("ECONNREFUSED") ||
                        result.error?.includes("ETIMEDOUT");

    if (!isRetryable || attempt >= maxRetries) {
      // 不可重试的错误，或已达到最大重试次数
      return result;
    }

    // 可重试，继续下一次尝试
    logger.warn(`Vision API 请求失败，准备重试`, {
      module: "vision_ocr",
      attempt,
      error: result.error,
    });
  }

  // 不应该到达这里
  return { success: false, error: "未知错误" };
}

/**
 * 单次 Vision API 调用（无重试）
 */
async function callLmStudioVisionOcrOnce(
  imagePath: string,
  mimeType: string,
  modelId: string,
  timeoutMs: number,
  explicitOcr: boolean,
  userQuery?: string
): Promise<{ success: boolean; text?: string; error?: string; hasReasoningOnly?: boolean }> {
  const baseUrl = (config.lmstudioBaseUrl || "http://127.0.0.1:1234").replace(/\/+$/, "");
  const url = `${baseUrl}/v1/chat/completions`;

  // 读取图片并转换为 base64
  const imageResult = await readImageAsBase64(imagePath);
  if (!imageResult.success || !imageResult.base64) {
    return { success: false, error: `读取图片失败: ${imageResult.error}` };
  }

  const base64Image = imageResult.base64;
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // 根据用户意图生成不同的提示词（统一使用 GLM-4.6V 模型）
  // - /ocr 模式：纯抽字，只输出图片中的文字原文（分行）
  // - 普通模式：视觉理解，简洁回答问题
  let prompt = "";

  if (explicitOcr) {
    // /ocr 模式：只输出图片中的文字原文，分行显示，不要任何解释
    prompt = "请提取这张图片中的所有文字内容，按原文分行输出，只输出文字原文，不要添加任何解释、说明或格式。";
  } else if (userQuery && userQuery.trim()) {
    // 视觉模型 + 用户提问：简洁回答，禁止分析过程
    prompt = `基于这张图片回答：${userQuery}\n\n要求：只输出最终答案，一句话说清楚，禁止分析、禁止解释、禁止列举细节。`;
  } else {
    // 视觉模型 + 无提问：简洁描述图片内容
    prompt = "用一句话简洁描述这张图片的内容，不要分析、不要解释。";
  }

  const requestBody = {
    model: modelId,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          {
            type: "image_url",
            image_url: {
              url: dataUrl,
            },
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 500,  // 限制输出长度，避免过长分析
  };

  try {
    // DEBUG: 记录请求信息
    logger.info("Vision API 请求", {
      module: "vision_ocr",
      model: modelId,
      promptLength: prompt.length,
      imageSize: base64Image.length,
      hasApiKey: !!config.lmstudioApiKey,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.lmstudioApiKey ? { "Authorization": `Bearer ${config.lmstudioApiKey}` } : {}),
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `LM Studio API 错误 (${response.status}): ${errorText.slice(0, 200)}` };
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
        };
      }>;
    };
    const content = data.choices?.[0]?.message?.content;
    const reasoningContent = data.choices?.[0]?.message?.reasoning_content;

    // DEBUG: 记录响应信息
    logger.info("Vision API 响应", {
      module: "vision_ocr",
      contentType: typeof content,
      contentLength: (typeof content === "string" ? content.length : 0),
      contentPreview: (typeof content === "string" ? content.slice(0, 100) : ""),
      hasReasoning: !!reasoningContent,
      reasoningLength: (typeof reasoningContent === "string" ? reasoningContent.length : 0),
      hasChoices: !!data.choices,
    });

    // P0-3: 硬策略处理 content 为空
    if (content && typeof content === "string" && content.trim()) {
      // 有 content：直接使用
      return { success: true, text: content.trim() };
    }

    // content 为空或未定义
    if (reasoningContent && typeof reasoningContent === "string") {
      // P0-3: 只有 reasoning_content，说明模型被截断/未完成
      logger.warn("Vision API 只返回 reasoning content，未返回最终答案（视为失败）", {
        module: "vision_ocr",
        model: modelId,
        reasoningLength: reasoningContent.length,
      });
      // 返回特殊标记，触发 fallback
      return { success: false, error: "模型只输出 reasoning content，被截断/未完成", hasReasoningOnly: true };
    }

    // 既没有 content 也没有 reasoning_content
    return { success: false, error: "LM Studio 未返回文本内容" };
  } catch (error) {
    logger.error("Vision API 调用异常", {
      module: "vision_ocr",
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================
// 主入口
// ============================================

/**
 * 执行 Vision OCR
 *
 * @param options OCR 选项
 * @returns OCR 结果
 */
export async function runVisionOcr(options: VisionOcrOptions): Promise<VisionOcrResult> {
  const startTime = Date.now();
  const result: VisionOcrResult = { success: false };

  const {
    workspacePath,
    imagePath,
    timeoutMs = parseInt(process.env.VISION_TIMEOUT_MS || String(VISION_TIMEOUT_MS), 10),
    maxBytes = parseInt(process.env.VISION_MAX_BYTES || String(VISION_MAX_BYTES), 10),
  } = options;

  // 统一使用 LMSTUDIO_VISION_MODEL（GLM-4.6V），不再切换模型
  const modelId = process.env.LMSTUDIO_VISION_MODEL || "huihui-glm-4.6v-flash-abliterated-mlx";
  const userQuery = (options.userQuery || "").trim();

  // 检测是否明确要求 OCR（决定输出模式：纯抽字 vs 理解回答）
  const explicitOcr = /ocr/i.test(userQuery);

  // 1. 检查文件存在
  if (!existsSync(imagePath)) {
    result.error = `图片文件不存在: ${imagePath}`;
    return result;
  }

  // 2. 检查文件大小
  const stats = await readFile(imagePath);
  if (stats.length > maxBytes) {
    result.error = `图片过大 (${(stats.length / 1024 / 1024).toFixed(1)}MB > ${(maxBytes / 1024 / 1024).toFixed(1)}MB)`;
    return result;
  }

  // 3. HEIC/HEIF 转换
  let actualImagePath = imagePath;
  if (isHeicFormat(imagePath)) {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    const buffer = await readFile(imagePath);
    hash.update(buffer);
    const digest = hash.digest("hex").slice(0, 12);

    const visionInputDir = join(workspacePath, "artifacts", "vision", "input");
    const convertResult = await convertHeicToJpeg(imagePath, visionInputDir, digest);

    if (!convertResult.success || !convertResult.jpegPath) {
      result.error = `HEIC 转换失败: ${convertResult.error}`;
      return result;
    }

    actualImagePath = convertResult.jpegPath;
  }

  // 3.5 检查并缩放大图片（避免高分辨率图片导致 API 问题）
  const dimensions = getImageDimensions(actualImagePath);
  if (dimensions && (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION)) {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    const buffer = await readFile(actualImagePath);
    hash.update(buffer);
    const digest = hash.digest("hex").slice(0, 12);

    const visionInputDir = join(workspacePath, "artifacts", "vision", "input");
    const resizeResult = await resizeLargeImage(actualImagePath, visionInputDir, digest);

    if (resizeResult.success && resizeResult.resizedPath) {
      actualImagePath = resizeResult.resizedPath;
      logger.info("图片已缩放", {
        module: "vision_ocr",
        originalSize: `${dimensions.width}x${dimensions.height}`,
        maxSize: MAX_IMAGE_DIMENSION,
      });
    }
    // 缩放失败不阻塞，继续使用原图
  }

  // 4. 获取 MIME 类型
  const mimeType = getImageMimeType(actualImagePath);

  // 5. 计算 digest（用于输出文件名）
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  const imageBuffer = await readFile(actualImagePath);
  hash.update(imageBuffer);
  const digest = hash.digest("hex").slice(0, 12);

  // 6. 检查是否已有 OCR 结果（去重）
  const visionDir = join(workspacePath, "artifacts", "vision");
  const existingPath = join(visionDir, `${digest}.txt`);

  if (existsSync(existingPath)) {
    const existingText = await readFile(existingPath, "utf-8");
    result.success = true;
    result.textPath = existingPath;
    result.textPreview = existingText.slice(0, 300);
    result.durationMs = Date.now() - startTime;
    result.modelId = modelId;
    return result;
  }

  // 7. 调用 LM Studio Vision API
  const ocrResult = await callLmStudioVisionOcr(actualImagePath, mimeType, modelId, timeoutMs, explicitOcr, options.userQuery);

  if (!ocrResult.success || !ocrResult.text) {
    result.error = ocrResult.error || "识别失败";
    return result;
  }

  // 8. 保存 OCR 结果
  const { mkdir } = await import("node:fs/promises");
  await mkdir(visionDir, { recursive: true });

  const { writeFile } = await import("node:fs/promises");
  await writeFile(existingPath, ocrResult.text, "utf-8");

  result.success = true;
  result.textPath = existingPath;
  result.textPreview = ocrResult.text.slice(0, 300);
  result.durationMs = Date.now() - startTime;
  result.modelId = modelId;

  return result;
}

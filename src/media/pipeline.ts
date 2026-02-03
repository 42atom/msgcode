/**
 * msgcode: MediaPipeline（M4-A 媒体处理流水线）
 *
 * 职责：
 * - 自动处理附件（audio/image/pdf）→ 生成派生文本
 * - 去重（digest key）+ 限流（lane queue）
 * - 失败不崩（优雅降级）
 */

import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ImsgAttachment } from "../attachments/vault.js";
import { isAudioAttachment, isImageAttachment } from "../attachments/vault.js";
import { resolveMlxWhisper } from "../runners/utils.js";

// ============================================
// 配置常量
// ============================================

const ASR_MAX_BYTES = parseInt(process.env.ASR_MAX_BYTES || "26214400"); // 25MB
const ASR_TIMEOUT_MS = parseInt(process.env.ASR_TIMEOUT_MS || "300000"); // 5 分钟
const AUTO_MEDIA = process.env.AUTO_MEDIA === "1";
const AUTO_ASR = process.env.AUTO_ASR === "1";
const AUTO_VISION = process.env.AUTO_VISION === "1"; // M4-IMG-P0: 自动视觉处理

// ============================================
// 类型定义
// ============================================

/**
 * 派生文本结果
 */
export interface DerivedText {
  /** 派生类型（asr/ocr/image/pdf） */
  kind: string;
  /** 状态（ok/unavailable/error） */
  status: "ok" | "unavailable" | "error";
  /** 派生文本文件路径 */
  textPath?: string;
  /** 文本 SHA256 digest（短） */
  textDigest?: string;
  /** 文本预览（前 300 字） */
  textPreview?: string;
  /** 错误原因（unavailable/error 时） */
  reason?: string;
  /** 错误详情 */
  error?: string;
}

/**
 * 附件处理结果
 */
export interface AttachmentProcessResult {
  /** 附件 digest */
  digest: string;
  /** Vault 路径 */
  vaultPath: string;
  /** 派生文本 */
  derived?: DerivedText;
}

/**
 * MediaPipeline 配置
 */
export interface MediaPipelineConfig {
  /** 工作区路径 */
  workspacePath: string;
  /** 是否自动处理媒体 */
  autoMedia?: boolean;
}

// ============================================
// 工具函数
// ============================================

/**
 * 获取 artifacts 目录
 */
function getArtifactsDir(workspacePath: string): string {
  return join(workspacePath, "artifacts");
}

/**
 * 获取 ASR 产物目录
 */
function getAsrDir(workspacePath: string): string {
  return join(getArtifactsDir(workspacePath), "asr");
}

/**
 * 读取文件前 N 字
 */
async function readFilePreview(filePath: string, maxBytes: number = 300): Promise<string> {
  try {
    const buffer = await readFile(filePath);
    const preview = buffer.toString("utf-8").slice(0, maxBytes);
    return preview + (buffer.length > maxBytes ? "..." : "");
  } catch {
    return "";
  }
}

/**
 * 检查是否已存在派生文本（去重）
 */
async function hasExistingDerivedText(
  workspacePath: string,
  digest: string,
  kind: string
): Promise<string | null> {
  const artifactsDir = getArtifactsDir(workspacePath);
  const kindDir = kind === "asr" ? getAsrDir(workspacePath) : join(artifactsDir, kind);
  const txtPath = join(kindDir, `${digest}.txt`);

  if (existsSync(txtPath)) {
    return txtPath;
  }
  return null;
}

/**
 * 计算 SHA256 digest（短）
 */
async function calculateDigest(filePath: string): Promise<string> {
  const crypto = await import("node:crypto");
  const hash = crypto.createHash("sha256");
  const buffer = await readFile(filePath);
  hash.update(buffer);
  return hash.digest("hex").slice(0, 12);
}

// ============================================
// ASR 处理
// ============================================

/**
 * 处理音频附件（ASR 转写）
 */
async function processAudio(
  vaultPath: string,
  digest: string,
  workspacePath: string
): Promise<DerivedText> {
  const result: DerivedText = {
    kind: "asr",
    status: "unavailable",
  };

  // 检查是否已存在（去重）
  const existingPath = await hasExistingDerivedText(workspacePath, digest, "asr");
  if (existingPath) {
    result.status = "ok";
    result.textPath = existingPath;
    result.textPreview = await readFilePreview(existingPath, 300);
    return result;
  }

  // 检查文件大小
  const stats = await readFile(vaultPath);
  if (stats.length > ASR_MAX_BYTES) {
    result.reason = `文件过大 (${(stats.length / 1024 / 1024).toFixed(1)}MB > ${(ASR_MAX_BYTES / 1024 / 1024).toFixed(1)}MB)`;
    return result;
  }

  // 检查 mlx_whisper 是否可用（兼容 mlx_whisper 和 mlx-whisper）
  const whisperResult = await resolveMlxWhisper();
  if (!whisperResult.ok || !whisperResult.binName) {
    result.reason = "mlx-whisper 不可用";
    return result;
  }

  // 检查模型是否存在
  const modelPath = join(process.env.HOME || "", "Models", "whisper-large-v3-mlx");
  if (!existsSync(modelPath)) {
    result.reason = "Whisper 模型不存在";
    return result;
  }

  // 执行 ASR
  const asrDir = getAsrDir(workspacePath);
  await mkdir(asrDir, { recursive: true });

  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    const outputPath = join(asrDir, `${digest}.txt`);
    const binName = whisperResult.binName!;

    // E17: 强制中文转写（避免中英漂移）
    const asrLanguage = process.env.ASR_LANGUAGE || "zh";
    const asrInitialPrompt = process.env.ASR_INITIAL_PROMPT || "请用中文转写，数字用阿拉伯数字，'乘以'不要写成'成'";

    await execAsync(
      `${binName} "${vaultPath}" --model "${modelPath}" --output-dir "${asrDir}" --output-name "${digest}" --task transcribe --language ${asrLanguage} --temperature 0 --initial-prompt "${asrInitialPrompt}"`,
      { timeout: ASR_TIMEOUT_MS }
    );

    // mlx-whisper 输出文件名可能是 input_name.txt，需要检查
    const actualPath = existsSync(outputPath)
      ? outputPath
      : join(asrDir, `${vaultPath.split("/").pop()}.txt`);

    if (existsSync(actualPath)) {
      result.status = "ok";
      result.textPath = actualPath;
      result.textPreview = await readFilePreview(actualPath, 300);
    } else {
      result.status = "error";
      result.error = "ASR 输出文件未生成";
    }
  } catch (err) {
    result.status = "error";
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * 处理图片附件（M4-IMG-P0: Vision OCR）
 */
async function processImage(
  vaultPath: string,
  digest: string,
  workspacePath: string,
  userQuery?: string
): Promise<DerivedText> {
  const result: DerivedText = {
    kind: "vision_ocr",
    status: "unavailable",
  };

  // 检查是否启用自动视觉处理
  if (!AUTO_VISION) {
    result.reason = "AUTO_VISION 未启用";
    return result;
  }

  try {
    const { runVisionOcr } = await import("../runners/vision_ocr.js");

    const ocrResult = await runVisionOcr({
      workspacePath,
      imagePath: vaultPath,
      userQuery,
    });

    if (ocrResult.success && ocrResult.textPath && ocrResult.textPreview) {
      result.status = "ok";
      result.textPath = ocrResult.textPath;
      result.textPreview = ocrResult.textPreview;
    } else {
      const errorMsg = ocrResult.error || "OCR 失败";

      // 区分"模型能力边界"和"真正的错误"
      // paddleocr-vl-1.5 对极小图/纯色图会报：too blurry、尺寸不够、image too small 等
      const isModelCapabilityBoundary = /too blurry|尺寸不够|image too small|resolution too low|low quality|blurry/i.test(errorMsg);

      if (isModelCapabilityBoundary) {
        result.status = "unavailable";
        result.reason = errorMsg;
      } else {
        result.status = "error";
        result.error = errorMsg;
      }
    }
  } catch (err) {
    result.status = "error";
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * 处理文档附件（占位）
 */
async function processDoc(
  vaultPath: string,
  digest: string,
  workspacePath: string
): Promise<DerivedText> {
  // TODO: 后续接 extractor
  return {
    kind: "doc",
    status: "unavailable",
    reason: "文档提取暂未实现（待 extractor）",
  };
}

// ============================================
// Pipeline 主入口
// ============================================

/**
 * 处理附件（生成派生文本）
 *
 * @param vaultPath Vault 中的附件路径
 * @param attachment iMessage 附件信息
 * @param workspacePath 工作区路径
 * @param userQuery 用户提问（用于优化 Vision OCR 提示词）
 * @returns 处理结果
 */
export async function processAttachment(
  vaultPath: string,
  attachment: ImsgAttachment,
  workspacePath: string,
  userQuery?: string
): Promise<AttachmentProcessResult> {
  const digest = await calculateDigest(vaultPath);
  const result: AttachmentProcessResult = {
    digest,
    vaultPath,
  };

  // 检查是否启用自动媒体处理
  if (!AUTO_MEDIA) {
    return result;
  }

  // 判断附件类型（B2: 使用 vault.ts 的类型检查函数，支持 mime/UTI/扩展名兜底）
  const isAudio = isAudioAttachment(attachment);
  const isImage = isImageAttachment(attachment);
  const isPdf = attachment.mime === "application/pdf";

  // 处理音频
  if (isAudio && AUTO_ASR) {
    result.derived = await processAudio(vaultPath, digest, workspacePath);
  }
  // 处理图片
  else if (isImage) {
    result.derived = await processImage(vaultPath, digest, workspacePath, userQuery);
  }
  // 处理文档（占位）
  else if (isPdf) {
    result.derived = await processDoc(vaultPath, digest, workspacePath);
  }

  return result;
}

/**
 * B3: 格式化派生文本为自然语言格式
 *
 * - ASR/Vision OCR: 读取 textPath 文件内容（可控全文）
 * - 其他情况: 输出详细标记
 */
export async function formatDerivedForTmux(derived: DerivedText): Promise<string> {
  const maxChars = parseInt(process.env.DERIVED_MAX_CHARS || "2000", 10);

  // ASR 转写：读取全文（带截断控制）
  if (derived.kind === "asr" && derived.status === "ok" && derived.textPath) {
    const text = await readDerivedText(derived.textPath, maxChars);
    const oneLine = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\s*\n+\s*/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    return `[语音转写] ${oneLine}`;
  }

  // Vision OCR：读取全文（带截断控制）
  if (derived.kind === "vision_ocr" && derived.status === "ok" && derived.textPath) {
    const text = await readDerivedText(derived.textPath, maxChars);
    const oneLine = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\s*\n+\s*/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    return `[图片文字] ${oneLine}`;
  }

  // 其他情况：输出详细标记
  const parts = [
    "[derived]",
    `kind=${derived.kind}`,
    `status=${derived.status}`,
  ];

  if (derived.textPath) {
    parts.push(`text_path=${derived.textPath}`);
  }

  if (derived.textDigest) {
    parts.push(`text_digest=${derived.textDigest}`);
  }

  if (derived.textPreview) {
    parts.push(`text_preview=${derived.textPreview}`);
  }

  if (derived.reason) {
    parts.push(`reason=${derived.reason}`);
  }

  if (derived.error) {
    parts.push(`error=${derived.error}`);
  }

  return parts.join("\n");
}

/**
 * B3: 读取派生文本文件内容（带截断控制）
 */
async function readDerivedText(textPath: string, maxChars: number): Promise<string> {
  try {
    const content = await readFile(textPath, "utf-8");
    if (content.length <= maxChars) {
      return content;
    }
    // 截断并标记
    return content.slice(0, maxChars) + "...(truncated)";
  } catch {
    // 文件读取失败，返回空
    return "";
  }
}

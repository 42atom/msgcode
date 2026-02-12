/**
 * msgcode: Attachment Vault（M4-A2）
 *
 * 职责：
 * - 将 iMessage 附件复制到 workspace 的 attachments/inbox/
 * - 按日期分区：YYYY-MM-DD/<msgId>_<name>.<ext>
 * - 支持去重（跳过相同 hash）
 * - 处理 missing=true 的附件
 */

import { mkdir, copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

// ============================================
// 类型定义
// ============================================

/**
 * iMessage 附件（来自 imsg rpc）
 */
export interface ImsgAttachment {
  filename?: string;
  mime?: string;
  path?: string;
  missing?: boolean;
  uti?: string;
  transfer_name?: string;
}

/**
 * Vault 复制结果
 */
export interface VaultCopyResult {
  /** 是否成功 */
  success: boolean;
  /** 复制后的本地路径 */
  localPath?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 是否跳过（已存在） */
  skipped?: boolean;
  /** 文件 SHA256 digest */
  digest?: string;
}

// ============================================
// 路径工具
// ============================================

/**
 * 展开路径中的 ~
 */
function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return homedir() + path.slice(1);
  }
  return path;
}

/**
 * 获取 inbox 目录路径（按日期分区）
 */
function getInboxDir(workspacePath: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
  return join(workspacePath, "attachments", "inbox", dateStr);
}

/**
 * 生成稳定文件名：msgId_originalName 或 msgId_digest
 *
 * E17: 尽量保留文件扩展名（从 path 提取作为兜底）
 */
function generateFilename(
  msgId: string,
  attachment: ImsgAttachment
): string {
  // 1. 尝试从 transfer_name 或 filename 获取扩展名
  let originalName = attachment.transfer_name || attachment.filename || "attachment";
  let ext = "";

  // 检查是否已有扩展名
  const nameParts = originalName.split(".");
  if (nameParts.length > 1 && nameParts[nameParts.length - 1].length >= 2 && nameParts[nameParts.length - 1].length <= 6) {
    ext = `.${nameParts.pop()}`;
    originalName = nameParts.join(".");
  }

  // 2. 如果没有扩展名，尝试从 path 提取
  if (!ext && attachment.path) {
    const pathParts = attachment.path.split(".");
    if (pathParts.length > 1) {
      const pathExt = pathParts[pathParts.length - 1];
      // 验证是常见扩展名（避免误判）
      if (pathExt.length >= 2 && pathExt.length <= 6 && /^[a-z0-9]+$/i.test(pathExt)) {
        ext = `.${pathExt}`;
      }
    }
  }

  // 移除原始文件名的特殊字符
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${msgId}_${safeName}${ext}`;
}

// ============================================
// Hash 计算
// ============================================

/**
 * 计算文件 SHA256 digest
 */
async function calculateFileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const buffer = await readFile(filePath);
  hash.update(buffer);
  return hash.digest("hex");
}

/**
 * 计算短 digest（前 12 位）
 */
async function calculateShortDigest(filePath: string): Promise<string> {
  const fullHash = await calculateFileHash(filePath);
  return fullHash.slice(0, 12);
}

// ============================================
// Vault 操作
// ============================================

/**
 * 复制附件到 vault
 *
 * @param workspacePath 工作区路径
 * @param msgId 消息 ID（message.guid）
 * @param attachment iMessage 附件
 * @returns 复制结果
 */
export async function copyToVault(
  workspacePath: string,
  msgId: string,
  attachment: ImsgAttachment
): Promise<VaultCopyResult> {
  const result: VaultCopyResult = {
    success: false,
  };

  try {
    // 处理 missing=true 的附件
    if (attachment.missing || !attachment.path) {
      result.error = attachment.missing
        ? "附件已丢失 (missing=true)"
        : "附件路径为空";
      return result;
    }

    const sourcePath = expandPath(attachment.path);

    // 验证源文件存在
    if (!existsSync(sourcePath)) {
      result.error = `源文件不存在: ${sourcePath}`;
      return result;
    }

    // 创建目标目录
    const inboxDir = getInboxDir(workspacePath);
    await mkdir(inboxDir, { recursive: true });

    // 生成目标文件名
    const filename = generateFilename(msgId, attachment);
    const targetPath = join(inboxDir, filename);

    // 检查目标文件是否已存在（去重）
    if (existsSync(targetPath)) {
      // 计算源文件和目标文件的 hash
      const sourceHash = await calculateShortDigest(sourcePath);
      const targetHash = await calculateShortDigest(targetPath);

      if (sourceHash === targetHash) {
        result.success = true;
        result.skipped = true;
        result.localPath = targetPath;
        result.digest = sourceHash;
        return result;
      }

      // hash 不同，追加版本号
      let version = 2;
      let versionedPath: string;
      do {
        const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
        const baseName = ext ? filename.slice(0, filename.lastIndexOf(".")) : filename;
        versionedPath = join(inboxDir, `${baseName}.v${version}${ext}`);
        version++;
      } while (existsSync(versionedPath));

      await copyFile(sourcePath, versionedPath);
      result.success = true;
      result.localPath = versionedPath;
      result.digest = sourceHash;
      return result;
    }

    // 复制文件
    await copyFile(sourcePath, targetPath);
    result.success = true;
    result.localPath = targetPath;
    result.digest = await calculateShortDigest(targetPath);

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/**
 * 检查附件是否为音频
 */
export function isAudioAttachment(attachment: ImsgAttachment): boolean {
  if (!attachment.mime && !attachment.uti) {
    return false;
  }

  // 检查 mime type
  if (attachment.mime?.startsWith("audio/")) {
    return true;
  }

  // 检查 UTI（Apple Uniform Type Identifier）
  const audioUtis = [
    "public.audio",
    "public.mp3",
    "public.mpeg-4-audio",
    "com.apple.m4a-audio",
    "com.apple.coreaudio-format",
    "public.aiff-audio",
    "public.wav-audio",
  ];
  if (attachment.uti && audioUtis.includes(attachment.uti)) {
    return true;
  }

  return false;
}

/**
 * B2: 检查附件是否为图片（支持 mime/UTI/扩展名兜底）
 */
export function isImageAttachment(attachment: ImsgAttachment): boolean {
  if (!attachment.mime && !attachment.uti && !attachment.filename) {
    return false;
  }

  // 检查 mime type
  if (attachment.mime?.startsWith("image/")) {
    return true;
  }

  // 检查 UTI（Apple Uniform Type Identifier）
  const imageUtis = [
    "public.image",
    "public.jpeg",
    "public.png",
    "public.gif",
    "public.tiff",
    "com.apple.icns",
  ];
  if (attachment.uti && imageUtis.includes(attachment.uti)) {
    return true;
  }

  // 扩展名兜底（mime 缺失时）
  if (attachment.filename) {
    const ext = attachment.filename.toLowerCase().split(".").pop();
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp"];
    if (ext && imageExts.includes(ext)) {
      return true;
    }
  }

  return false;
}

/**
 * 生成 tmux 注入文本
 *
 * E17: 对于音频附件，不输出文件路径（LM Studio 无法处理 .caf）
 * 对于其他附件，保留路径信息以便后续处理
 */
export function formatAttachmentForTmux(
  attachment: ImsgAttachment,
  localPath: string,
  digest: string
): string {
  const isAudio = isAudioAttachment(attachment);

  // 音频附件：只输出类型标记（不输出路径，后续会输出 ASR 转写）
  if (isAudio) {
    return `[attachment]\ntype=audio\naudio_transcript_follows=true\n`;
  }

  // 其他附件：保留完整信息
  const parts = [
    "[attachment]",
    `type=file`,
  ];

  if (attachment.mime) {
    parts.push(`mime=${attachment.mime}`);
  }

  parts.push(`path=${localPath}`);
  parts.push(`digest=${digest}`);

  return parts.join("\n");
}

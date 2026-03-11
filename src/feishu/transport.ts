/**
 * msgcode: Feishu（飞书）WebSocket Transport（MVP）
 *
 * 目标：
 * - 通过飞书长连接模式（WSClient）接收事件 `im.message.receive_v1`
 * - 将事件转换为 msgcode 统一的 InboundMessage
 * - 通过 OpenAPI 回发文本消息（MVP：仅 text；file 先降级）
 *
 * 资料来源：
 * - 飞书开放平台 Node SDK：@larksuiteoapi/node-sdk
 * - 长连接模式示例：README.zh.md「使用长链模式处理事件」
 */

import { Client, EventDispatcher, LoggerLevel, WSClient } from "@larksuiteoapi/node-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { InboundMessage } from "../channels/types.js";
import { logger } from "../logger/index.js";

export const FEISHU_CHAT_GUID_PREFIX = "feishu:";

export function isFeishuChatGuid(chatGuid: string): boolean {
  return chatGuid.startsWith(FEISHU_CHAT_GUID_PREFIX);
}

export function toFeishuChatGuid(chatId: string): string {
  return `${FEISHU_CHAT_GUID_PREFIX}${chatId}`;
}

export function fromFeishuChatGuid(chatGuid: string): string {
  if (!isFeishuChatGuid(chatGuid)) {
    throw new Error(`非飞书 chatGuid: ${chatGuid}`);
  }
  return chatGuid.slice(FEISHU_CHAT_GUID_PREFIX.length);
}

type FeishuContentInspection = {
  contentKind: "empty" | "json-string" | "text-string" | "object" | "other";
  topLevelKeys: string[];
  resourceKey?: string;
  resourceKeyField?: string;
  fileName?: string;
  preview?: string;
};

type FeishuInboundResourceType = "audio" | "image" | "file";

type FeishuInboundAttachmentSpec = {
  resourceType: FeishuInboundResourceType;
  resourceKey: string;
  filename: string;
  mime?: string;
};

type FeishuResourceDownloadType = "image" | "file";

function parseFeishuTextContent(content: unknown): string | undefined {
  if (!content) return undefined;

  // SDK 的 data.message.content 在文档中为 JSON 字符串
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content) as any;
      const text = typeof parsed?.text === "string" ? parsed.text : undefined;
      return text?.trim() ? text.trim() : undefined;
    } catch {
      // 非 JSON：直接当作文本（保守兜底）
      const t = content.trim();
      return t ? t : undefined;
    }
  }

  // 兼容：某些中间层可能提前 parse 成 object
  if (typeof content === "object") {
    const text = typeof (content as any)?.text === "string" ? (content as any).text : undefined;
    return text?.trim() ? text.trim() : undefined;
  }

  return undefined;
}

function inspectFeishuContent(content: unknown): FeishuContentInspection {
  if (content === null || content === undefined) {
    return { contentKind: "empty", topLevelKeys: [] };
  }

  let parsed: unknown = content;
  let contentKind: FeishuContentInspection["contentKind"] = "other";
  let preview: string | undefined;

  if (typeof content === "string") {
    const trimmed = content.trim();
    preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
    if (!trimmed) {
      return { contentKind: "empty", topLevelKeys: [] };
    }
    try {
      parsed = JSON.parse(trimmed);
      contentKind = "json-string";
    } catch {
      return {
        contentKind: "text-string",
        topLevelKeys: [],
        preview,
      };
    }
  } else if (typeof content === "object") {
    contentKind = "object";
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      contentKind,
      topLevelKeys: [],
      preview,
    };
  }

  const record = parsed as Record<string, unknown>;
  const topLevelKeys = Object.keys(record).sort();
  const keyFields = ["file_key", "image_key", "audio_key", "media_key"] as const;
  const resourceKeyField = keyFields.find((field) => typeof record[field] === "string");
  const resourceKey = resourceKeyField ? String(record[resourceKeyField]) : undefined;
  const fileNameFields = ["file_name", "name", "title"] as const;
  const fileNameField = fileNameFields.find((field) => typeof record[field] === "string");
  const fileName = fileNameField ? String(record[fileNameField]) : undefined;

  if (!preview) {
    const json = JSON.stringify(record);
    preview = json.length > 200 ? `${json.slice(0, 200)}...` : json;
  }

  return {
    contentKind,
    topLevelKeys,
    resourceKey,
    resourceKeyField,
    fileName,
    preview,
  };
}

function normalizeFeishuMessageType(msgType: unknown): string {
  if (typeof msgType !== "string") return "unknown";
  const trimmed = msgType.trim();
  return trimmed || "unknown";
}

function normalizeFeishuChatType(chatType: unknown): string | undefined {
  if (typeof chatType !== "string") return undefined;
  const trimmed = chatType.trim();
  return trimmed || undefined;
}

function resolveFeishuIsGroup(chatType: unknown): boolean | undefined {
  const normalized = normalizeFeishuChatType(chatType);
  if (!normalized) return undefined;
  return normalized === "group";
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).trim();
  if (!base) return "attachment.bin";
  return base.replace(/[\\/]/g, "_");
}

function inferMimeFromFilename(filename: string, msgType: FeishuInboundResourceType): string | undefined {
  const ext = path.extname(filename).toLowerCase();
  if (msgType === "audio") {
    switch (ext) {
      case ".opus":
        return "audio/opus";
      case ".mp3":
        return "audio/mpeg";
      case ".m4a":
        return "audio/mp4";
      case ".wav":
        return "audio/wav";
      default:
        return "audio/unknown";
    }
  }

  if (msgType === "image") {
    switch (ext) {
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".gif":
        return "image/gif";
      case ".webp":
        return "image/webp";
      case ".bmp":
        return "image/bmp";
      case ".tif":
      case ".tiff":
        return "image/tiff";
      case ".png":
      default:
        return "image/png";
    }
  }

  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".html":
      return "text/html";
    case ".txt":
      return "text/plain";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    default:
      return "application/octet-stream";
  }
}

function resolveFeishuInboundAttachmentSpec(
  msgType: string | undefined,
  messageId: string,
  content: unknown
): FeishuInboundAttachmentSpec | null {
  if (msgType !== "audio" && msgType !== "image" && msgType !== "file") {
    return null;
  }

  const inspection = inspectFeishuContent(content);
  if (!inspection.resourceKey) {
    return null;
  }

  const fallbackFilename = (() => {
    if (msgType === "audio") return `${messageId}.opus`;
    if (msgType === "image") return `${messageId}.png`;
    return `${messageId}.bin`;
  })();

  const filename = sanitizeFilename(inspection.fileName || fallbackFilename);
  const mime = inferMimeFromFilename(filename, msgType);

  return {
    resourceType: msgType,
    resourceKey: inspection.resourceKey,
    filename,
    mime,
  };
}

async function downloadFeishuMessageResource(
  apiClient: Client,
  messageId: string,
  spec: FeishuInboundAttachmentSpec
): Promise<string> {
  const tempDir = path.join(process.env.TMPDIR || "/tmp", "msgcode-feishu-inbound");
  await fs.mkdir(tempDir, { recursive: true });
  const localPath = path.join(tempDir, `${messageId}_${sanitizeFilename(spec.filename)}`);

  const response = await apiClient.im.messageResource.get({
    params: {
      type: spec.resourceType === "image" ? "image" : "file",
    },
    path: {
      message_id: messageId,
      file_key: spec.resourceKey,
    },
  } as any);

  await response.writeFile(localPath);
  return localPath;
}

export interface FeishuTransportConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  /** 事件回调（必须尽快返回，避免触发飞书 3s 超时重推） */
  onInbound: (message: InboundMessage) => void;
}

export interface FeishuTransport {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  send: (params: { chat_guid: string; text: string; file?: string }) => Promise<{
    ok: boolean;
    error?: string;
    attachmentType?: "file" | "image";
    attachmentKey?: string;
    fallbackTextSent?: boolean;
  }>;
}

function resolveFeishuFileType(filePath: string): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "mp4";
    case ".opus":
      return "opus";
    case ".pdf":
      return "pdf";
    case ".doc":
    case ".docx":
      return "doc";
    case ".xls":
    case ".xlsx":
    case ".csv":
      return "xls";
    case ".ppt":
    case ".pptx":
      return "ppt";
    default:
      return "stream";
  }
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff", ".tif", ".bmp", ".ico"].includes(ext);
}

function getFeishuErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const maybeResponse = (error as Error & {
    response?: {
      status?: number;
      data?: Record<string, unknown>;
    };
  }).response;

  if (!maybeResponse) {
    return error.message;
  }

  const parts: string[] = [];
  if (typeof maybeResponse.status === "number") {
    parts.push(`HTTP ${maybeResponse.status}`);
  }

  const data = maybeResponse.data;
  if (data) {
    const code = typeof data.code === "number" || typeof data.code === "string" ? String(data.code) : "";
    const msg = typeof data.msg === "string" ? data.msg : "";
    if (code) parts.push(`code=${code}`);
    if (msg) parts.push(msg);
  }

  return parts.length > 0 ? parts.join(" ") : error.message;
}

export function createFeishuTransport(config: FeishuTransportConfig): FeishuTransport {
  const baseConfig = {
    appId: config.appId,
    appSecret: config.appSecret,
    // 仅做本地 transport：尽量降低 SDK 的 stdout 噪声
    loggerLevel: LoggerLevel.error,
  };

  const apiClient = new Client(baseConfig as any);
  const wsClient = new WSClient(baseConfig as any);

  const dispatcher = new EventDispatcher({
    encryptKey: config.encryptKey,
    loggerLevel: LoggerLevel.error,
  }).register({
    "im.message.receive_v1": async (data: any) => {
      try {
        const message = data?.message;
        const sender = data?.sender?.sender_id || data?.sender || {};
        const senderType = data?.sender?.sender_type;

        // 仅处理用户消息；避免 system/app 事件导致回路
        if (senderType && senderType !== "user") {
          return;
        }

        const chatId = message?.chat_id;
        const messageId = message?.message_id;
        const msgType = message?.message_type;

        if (!chatId || !messageId) {
          logger.warn("Feishu 事件缺少关键字段，已忽略", {
            module: "feishu",
            hasChatId: Boolean(chatId),
            hasMessageId: Boolean(messageId),
          });
          return;
        }

        // MVP：仅处理文本；其他类型先降级为提示文本
        let text: string | undefined;
        if (msgType === "text") {
          text = parseFeishuTextContent(message?.content);
        } else {
          text = undefined;
        }
        const contentInspection = inspectFeishuContent(message?.content);

        const messageTypeLabel = normalizeFeishuMessageType(msgType);

        const chatTypeLabel = normalizeFeishuChatType(message?.chat_type);
        const inboundBase: InboundMessage = {
          id: String(messageId),
          chatId: toFeishuChatGuid(String(chatId)),
          text,
          isFromMe: false,
          // 飞书事件时间为字符串毫秒（部分场景为秒），这里不强依赖，先不填
          sender: sender?.open_id || sender?.user_id || sender?.union_id,
          handle: sender?.open_id || sender?.user_id || sender?.union_id,
          senderName: undefined,
          isGroup: resolveFeishuIsGroup(message?.chat_type),
          messageType: messageTypeLabel,
        };

        logger.info(
          `Feishu 入站事件 msgType=${messageTypeLabel} messageId=${String(messageId)} contentKind=${contentInspection.contentKind} resourceKeyField=${contentInspection.resourceKeyField ?? "none"} resourceKey=${contentInspection.resourceKey ?? "none"} fileName=${contentInspection.fileName ?? "none"}`,
          {
          module: "feishu",
          chatId: inboundBase.chatId,
          rawChatId: String(chatId),
          messageId: String(messageId),
          msgType: messageTypeLabel,
          hasText: Boolean(inboundBase.text),
          attachmentMapped: Boolean(inboundBase.attachments && inboundBase.attachments.length > 0),
          contentKind: contentInspection.contentKind,
          contentKeys: contentInspection.topLevelKeys,
          resourceKeyField: contentInspection.resourceKeyField ?? null,
          resourceKey: contentInspection.resourceKey ?? null,
          fileName: contentInspection.fileName ?? null,
          contentPreview: contentInspection.preview ?? null,
          chatType: chatTypeLabel ?? null,
          isGroup: inboundBase.isGroup ?? null,
        });

        if (msgType === "text") {
          // 关键点：不要 await，避免触发 3s 超时重推
          config.onInbound(inboundBase);
          return;
        }

        const attachmentSpec = resolveFeishuInboundAttachmentSpec(messageTypeLabel, String(messageId), message?.content);
        if (!attachmentSpec) {
          logger.info(
            `Feishu 非文本消息尚未映射为附件 msgType=${messageTypeLabel} resourceKeyField=${contentInspection.resourceKeyField ?? "none"} resourceKey=${contentInspection.resourceKey ?? "none"} fileName=${contentInspection.fileName ?? "none"}`,
            {
              module: "feishu",
              chatId: inboundBase.chatId,
              msgType: messageTypeLabel,
              attachmentMapped: false,
              resourceKeyField: contentInspection.resourceKeyField ?? null,
              resourceKey: contentInspection.resourceKey ?? null,
              fileName: contentInspection.fileName ?? null,
            }
          );
          return;
        }

        void (async () => {
          try {
            const localPath = await downloadFeishuMessageResource(apiClient, String(messageId), attachmentSpec);
            const inboundWithAttachment: InboundMessage = {
              ...inboundBase,
              attachments: [
                {
                  filename: attachmentSpec.filename,
                  transfer_name: attachmentSpec.filename,
                  mime: attachmentSpec.mime,
                  path: localPath,
                  missing: false,
                },
              ],
            };

            logger.info(
              `Feishu 非文本消息已映射为附件 msgType=${messageTypeLabel} localPath=${localPath} mime=${attachmentSpec.mime ?? "none"} fileName=${attachmentSpec.filename}`,
              {
                module: "feishu",
                chatId: inboundBase.chatId,
                msgType: messageTypeLabel,
                messageId: String(messageId),
                attachmentMapped: true,
                localPath,
                mime: attachmentSpec.mime ?? null,
                fileName: attachmentSpec.filename,
              }
            );

            config.onInbound(inboundWithAttachment);
          } catch (downloadError) {
            logger.warn(
              `Feishu 非文本消息资源下载失败 msgType=${messageTypeLabel} resourceKey=${attachmentSpec.resourceKey} fileName=${attachmentSpec.filename}`,
              {
                module: "feishu",
                chatId: inboundBase.chatId,
                msgType: messageTypeLabel,
                messageId: String(messageId),
                resourceKey: attachmentSpec.resourceKey,
                fileName: attachmentSpec.filename,
                error: downloadError instanceof Error ? downloadError.message : String(downloadError),
              }
            );
          }
        })();
      } catch (error) {
        logger.error("Feishu 事件处理失败", {
          module: "feishu",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  async function start(): Promise<void> {
    logger.info("Feishu WS transport 启动中", {
      module: "feishu",
      appId: config.appId,
    });

    wsClient.start({
      eventDispatcher: dispatcher as any,
    });

    logger.info("Feishu WS transport 已启动", { module: "feishu" });
  }

  async function stop(): Promise<void> {
    try {
      wsClient.close();
    } catch {
      // ignore
    }
    logger.info("Feishu WS transport 已停止", { module: "feishu" });
  }

  /**
   * 上传文件到飞书服务器，获取 file_key
   *
   * @param params.filePath 本地文件路径
   * @returns file_key 或错误信息
   */
  async function uploadFile(params: { filePath: string }): Promise<{ ok: boolean; file_key?: string; error?: string }> {
    try {
      // 验证文件存在
      const fileStats = await fs.stat(params.filePath);
      if (!fileStats.isFile()) {
        return { ok: false, error: "文件不存在或不是常规文件" };
      }

      // 飞书文件上传限制：30MB，超出直接失败
      const MAX_FILE_SIZE = 30 * 1024 * 1024;
      if (fileStats.size > MAX_FILE_SIZE) {
        return { ok: false, error: `文件超过大小限制（${MAX_FILE_SIZE / 1024 / 1024}MB）` };
      }

      // 读取文件内容
      const fileContent = await fs.readFile(params.filePath);

      // 使用飞书 SDK 上传文件
      // 参考：https://open.feishu.cn/document/server-docs/im-v1/file/create
      const response: any = await apiClient.im.file.create({
        data: {
          file_type: resolveFeishuFileType(params.filePath),
          file_name: path.basename(params.filePath),
          file: fileContent,
        },
      } as any);

      const fileKey = response?.file_key || response?.data?.file_key;
      if (fileKey) {
        logger.info("Feishu 文件上传成功", {
          module: "feishu",
          filePath: params.filePath,
          fileKey,
          fileSize: fileStats.size,
        });
        return { ok: true, file_key: fileKey };
      }

      return { ok: false, error: response?.msg || "上传失败" };
    } catch (error) {
      const errorMessage = getFeishuErrorMessage(error);
      logger.error("Feishu 文件上传失败", {
        module: "feishu",
        filePath: params.filePath,
        error: errorMessage,
      });
      return { ok: false, error: errorMessage };
    }
  }

  async function uploadImage(params: { filePath: string }): Promise<{ ok: boolean; image_key?: string; error?: string }> {
    try {
      const fileStats = await fs.stat(params.filePath);
      if (!fileStats.isFile()) {
        return { ok: false, error: "图片不存在或不是常规文件" };
      }

      const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
      if (fileStats.size > MAX_IMAGE_SIZE) {
        return { ok: false, error: `图片超过大小限制（${MAX_IMAGE_SIZE / 1024 / 1024}MB）` };
      }

      const fileContent = await fs.readFile(params.filePath);
      const response: any = await apiClient.im.image.create({
        data: {
          image_type: "message",
          image: fileContent,
        },
      } as any);

      const imageKey = response?.image_key || response?.data?.image_key;
      if (imageKey) {
        logger.info("Feishu 图片上传成功", {
          module: "feishu",
          filePath: params.filePath,
          imageKey,
          fileSize: fileStats.size,
        });
        return { ok: true, image_key: imageKey };
      }

      return { ok: false, error: response?.msg || "图片上传失败" };
    } catch (error) {
      const errorMessage = getFeishuErrorMessage(error);
      logger.error("Feishu 图片上传失败", {
        module: "feishu",
        filePath: params.filePath,
        error: errorMessage,
      });
      return { ok: false, error: errorMessage };
    }
  }

  async function send(params: { chat_guid: string; text: string; file?: string }): Promise<{
    ok: boolean;
    error?: string;
    attachmentType?: "file" | "image";
    attachmentKey?: string;
    fallbackTextSent?: boolean;
  }> {
    const chatGuid = params.chat_guid;
    if (!isFeishuChatGuid(chatGuid)) {
      throw new Error(`Feishu send 收到非 feishu chatGuid: ${chatGuid}`);
    }

    const chatId = fromFeishuChatGuid(chatGuid);
    const text = (params.text ?? "").trim();

    // MVP：file 先降级为提示文本（后续补 resource upload + messageResource）
    let finalText = text;
    let fileError: string | undefined;
    let attachmentType: "file" | "image" | undefined;
    let attachmentKey: string | undefined;

    if (params.file) {
      const treatAsImage = isImageFile(params.file);
      const imageUploadResult = treatAsImage
        ? await uploadImage({ filePath: params.file })
        : null;
      const fileUploadResult = treatAsImage
        ? null
        : await uploadFile({ filePath: params.file });
      const uploadResult = imageUploadResult ?? fileUploadResult;

      if (!uploadResult || !uploadResult.ok) {
        // 上传失败，降级为提示文本
        const errorMsg = uploadResult?.error || (treatAsImage ? "图片上传失败" : "文件上传失败");
        fileError = errorMsg;
        finalText = text ? `${text}\n\n[${treatAsImage ? "图片" : "文件"}发送失败：${errorMsg}]` : `[${treatAsImage ? "图片" : "文件"}发送失败：${errorMsg}]`;
      } else {
        attachmentType = treatAsImage ? "image" : "file";
        const resourceKey = treatAsImage
          ? imageUploadResult?.image_key
          : fileUploadResult?.file_key;
        attachmentKey = resourceKey;

        try {
          await apiClient.im.message.create({
            params: {
              receive_id_type: "chat_id",
            },
            data: {
              receive_id: chatId,
              msg_type: treatAsImage ? "image" : "file",
              content: JSON.stringify(
                treatAsImage
                  ? { image_key: resourceKey }
                  : { file_key: resourceKey }
              ),
            },
          } as any);

          // 如果有文本，也一起发送
          if (text) {
            await apiClient.im.message.create({
              params: {
                receive_id_type: "chat_id",
              },
              data: {
                receive_id: chatId,
                msg_type: "text",
                content: JSON.stringify({ text }),
              },
            } as any);
          }

          logger.info(treatAsImage ? "Feishu 图片消息发送成功" : "Feishu 文件消息发送成功", {
            module: "feishu",
            chatGuid,
            filePath: params.file,
            ...(treatAsImage ? { imageKey: resourceKey } : { fileKey: resourceKey }),
          });

          return {
            ok: true,
            attachmentType,
            attachmentKey,
          };
        } catch (error) {
          const errorMessage = getFeishuErrorMessage(error);
          logger.error(treatAsImage ? "Feishu 图片消息发送失败" : "Feishu 文件消息发送失败", {
            module: "feishu",
            chatGuid,
            filePath: params.file,
            ...(treatAsImage ? { imageKey: resourceKey } : { fileKey: resourceKey }),
            error: errorMessage,
          });

          // 降级为提示文本
          const errorMsg = errorMessage;
          fileError = errorMsg;
          attachmentType = undefined;
          attachmentKey = undefined;
          finalText = text ? `${text}\n\n[${treatAsImage ? "图片" : "文件"}发送失败：${errorMsg}]` : `[${treatAsImage ? "图片" : "文件"}发送失败：${errorMsg}]`;
        }
      }
    }

    if (!finalText) {
      return { ok: true, attachmentType, attachmentKey };
    }

    try {
      await apiClient.im.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: finalText }),
        },
      } as any);

      return {
        ok: true,
        error: fileError,
        attachmentType,
        attachmentKey,
        fallbackTextSent: Boolean(fileError),
      };
    } catch (error) {
      const errorMessage = getFeishuErrorMessage(error);
      logger.error("Feishu 发送失败", {
        module: "feishu",
        chatGuid,
        error: errorMessage,
      });
      return { ok: false, error: errorMessage, attachmentType, attachmentKey };
    }
  }

  return { start, stop, send };
}

export const __test = process.env.NODE_ENV === "test"
  ? {
      inspectFeishuContent,
      normalizeFeishuMessageType,
      normalizeFeishuChatType,
      resolveFeishuIsGroup,
      resolveFeishuInboundAttachmentSpec,
    }
  : undefined;

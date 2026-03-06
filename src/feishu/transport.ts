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
import type { InboundMessage } from "../imsg/types.js";
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
  send: (params: { chat_guid: string; text: string; file?: string }) => Promise<{ ok: boolean }>;
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

        const inbound: InboundMessage = {
          id: String(messageId),
          chatId: toFeishuChatGuid(String(chatId)),
          text,
          isFromMe: false,
          // 飞书事件时间为字符串毫秒（部分场景为秒），这里不强依赖，先不填
          sender: sender?.open_id || sender?.user_id || sender?.union_id,
          handle: sender?.open_id || sender?.user_id || sender?.union_id,
          senderName: undefined,
          isGroup: message?.chat_type ? String(message.chat_type) === "group" : undefined,
        };

        // 关键点：不要 await，避免触发 3s 超时重推
        config.onInbound(inbound);

        // 非文本消息：也交给上层（允许 /where 之类由用户发文本触发）
        if (!inbound.text && msgType && msgType !== "text") {
          logger.debug("Feishu 非文本消息已收到（MVP 忽略内容）", {
            module: "feishu",
            chatId: inbound.chatId,
            msgType,
          });
        }
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

  async function send(params: { chat_guid: string; text: string; file?: string }): Promise<{ ok: boolean }> {
    const chatGuid = params.chat_guid;
    if (!isFeishuChatGuid(chatGuid)) {
      throw new Error(`Feishu send 收到非 feishu chatGuid: ${chatGuid}`);
    }

    const chatId = fromFeishuChatGuid(chatGuid);
    const text = (params.text ?? "").trim();

    // MVP：file 先降级为提示文本（后续补 resource upload + messageResource）
    const finalText = params.file
      ? (text ? `${text}\n\n[附件已生成于本机路径，飞书 transport 暂不支持回传文件（MVP）]` : "[附件已生成于本机路径，飞书 transport 暂不支持回传文件（MVP）]")
      : text;

    if (!finalText) {
      return { ok: true };
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

      return { ok: true };
    } catch (error) {
      logger.error("Feishu 发送失败", {
        module: "feishu",
        chatGuid,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false };
    }
  }

  return { start, stop, send };
}


/**
 * msgcode: imsg 消息适配器
 *
 * 将 imsg RPC payload 转成 channel-neutral InboundMessage。
 */

import type { InboundMessage } from "../channels/types.js";
import type { ImsgRpcMessage, ImsgAttachment } from "./types.js";
export { isGroupChatId, normalizeChatId, stableGroupNameForChatId } from "../channels/chat-id.js";

// ============================================
// imsg RPC 消息适配器
// ============================================

/**
 * 从 imsg RPC 的 watch 消息通知转换为 InboundMessage
 *
 * 字段映射：
 * - message.id(rowid) → id
 * - message.chat_guid → chatId（与现有 msgcode 的 guid 路由对齐；无则回退到 chat_id）
 * - message.text → text
 * - message.is_from_me → isFromMe
 * - message.created_at(ISO8601) → date(ms)
 * - message.sender → sender/handle
 * - attachments → attachments
 */
export function fromImsgRpcMessage(message: ImsgRpcMessage): InboundMessage {
  const chat_id = message.chat_id; // 保留 rowid 用于调试
  const chatId = message.chat_guid || String(chat_id);

  const dateMs = Date.parse(message.created_at);
  return {
    id: String(message.id),
    chatId, // chat_guid 优先
    text: typeof message.text === "string" ? message.text : undefined,
    isFromMe: message.is_from_me,
    date: Number.isFinite(dateMs) ? dateMs : undefined,
    attachments: message.attachments?.map((att: ImsgAttachment) => ({
      filename: att.filename,
      mime: att.mime_type,
      path: att.original_path,
      missing: att.missing,
      uti: att.uti,
      transfer_name: att.transfer_name,
      total_bytes: att.total_bytes,
    })),
    sender: message.sender || undefined,
    senderName: undefined,
    handle: message.sender || undefined,
    rowid: message.id, // E14: 传递 rowid 用于游标管理
    isGroup: typeof message.is_group === "boolean" ? message.is_group : undefined,
  };
}

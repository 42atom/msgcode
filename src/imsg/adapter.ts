/**
 * msgcode: imsg 消息适配器
 *
 * 将各种消息源转换为统一的 InboundMessage 接口
 */

import type { InboundMessage } from "./types.js";
import type { ImsgRpcMessage, ImsgAttachment } from "./types.js";

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
  };
}

// ============================================
// 辅助函数
// ============================================

/**
 * 判断是否为群聊 chatId
 *
 * 群聊格式：
 * - 纯 GUID (32位十六进制) 或
 * - any;+;GUID
 */
export function isGroupChatId(chatId: string): boolean {
  return /^[a-f0-9]{32}$/i.test(chatId) || chatId.startsWith("any;+;");
}

/**
 * 归一化 chatId
 *
 * 提取 GUID 部分（去掉 any;+; 或 any;-; 前缀）
 */
export function normalizeChatId(chatId: string): string {
  const parts = chatId.split(";");
  return parts[parts.length - 1];
}

/**
 * 为 tmux 会话生成稳定的 groupName
 *
 * 约束：
 * - 不依赖 label（/bind 改目录不应导致会话名漂移）
 * - 仅使用 chatId 的稳定后缀
 */
export function stableGroupNameForChatId(chatId: string): string {
  const normalized = normalizeChatId(chatId);
  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;
  return `chat-${suffix}`;
}

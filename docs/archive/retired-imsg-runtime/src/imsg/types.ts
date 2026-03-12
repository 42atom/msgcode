/**
 * msgcode: imsg RPC 类型定义
 *
 * JSON-RPC over stdio 协议类型
 */
export type { Attachment, InboundMessage } from "../channels/types.js";

// ============================================
// imsg RPC JSON-RPC 类型
// ============================================

/**
 * JSON-RPC 2.0 请求
 */
export interface ImsgRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 响应
 */
export interface ImsgRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * JSON-RPC 2.0 通知（无 id 字段）
 */
export interface ImsgRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// ============================================
// imsg RPC 方法特定类型
// ============================================

/**
 * chats.list 方法参数
 */
export interface ChatsListParams {
  limit?: number;
}

/**
 * chats.list 方法结果
 */
export interface ChatsListResult {
  chats: ChatInfo[];
}

/**
 * 聊天信息
 */
export interface ChatInfo {
  service: string;
  name?: string;
  participants: string[];
  last_message_at?: string;
  guid: string;
  is_group: boolean;
  identifier: string;
  id: number;
}

/**
 * watch.subscribe 方法参数
 */
export interface WatchSubscribeParams {
  /**
   * 限定 chat rowid（推荐用 rowid 做过滤；不传表示订阅所有 chat）
   */
  chat_id?: number;
  /**
   * 从某个消息 rowid 之后开始（用于断点续传/避免历史积压）
   */
  since_rowid?: number;
  /**
   * 按参与者过滤（电话/邮箱 handle）
   */
  participants?: string[];
  /**
   * ISO8601 时间过滤：start (inclusive)
   */
  start?: string;
  /**
   * ISO8601 时间过滤：end (exclusive)
   */
  end?: string;
  /**
   * 是否包含附件元信息（默认 false；建议订阅时打开）
   */
  attachments?: boolean;
}

/**
 * watch.subscribe 方法结果
 */
export interface WatchSubscribeResult {
  subscription: number;
}

/**
 * watch 消息通知参数（method=message）
 *
 * 这是 watch.subscribe 推送的新消息通知
 */
export interface ImsgRpcWatchMessageParams {
  subscription: number;
  message: ImsgRpcMessage;
}

/**
 * imsg RPC 的 Message payload（docs/rpc.md 定义）
 */
export interface ImsgRpcMessage {
  /** 消息 rowid */
  id: number;
  /** chat rowid（始终存在；官方推荐用于路由） */
  chat_id: number;
  /** 消息 GUID（注意：这是消息 guid，不是 chat guid） */
  guid: string;
  /** reply_to_guid（可选） */
  reply_to_guid?: string;
  /** 发送者 handle（电话/邮箱） */
  sender: string;
  /** 是否本人发送 */
  is_from_me: boolean;
  /** 文本（可能为 null） */
  text: string | null;
  /** ISO8601 */
  created_at: string;
  /** 附件列表 */
  attachments?: ImsgAttachment[];
  /** reactions 列表（可选；暂不解析） */
  reactions?: unknown[];
  /** chat identifier */
  chat_identifier?: string;
  /** chat guid（用于与现有 msgcode 的 guid 路由对齐） */
  chat_guid?: string;
  /** chat name */
  chat_name?: string;
  /** participants */
  participants?: string[];
  /** 是否群聊 */
  is_group?: boolean;
}

/**
 * imsg 附件格式
 */
export interface ImsgAttachment {
  filename?: string;
  transfer_name?: string;
  uti?: string;
  mime_type?: string;
  total_bytes?: number;
  is_sticker?: boolean;
  original_path?: string;
  missing?: boolean;
}

/**
 * send 方法参数
 *
 * 支持多种目标参数（至少一个）
 */
export interface SendParams {
  /** 电话号码或邮箱（与 chat_id/chat_guid/chat_identifier 三选一） */
  to?: string;
  /** 聊天 rowid */
  chat_id?: number;
  /** 聊天 GUID */
  chat_guid?: string;
  /** 聊天标识符（如 iMessage;+;chat...） */
  chat_identifier?: string;
  /** 消息文本 */
  text: string;
  /** 附件路径（可选） */
  file?: string;
  /** 服务类型（可选） */
  service?: "imessage" | "sms" | "auto";
}

/**
 * send 方法结果
 */
export interface SendResult {
  ok: boolean;
}

// ============================================
// 类型守卫
// ============================================

/**
 * 判断是否为 JSON-RPC 通知（无 id 字段）
 */
export function isNotification(obj: unknown): obj is ImsgRpcNotification {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "jsonrpc" in obj &&
    "method" in obj &&
    !("id" in obj)
  );
}

/**
 * 判断是否为 JSON-RPC 响应（有 id 字段）
 */
export function isResponse(obj: unknown): obj is ImsgRpcResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "jsonrpc" in obj &&
    "id" in obj
  );
}

/**
 * 判断是否为 watch 消息通知
 */
export function isWatchMessageNotification(
  obj: unknown
): obj is ImsgRpcNotification & { params: ImsgRpcWatchMessageParams } {
  return (
    isNotification(obj) &&
    obj.method === "message" &&
    obj.params !== undefined &&
    typeof obj.params === "object" &&
    "subscription" in obj.params &&
    "message" in obj.params
  );
}

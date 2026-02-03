/**
 * msgcode: imsg RPC 类型定义
 *
 * JSON-RPC over stdio 协议类型
 */

// ============================================
// 统一消息接口（listener 实际使用的字段）
// ============================================

/**
 * 入站消息接口（listener 依赖的字段集）
 *
 * 根据 src/listener.ts 实际使用情况：
 * - id: 去重、已处理缓存（handledMessages, processedMessages）
 * - chatId: 路由、白名单检查、队列管理
 * - text: 消息内容、去重
 * - isFromMe: 过滤自身消息
 * - date: 排序（仅用于 checkExistingMessages 中排序）
 * - attachments: 流式处理时传递
 * - sender: security.ts checkWhitelist 需要
 * - handle: security.ts checkWhitelist 需要
 * - address: handlers.ts 可能需要
 */
export interface InboundMessage {
  /** 消息唯一标识 */
  id: string;
  /** 聊天 ID（可能是 rowid 或 GUID） */
  chatId: string;
  /** 消息文本（可选，空消息跳过） */
  text?: string;
  /** 是否为本人发送（用于过滤自我回路） */
  isFromMe: boolean;
  /** 消息日期（Unix timestamp 微秒，Apple 格式） */
  date?: number;
  /** 附件列表（可选） */
  attachments?: readonly Attachment[];
  /** 发送者地址（电话/邮箱；白名单检查需要） */
  sender?: string;
  /** 发送者显示名（可选；日志展示需要） */
  senderName?: string;
  /** 处理标识（兼容旧字段，可与 sender 相同） */
  handle?: string;
  /** E14: 消息 rowid（用于游标管理） */
  rowid?: number;
}

/**
 * 附件元数据
 */
export interface Attachment {
  /** 文件名 */
  filename?: string;
  /** MIME 类型 */
  mime?: string;
  /** 文件路径 */
  path?: string;
  /** 文件是否缺失 */
  missing?: boolean;
  /** E17: UTI（Apple Uniform Type Identifier）- 用于 .caf 等音频识别 */
  uti?: string;
  /** E17: 原始传输文件名（比 filename 更可靠） */
  transfer_name?: string;
  /** E17: 文件大小（字节） */
  total_bytes?: number;
}

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

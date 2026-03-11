/**
 * msgcode: channel-neutral 入站消息类型
 *
 * 这层只描述主链真正消费的消息字段，不绑定具体 transport。
 */

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
  /** Apple Uniform Type Identifier；本地通道有值时可透传 */
  uti?: string;
  /** 原始传输文件名（比 filename 更可靠） */
  transfer_name?: string;
  /** 文件大小（字节） */
  total_bytes?: number;
}

/**
 * 入站消息接口（listener / handler 主链实际消费的字段）
 */
export interface InboundMessage {
  /** 消息唯一标识 */
  id: string;
  /** 通道内部聊天 ID */
  chatId: string;
  /** 消息文本（可选，空消息跳过） */
  text?: string;
  /** 是否为本人发送（用于过滤自我回路） */
  isFromMe: boolean;
  /** 消息日期（Unix timestamp 毫秒） */
  date?: number;
  /** 附件列表（可选） */
  attachments?: readonly Attachment[];
  /** 发送者地址/handle */
  sender?: string;
  /** 发送者显示名（可选） */
  senderName?: string;
  /** 兼容旧字段，可与 sender 相同 */
  handle?: string;
  /** 原始消息 rowid（通道支持时填充） */
  rowid?: number;
  /** 是否群聊（通道支持时填充） */
  isGroup?: boolean;
  /** 消息类型（如 text/image/audio/file） */
  messageType?: string;
}

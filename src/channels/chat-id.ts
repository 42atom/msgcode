/**
 * msgcode: channel-neutral chatId 工具
 *
 * 当前仍兼容历史群聊 chatId 形态，同时允许其他通道直接透传。
 */

/**
 * 判断是否为历史群聊 chatId
 *
 * 群聊格式：
 * - 纯 GUID (32 位十六进制)
 * - any;+;GUID
 */
export function isGroupChatId(chatId: string): boolean {
  return /^[a-f0-9]{32}$/i.test(chatId) || chatId.startsWith("any;+;");
}

/**
 * 归一化 chatId
 *
 * 对历史兼容形态提取 GUID；其他通道保持原样。
 */
export function normalizeChatId(chatId: string): string {
  const parts = chatId.split(";");
  return parts[parts.length - 1];
}

/**
 * 为 tmux 会话生成稳定 groupName
 *
 * 约束：
 * - 不依赖 label（/bind 改目录不应导致会话名漂移）
 * - 仅使用 chatId 的稳定后缀
 */
export function stableGroupNameForChatId(chatId: string): string {
  const normalized = normalizeChatId(chatId);
  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;
  const safe = suffix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `chat-${safe || "unknown"}`;
}

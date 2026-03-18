import type { ToolName } from "./types.js";

const TOOL_PREVIEW_MAX_CHARS = 4000;

function clipPreviewText(text: string, maxChars = TOOL_PREVIEW_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3)}...`;
}

export function buildToolErrorPreviewText(tool: ToolName, message: string): string {
  return clipPreviewText([
    `[${tool}] error`,
    message,
  ].join("\n"));
}

export function buildReadFilePreviewText(params: {
  filePath: string;
  content: string;
  byteLength: number;
  truncated: boolean;
}): string {
  const lines = [
    `[read_file] path=${params.filePath}`,
    `[bytes] ${params.byteLength}`,
    params.truncated ? "[status] truncated-preview" : "[status] inline-full",
    "[content]",
    params.content,
  ];
  return clipPreviewText(lines.join("\n"));
}

export function buildHelpDocsPreviewText(params: {
  version: string;
  query?: string;
  matchedCommands: number;
  totalCommands: number;
  commandNames: string[];
}): string {
  const lines = [
    `[help_docs] version=${params.version}`,
    params.query ? `[query] ${params.query}` : "[query] <all>",
    `[matched] ${params.matchedCommands}/${params.totalCommands}`,
  ];
  if (params.commandNames.length > 0) {
    lines.push("[commands]");
    lines.push(...params.commandNames.map((name) => `- ${name}`));
  }
  return clipPreviewText(lines.join("\n"));
}

export function buildWriteFilePreviewText(params: {
  filePath: string;
  bytesWritten: number;
}): string {
  return clipPreviewText([
    `[write_file] path=${params.filePath}`,
    `[bytesWritten] ${params.bytesWritten}`,
  ].join("\n"));
}

export function buildEditFilePreviewText(params: {
  filePath: string;
  editsApplied: number;
}): string {
  return clipPreviewText([
    `[edit_file] path=${params.filePath}`,
    `[editsApplied] ${params.editsApplied}`,
  ].join("\n"));
}

export function buildFeishuSendFilePreviewText(params: {
  chatId: string;
  attachmentType?: "file" | "image";
  attachmentKey?: string;
  receipt?: string;
}): string {
  const lines = [`[feishu_send_file] chatId=${params.chatId}`];
  if (params.attachmentType) {
    lines.push(`[attachmentType] ${params.attachmentType}`);
  }
  if (params.attachmentKey) {
    lines.push(`[attachmentKey] ${params.attachmentKey}`);
  }
  if (params.receipt) {
    lines.push(`[receipt] ${params.receipt}`);
  }
  return clipPreviewText(lines.join("\n"));
}

export function buildFeishuListMembersPreviewText(params: {
  chatId: string;
  memberTotal: number;
  members: Array<{ senderId: string; name: string }>;
}): string {
  const lines = [
    `[feishu_list_members] chatId=${params.chatId}`,
    `[memberTotal] ${params.memberTotal}`,
  ];
  const roster = params.members.slice(0, 5).map((member) => member.name || member.senderId);
  if (roster.length > 0) {
    lines.push("[members]");
    lines.push(...roster.map((name) => `- ${name}`));
  }
  return clipPreviewText(lines.join("\n"));
}

export function buildFeishuRecentMessagesPreviewText(params: {
  chatId: string;
  count: number;
  messages: Array<{ textSnippet: string; senderId: string; messageType: string }>;
}): string {
  const lines = [
    `[feishu_list_recent_messages] chatId=${params.chatId}`,
    `[count] ${params.count}`,
  ];
  const snippets = params.messages.slice(0, 5).map((message) => {
    const snippet = (message.textSnippet || "").trim() || `<${message.messageType}>`;
    return `- ${message.senderId}: ${snippet}`;
  });
  if (snippets.length > 0) {
    lines.push("[messages]");
    lines.push(...snippets);
  }
  return clipPreviewText(lines.join("\n"));
}

export function buildFeishuReplyPreviewText(params: {
  repliedToMessageId: string;
  messageId: string;
  replyInThread: boolean;
}): string {
  return clipPreviewText([
    `[feishu_reply_message] repliedTo=${params.repliedToMessageId}`,
    `[messageId] ${params.messageId}`,
    `[replyInThread] ${params.replyInThread ? "true" : "false"}`,
  ].join("\n"));
}

export function buildFeishuReactPreviewText(params: {
  messageId: string;
  emojiType: string;
  reactionId?: string;
}): string {
  const lines = [
    `[feishu_react_message] messageId=${params.messageId}`,
    `[emojiType] ${params.emojiType}`,
  ];
  if (params.reactionId) {
    lines.push(`[reactionId] ${params.reactionId}`);
  }
  return clipPreviewText(lines.join("\n"));
}

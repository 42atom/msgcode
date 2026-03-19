import type { ToolName } from "./types.js";

const TOOL_PREVIEW_MAX_CHARS = 4000;
const READ_FILE_PREVIEW_MAX_CHARS = 512;

function clipPreviewText(text: string, maxChars = TOOL_PREVIEW_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3)}...`;
}

function clipPreviewTailText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(text.length - maxChars);
  return `...${text.slice(text.length - (maxChars - 3))}`;
}

function extractTaggedBlock(content: string, tag: "head" | "tail"): string {
  const marker = `[${tag}]`;
  const nextMarker = tag === "head" ? "[tail]" : "";
  const start = content.indexOf(marker);
  if (start < 0) return "";
  const after = content.slice(start + marker.length).trimStart();
  if (!nextMarker) return after.trim();
  const nextIndex = after.indexOf(nextMarker);
  return (nextIndex >= 0 ? after.slice(0, nextIndex) : after).trim();
}

function extractLastNonEmptyLine(text: string): string {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line) {
      return line;
    }
  }
  return "";
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
  if (params.truncated) {
    const head = extractTaggedBlock(params.content, "head");
    const tail = extractTaggedBlock(params.content, "tail");
    const lastNonEmptyLine = tail ? extractLastNonEmptyLine(tail) : "";
    const baseLines = [
      `[read_file] path=${params.filePath}`,
      `[bytes] ${params.byteLength}`,
      "[status] truncated-preview",
    ];
    const sectionCount = Number(Boolean(head)) + Number(Boolean(tail));
    const fixedOverhead = baseLines.join("\n").length
      + (lastNonEmptyLine ? "\n[lastNonEmptyLine]\n".length : 0)
      + (head ? "\n[head]\n".length : 0)
      + (tail ? "\n[tail]\n".length : 0);
    const contentBudget = Math.max(0, READ_FILE_PREVIEW_MAX_CHARS - fixedOverhead);
    const lastLineBudget = lastNonEmptyLine
      ? Math.min(160, Math.max(64, Math.floor(contentBudget * 0.35)))
      : 0;
    const remainingBudget = Math.max(0, contentBudget - lastLineBudget);
    const headBudget = sectionCount > 1 ? Math.floor(remainingBudget / 2) : remainingBudget;
    const tailBudget = sectionCount > 1 ? remainingBudget - headBudget : remainingBudget;
    const lines = [...baseLines];
    if (lastNonEmptyLine) {
      lines.push("[lastNonEmptyLine]");
      lines.push(clipPreviewTailText(lastNonEmptyLine, lastLineBudget));
    }
    if (head) {
      lines.push("[head]");
      lines.push(clipPreviewText(head, Math.max(headBudget, 0)));
    }
    if (tail) {
      lines.push("[tail]");
      lines.push(clipPreviewTailText(tail, Math.max(tailBudget, 0)));
    }
    return lines.join("\n");
  }

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

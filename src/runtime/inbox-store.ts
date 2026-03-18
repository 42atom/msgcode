import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { Attachment, InboundMessage } from "../channels/types.js";
import { atomicWriteFile } from "./fs-atomic.js";

export type InboxRequestState = "new" | "triaged";

export interface InboxRequestRecord {
  requestNumber: string;
  state: InboxRequestState;
  transport: string;
  slug: string;
  path: string;
}

const INBOX_FILE_PATTERN =
  /^(?<requestNumber>rq\d{4})\.(?<state>new|triaged)\.(?<transport>[a-z0-9-]+)\.(?<slug>[a-z0-9-]+)\.md$/i;

function getInboxDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "inbox");
}

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildInboxSlug(message: InboundMessage): string {
  const fromText = sanitizeSegment((message.text || "").slice(0, 80));
  if (fromText) {
    return fromText;
  }

  if (message.attachments?.length) {
    const firstAttachmentName = sanitizeSegment(
      message.attachments[0]?.filename || message.attachments[0]?.transfer_name || ""
    );
    if (firstAttachmentName) {
      return firstAttachmentName;
    }
    return "attachment-message";
  }

  const fromType = sanitizeSegment(message.messageType || "");
  if (fromType) {
    return `${fromType}-message`;
  }

  return "message";
}

async function nextInboxRequestNumber(inboxDir: string): Promise<string> {
  if (!existsSync(inboxDir)) {
    return "rq0001";
  }

  const files = await readdir(inboxDir);
  let maxId = 0;

  for (const file of files) {
    const match = INBOX_FILE_PATTERN.exec(file);
    if (!match?.groups?.requestNumber) {
      continue;
    }
    const numericId = Number(match.groups.requestNumber.slice(2));
    if (Number.isFinite(numericId)) {
      maxId = Math.max(maxId, numericId);
    }
  }

  return `rq${String(maxId + 1).padStart(4, "0")}`;
}

function toIsoTime(date: number | undefined): string {
  if (typeof date === "number" && Number.isFinite(date)) {
    return new Date(date).toISOString();
  }
  return new Date().toISOString();
}

function renderAttachmentLines(attachments: readonly Attachment[] | undefined): string[] {
  if (!attachments || attachments.length === 0) {
    return ["- (none)"];
  }

  return attachments.map((attachment) => {
    const parts = [
      attachment.filename || attachment.transfer_name || "attachment",
      attachment.mime ? `mime=${attachment.mime}` : "",
      attachment.path ? `path=${attachment.path}` : "",
      attachment.total_bytes ? `bytes=${attachment.total_bytes}` : "",
      attachment.missing ? "missing=true" : "",
    ].filter(Boolean);
    return `- ${parts.join(" ")}`;
  });
}

function renderInboxRequest(params: {
  message: InboundMessage;
  createdAt: string;
}): string {
  const { message, createdAt } = params;
  const transport = sanitizeSegment(message.transport || "unknown") || "unknown";
  const relatedTask = "";
  const text = (message.text || "").trim();
  const textDigest = text
    ? crypto.createHash("sha256").update(text).digest("hex").slice(0, 12)
    : "";

  const lines = [
    "---",
    "owner: agent",
    "assignee: codex",
    "reviewer: user",
    `transport: ${transport}`,
    `request_id: ${message.id}`,
    `related_task: \"${relatedTask}\"`,
    `created_at: ${createdAt}`,
    "---",
    "",
    "# Request",
    `- chat_id: ${message.chatId}`,
    `- sender: ${message.sender || ""}`,
    `- sender_name: ${message.senderName || ""}`,
    `- handle: ${message.handle || ""}`,
    `- message_type: ${message.messageType || "unknown"}`,
    `- is_group: ${message.isGroup === undefined ? "" : String(message.isGroup)}`,
    `- rowid: ${message.rowid ?? ""}`,
    `- text_digest: ${textDigest}`,
    "",
    "## Text",
    "```text",
    text || "(empty)",
    "```",
    "",
    "## Attachments",
    ...renderAttachmentLines(message.attachments),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function parseInboxFilename(filePath: string): InboxRequestRecord | null {
  const match = INBOX_FILE_PATTERN.exec(path.basename(filePath));
  if (!match?.groups) {
    return null;
  }

  const state = match.groups.state.toLowerCase();
  if (state !== "new" && state !== "triaged") {
    return null;
  }

  return {
    requestNumber: match.groups.requestNumber.toLowerCase(),
    state,
    transport: match.groups.transport.toLowerCase(),
    slug: match.groups.slug.toLowerCase(),
    path: filePath,
  };
}

async function findInboxRequestByMessageId(inboxDir: string, messageId: string): Promise<InboxRequestRecord | null> {
  if (!existsSync(inboxDir)) {
    return null;
  }

  const files = await readdir(inboxDir);
  for (const file of files) {
    const record = parseInboxFilename(path.join(inboxDir, file));
    if (!record) {
      continue;
    }

    const content = await readFile(record.path, "utf8");
    if (content.includes(`request_id: ${messageId}`)) {
      return record;
    }
  }

  return null;
}

export async function createInboxRequest(workspacePath: string, message: InboundMessage): Promise<InboxRequestRecord> {
  const inboxDir = getInboxDir(workspacePath);
  const existing = await findInboxRequestByMessageId(inboxDir, message.id);
  if (existing) {
    return existing;
  }

  const requestNumber = await nextInboxRequestNumber(inboxDir);
  const transport = sanitizeSegment(message.transport || "unknown") || "unknown";
  const slug = buildInboxSlug(message);
  const filePath = path.join(inboxDir, `${requestNumber}.new.${transport}.${slug}.md`);
  const createdAt = toIsoTime(message.date);

  await atomicWriteFile(filePath, renderInboxRequest({ message, createdAt }));

  return {
    requestNumber,
    state: "new",
    transport,
    slug,
    path: filePath,
  };
}

export async function advanceInboxRequestState(
  request: InboxRequestRecord,
  nextState: InboxRequestState
): Promise<InboxRequestRecord> {
  if (request.state === nextState) {
    return request;
  }

  const nextPath = path.join(
    path.dirname(request.path),
    `${request.requestNumber}.${nextState}.${request.transport}.${request.slug}.md`
  );

  await rename(request.path, nextPath);

  return {
    ...request,
    state: nextState,
    path: nextPath,
  };
}

export const __test = process.env.NODE_ENV === "test"
  ? {
    buildInboxSlug,
    parseInboxFilename,
  }
  : undefined;

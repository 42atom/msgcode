import { randomUUID } from "node:crypto";
import { stableGroupNameForChatId } from "../channels/chat-id.js";
import type { InboundMessage } from "../channels/types.js";
import { getHandler } from "../handlers.js";
import type { Diagnostic } from "../memory/types.js";
import {
  isThreadSourceWritable,
  readWorkspaceThreadSummaries,
  type WorkspaceThreadSummary,
} from "./workspace-thread-surface.js";

export interface SendThreadInputRequest {
  workspacePath: string;
  threadId: string;
  text: string;
}

export async function resolveWritableThreadTarget(
  workspacePath: string,
  threadId: string,
): Promise<WorkspaceThreadSummary> {
  const normalizedWorkspacePath = workspacePath.trim();
  const normalizedThreadId = threadId.trim();
  if (!normalizedWorkspacePath) {
    throw new Error("sendThreadInput requires workspacePath");
  }
  if (!normalizedThreadId) {
    throw new Error("sendThreadInput requires threadId");
  }

  const warnings: Diagnostic[] = [];
  const threads = await readWorkspaceThreadSummaries(normalizedWorkspacePath, warnings);
  const thread = threads.find((entry) => entry.threadId === normalizedThreadId) ?? null;
  if (!thread) {
    throw new Error(`sendThreadInput cannot find thread: ${normalizedThreadId}`);
  }
  if (!isThreadSourceWritable(thread.source)) {
    throw new Error(`sendThreadInput rejects readonly thread source: ${thread.source}`);
  }

  return thread;
}

export async function sendThreadInput(request: SendThreadInputRequest): Promise<void> {
  const text = request.text.trim();
  if (!text) {
    throw new Error("sendThreadInput requires non-empty text");
  }

  const target = await resolveWritableThreadTarget(request.workspacePath, request.threadId);
  // 桌面当前只是复用现有 web thread 的写回主链，不另起新 transport。
  // isFromMe 必须保持 false，否则下游会把这条用户输入当自回路跳过。
  const originalMessage: InboundMessage = {
    id: `desktop-${randomUUID()}`,
    transport: "web",
    chatId: target.chatId,
    text,
    isFromMe: false,
    date: Date.now(),
    sender: "desktop-ui",
    senderName: "Desktop",
    handle: "desktop-ui",
    isGroup: false,
    messageType: "text",
  };

  const result = await getHandler("agent-backend").handle(text, {
    botType: "agent-backend",
    chatId: target.chatId,
    groupName: stableGroupNameForChatId(target.chatId),
    projectDir: request.workspacePath.trim(),
    originalMessage,
  });
  if (!result.success) {
    throw new Error(result.error || "sendThreadInput failed");
  }
}

import { randomUUID } from "node:crypto";
import { stableGroupNameForChatId } from "../channels/chat-id.js";
import type { InboundMessage } from "../channels/types.js";
import { getHandler, type HandleResult } from "../handlers.js";
import { logger } from "../logger/index.js";
import type { Diagnostic } from "../memory/types.js";
import { appendWindow } from "../session-window.js";
import {
  appendAssistantTurn,
  appendUserTurn,
  ensureThread,
  getThreadInfo,
  type RuntimeMeta,
} from "./thread-store.js";
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

export interface PersistedThreadInput {
  workspacePath: string;
  threadId: string;
  threadFilePath: string;
}

type ThreadInputDispatcher = (params: {
  text: string;
  target: WorkspaceThreadSummary;
  workspacePath: string;
  originalMessage: InboundMessage;
}) => Promise<HandleResult>;

const DEFAULT_RUNTIME_META: RuntimeMeta = {
  kind: "agent",
  provider: "agent-backend",
  tmuxClient: undefined,
};

let activeThreadInputDispatcher: ThreadInputDispatcher = async (params) => {
  return getHandler("agent-backend").handle(params.text, {
    botType: "agent-backend",
    chatId: params.target.chatId,
    groupName: stableGroupNameForChatId(params.target.chatId),
    projectDir: params.workspacePath,
    originalMessage: params.originalMessage,
    threadWriteMode: "assistant-only",
  });
};

export function setThreadInputDispatcherForTest(dispatcher: ThreadInputDispatcher | null): void {
  activeThreadInputDispatcher =
    dispatcher ??
    (async (params) =>
      getHandler("agent-backend").handle(params.text, {
        botType: "agent-backend",
        chatId: params.target.chatId,
        groupName: stableGroupNameForChatId(params.target.chatId),
        projectDir: params.workspacePath,
        originalMessage: params.originalMessage,
        threadWriteMode: "assistant-only",
      }));
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

function buildDesktopOriginalMessage(target: WorkspaceThreadSummary, text: string): InboundMessage {
  // 桌面当前只是复用现有 web thread 的写回主链，不另起新 transport。
  // isFromMe 必须保持 false，否则下游会把这条用户输入当自回路跳过。
  return {
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
}

async function ensureThreadReady(
  chatId: string,
  workspacePath: string,
  firstUserText: string,
): Promise<void> {
  if (getThreadInfo(chatId)) {
    return;
  }
  await ensureThread(chatId, workspacePath, firstUserText, DEFAULT_RUNTIME_META);
}

async function appendDesktopUserTurn(params: {
  workspacePath: string;
  chatId: string;
  text: string;
  originalMessage: InboundMessage;
}): Promise<void> {
  await ensureThreadReady(params.chatId, params.workspacePath, params.text);
  await appendWindow(params.workspacePath, params.chatId, {
    role: "user",
    content: params.text,
    messageId: params.originalMessage.id,
    senderId: params.originalMessage.sender || params.originalMessage.handle,
    senderName: params.originalMessage.senderName,
    messageType: params.originalMessage.messageType,
    isGroup: params.originalMessage.isGroup,
  });
  await appendUserTurn(params.chatId, params.text, new Date(params.originalMessage.date ?? Date.now()));
}

async function appendDesktopAssistantText(params: {
  workspacePath: string;
  chatId: string;
  text: string;
}): Promise<void> {
  if (!params.text.trim()) {
    return;
  }
  await ensureThreadReady(params.chatId, params.workspacePath, params.text);
  await appendWindow(params.workspacePath, params.chatId, {
    role: "assistant",
    content: params.text,
  });
  await appendAssistantTurn(params.chatId, params.text);
}

async function handleBackgroundTaskResult(params: {
  workspacePath: string;
  chatId: string;
  result: HandleResult;
}): Promise<void> {
  if (!params.result.backgroundTask) {
    return;
  }

  const { getTaskSupervisor, triggerTaskHeartbeatNow } = await import("../commands.js");
  const supervisor = getTaskSupervisor();
  if (!supervisor) {
    await appendDesktopAssistantText({
      workspacePath: params.workspacePath,
      chatId: params.chatId,
      text: "错误: 后台任务系统未启动，无法转后台任务",
    });
    return;
  }

  const created = await supervisor.createTask(
    params.chatId,
    params.workspacePath,
    params.result.backgroundTask.goal,
  );
  if (!created.ok) {
    await appendDesktopAssistantText({
      workspacePath: params.workspacePath,
      chatId: params.chatId,
      text: `错误: 转后台失败: ${created.error}`,
    });
    return;
  }

  const replyText = [
    (params.result.response || "").trim(),
    `任务号: ${created.task.taskRef ?? "未分配"}`,
  ]
    .filter(Boolean)
    .join("\n");
  await appendDesktopAssistantText({
    workspacePath: params.workspacePath,
    chatId: params.chatId,
    text: replyText,
  });
  triggerTaskHeartbeatNow();
}

async function runThreadInputInBackground(params: {
  workspacePath: string;
  text: string;
  target: WorkspaceThreadSummary;
  originalMessage: InboundMessage;
}): Promise<void> {
  try {
    const result = await activeThreadInputDispatcher(params);
    if (!result.success) {
      await appendDesktopAssistantText({
        workspacePath: params.workspacePath,
        chatId: params.target.chatId,
        text: `错误: ${result.error || "sendThreadInput failed"}`,
      });
      return;
    }

    if (result.backgroundTask) {
      await handleBackgroundTaskResult({
        workspacePath: params.workspacePath,
        chatId: params.target.chatId,
        result,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("desktop thread input background run failed", {
      module: "runtime/thread-input",
      chatId: params.target.chatId,
      workspacePath: params.workspacePath,
      threadId: params.target.threadId,
      error: errorMessage,
    });
    await appendDesktopAssistantText({
      workspacePath: params.workspacePath,
      chatId: params.target.chatId,
      text: `错误: ${errorMessage}`,
    });
  }
}

function normalizeSendThreadInputRequest(
  request: SendThreadInputRequest,
): { workspacePath: string; text: string } {
  const text = request.text.trim();
  if (!text) {
    throw new Error("sendThreadInput requires non-empty text");
  }

  const workspacePath = request.workspacePath.trim();
  return { workspacePath, text };
}

export async function runThreadInputProcess(request: SendThreadInputRequest): Promise<void> {
  const { workspacePath, text } = normalizeSendThreadInputRequest(request);
  const target = await resolveWritableThreadTarget(workspacePath, request.threadId);
  const originalMessage = buildDesktopOriginalMessage(target, text);

  await runThreadInputInBackground({
    workspacePath,
    text,
    target,
    originalMessage,
  });
}

export async function sendThreadInput(request: SendThreadInputRequest): Promise<PersistedThreadInput> {
  const { workspacePath, text } = normalizeSendThreadInputRequest(request);
  const target = await resolveWritableThreadTarget(workspacePath, request.threadId);
  const originalMessage = buildDesktopOriginalMessage(target, text);

  await appendDesktopUserTurn({
    workspacePath,
    chatId: target.chatId,
    text,
    originalMessage,
  });

  return {
    workspacePath,
    threadId: target.threadId,
    threadFilePath: target.filePath,
  };
}

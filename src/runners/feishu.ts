/**
 * msgcode: Feishu Runner
 *
 * 职责：
 * - 解析飞书配置（环境变量 / workspace config）
 * - 解析 chatId / messageId 默认上下文
 * - 调用具体 Feishu 工具实现
 */

import { loadWorkspaceConfig, type WorkspaceConfig } from "../config/workspace.js";
import { feishuSendFile, type FeishuSendFileResult } from "../tools/feishu-send.js";
import { feishuListMembers, type FeishuListMembersResult } from "../tools/feishu-list-members.js";
import { feishuListRecentMessages, type FeishuListRecentMessagesResult } from "../tools/feishu-list-recent-messages.js";
import { feishuReplyMessage, type FeishuReplyMessageResult } from "../tools/feishu-reply-message.js";
import { feishuReactMessage, type FeishuReactMessageResult } from "../tools/feishu-react-message.js";

export interface FeishuRunnerContext {
  workspacePath: string;
  chatId?: string;
  currentMessageId?: string;
  defaultActionTargetMessageId?: string;
}

interface ResolvedFeishuConfig {
  workspaceConfig: WorkspaceConfig;
  appId: string;
  appSecret: string;
}

async function resolveFeishuConfig(workspacePath: string): Promise<ResolvedFeishuConfig> {
  const workspaceConfig = await loadWorkspaceConfig(workspacePath);

  let appId = process.env.FEISHU_APP_ID?.trim();
  let appSecret = process.env.FEISHU_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    appId = (workspaceConfig["feishu.appId"] as string | undefined)?.trim();
    appSecret = (workspaceConfig["feishu.appSecret"] as string | undefined)?.trim();
  }

  if (!appId || !appSecret) {
    throw new Error("飞书配置未找到：请设置环境变量 FEISHU_APP_ID/FEISHU_APP_SECRET 或 workspace config 中的 feishu.appId/feishu.appSecret");
  }

  return {
    workspaceConfig,
    appId,
    appSecret,
  };
}

function resolveFeishuChatId(
  providedChatId: unknown,
  ctx: FeishuRunnerContext,
  workspaceConfig: WorkspaceConfig
): string {
  let chatId = typeof providedChatId === "string" ? providedChatId.trim() : "";

  if (!chatId && ctx.chatId) {
    chatId = ctx.chatId.replace(/^feishu:/, "");
  }

  if (!chatId) {
    chatId = (workspaceConfig["runtime.current_chat_id"] as string | undefined)?.trim() || "";
  }

  if (!chatId) {
    throw new Error("飞书 chatId 未找到：请传入 chatId，或先让当前请求把 runtime.current_chat_id 写入 .msgcode/config.json");
  }

  return chatId;
}

function resolveFeishuMessageId(
  providedMessageId: unknown,
  ctx: FeishuRunnerContext,
  missingMessageError: string
): string {
  const directMessageId = typeof providedMessageId === "string" ? providedMessageId.trim() : "";
  const messageId = directMessageId
    || ctx.defaultActionTargetMessageId?.trim()
    || ctx.currentMessageId?.trim()
    || "";

  if (!messageId) {
    throw new Error(missingMessageError);
  }

  return messageId;
}

export async function runFeishuSendFileTool(
  args: { filePath: string; chatId?: string; message?: string },
  ctx: FeishuRunnerContext
): Promise<FeishuSendFileResult> {
  const { workspaceConfig, appId, appSecret } = await resolveFeishuConfig(ctx.workspacePath);
  const chatId = resolveFeishuChatId(args.chatId, ctx, workspaceConfig);

  return feishuSendFile(
    {
      filePath: args.filePath,
      chatId,
      message: args.message?.trim() || undefined,
    },
    { appId, appSecret }
  );
}

export async function runFeishuListMembersTool(
  args: { chatId?: string; memberIdType?: string },
  ctx: FeishuRunnerContext
): Promise<FeishuListMembersResult> {
  const { workspaceConfig, appId, appSecret } = await resolveFeishuConfig(ctx.workspacePath);
  const chatId = resolveFeishuChatId(args.chatId, ctx, workspaceConfig);
  const memberIdTypeRaw = String(args.memberIdType ?? "open_id").trim();
  const memberIdType = memberIdTypeRaw === "user_id" || memberIdTypeRaw === "union_id"
    ? memberIdTypeRaw
    : "open_id";

  return feishuListMembers(
    { chatId, memberIdType },
    { appId, appSecret }
  );
}

export async function runFeishuListRecentMessagesTool(
  args: { chatId?: string; limit?: unknown },
  ctx: FeishuRunnerContext
): Promise<FeishuListRecentMessagesResult> {
  const { workspaceConfig, appId, appSecret } = await resolveFeishuConfig(ctx.workspacePath);
  const chatId = resolveFeishuChatId(args.chatId, ctx, workspaceConfig);
  const limitRaw = Number(args.limit ?? 40);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.trunc(limitRaw), 40)) : 40;

  return feishuListRecentMessages(
    { chatId, limit },
    { appId, appSecret }
  );
}

export async function runFeishuReplyMessageTool(
  args: { messageId?: string; text: string; replyInThread?: boolean },
  ctx: FeishuRunnerContext
): Promise<FeishuReplyMessageResult> {
  const { appId, appSecret } = await resolveFeishuConfig(ctx.workspacePath);
  const messageId = resolveFeishuMessageId(
    args.messageId,
    ctx,
    "飞书目标消息 ID 未找到：请显式传入 messageId，或仅对当前消息执行回复动作"
  );

  return feishuReplyMessage(
    {
      messageId,
      text: args.text.trim(),
      replyInThread: Boolean(args.replyInThread),
    },
    { appId, appSecret }
  );
}

export async function runFeishuReactMessageTool(
  args: { messageId?: string; emoji?: string },
  ctx: FeishuRunnerContext
): Promise<FeishuReactMessageResult> {
  const { appId, appSecret } = await resolveFeishuConfig(ctx.workspacePath);
  const messageId = resolveFeishuMessageId(
    args.messageId,
    ctx,
    "飞书目标消息 ID 未找到：请显式传入 messageId，或仅对当前消息执行表情回复动作"
  );

  return feishuReactMessage(
    {
      messageId,
      emoji: args.emoji?.trim() || undefined,
    },
    { appId, appSecret }
  );
}

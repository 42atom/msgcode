/**
 * msgcode: 消息监听器（2.0）
 *
 * 目标：
 * - iMessage I/O 统一走 imsg RPC
 * - 无 iMessage SDK / 无 AppleScript
 * - 只做转发、路由、会话控制（不做内容理解/ASR/TTS）
 */

import type { InboundMessage } from "./imsg/types.js";
import type { ImsgRpcClient } from "./imsg/rpc-client.js";
import { checkWhitelist, formatSender } from "./security.js";
import { routeByChatId } from "./router.js";
import { getHandler } from "./handlers.js";
import {
  handleRouteCommand,
  isRouteCommand,
  parseRouteCommand,
} from "./routes/commands.js";
import { logger } from "./logger/index.js";
import { updateLastSeen } from "./state/store.js";
import crypto from "node:crypto";

export interface ListenerConfig {
  imsgClient: ImsgRpcClient;
  debug?: boolean;
}

// ============================================
// 去重与提示节流（极简版）
// ============================================

const HANDLED_TTL_MS = 5 * 60 * 1000;
const handledMessageAt = new Map<string, number>();

const UNBOUND_HINT_COOLDOWN_MS = 60 * 1000;
const unboundHintAt = new Map<string, number>();

function pruneByTtl(map: Map<string, number>, now: number, ttlMs: number): void {
  for (const [key, ts] of map.entries()) {
    if (now - ts > ttlMs) {
      map.delete(key);
    }
  }
}

async function sendText(
  imsgClient: ImsgRpcClient,
  chatGuid: string,
  text: string
): Promise<void> {
  try {
    const digest = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
    logger.debug("发送回复", {
      module: "listener",
      chatId: chatGuid,
      textLength: text.length,
      textDigest: digest,
      ...(process.env.DEBUG_TRACE_TEXT === "1" ? { textPreview: text.slice(0, 80) } : {}),
    });
    const result = await imsgClient.send({ chat_guid: chatGuid, text });
    logger.debug("回复已发送", {
      module: "listener",
      chatId: chatGuid,
      ok: result.ok,
    });
  } catch (error) {
    logger.error("回复发送失败", {
      module: "listener",
      chatId: chatGuid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * E14: 更新游标（仅在消息成功处理后）
 *
 * 只在 rowid 存在时更新（避免回退）
 */
function updateCursor(message: InboundMessage): void {
  if (message.rowid && message.id) {
    try {
      updateLastSeen(message.chatId, message.rowid, message.id);
      logger.debug("游标已更新", {
        module: "listener",
        chatId: message.chatId,
        rowid: message.rowid,
        messageId: message.id,
      });
    } catch (error) {
      logger.warn("游标更新失败", {
        module: "listener",
        chatId: message.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ============================================
// 入口：处理单条消息
// ============================================

export async function handleMessage(
  message: InboundMessage,
  ctx: ListenerConfig
): Promise<void> {
  // E14: 尽量"看见即推进"，避免重启重复推送。
  // 但为了不丢消息：只有在本次消息完成处理/明确忽略后才推进（finally 执行）
  let shouldAdvanceCursor = false;

  try {
  // 自己发的消息不处理（避免回声循环）
  if (message.isFromMe) {
    shouldAdvanceCursor = true;
    return;
  }

  // 空消息直接忽略（附件转发由后续能力处理）
  const text = (message.text ?? "").trim();
  if (!text) {
    shouldAdvanceCursor = true;
    return;
  }

  // E14: 游标过滤（每 chat 独立游标策略）
  // 只处理 rowid > lastSeenRowid 的新消息，避免重复处理
  if (message.rowid) {
    const { loadState } = await import("./state/store.js");
    const state = loadState();
    const chatState = state.chats[message.chatId];

    if (chatState && message.rowid <= chatState.lastSeenRowid) {
      // 已处理过的消息，跳过
      shouldAdvanceCursor = true;
      return;
    }
  }

  // 去重（imsg watch 偶发重复推送时兜底）
  const now = Date.now();
  pruneByTtl(handledMessageAt, now, HANDLED_TTL_MS);
  if (message.id) {
    const last = handledMessageAt.get(message.id);
    if (last && now - last < HANDLED_TTL_MS) {
      return;
    }
    handledMessageAt.set(message.id, now);
  }

  // 白名单校验
  const check = checkWhitelist(message);
  if (!check.allowed) {
    logger.warn("消息被白名单拦截", {
      module: "listener",
      chatId: message.chatId,
      sender: check.sender,
      reason: check.reason,
    });
    shouldAdvanceCursor = true;
    return;
  }

  const textDigest = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
  logger.info("收到消息", {
    module: "listener",
    chatId: message.chatId,
    sender: formatSender(message),
    textLength: text.length,
    textDigest,
    isCommand: text.startsWith("/"),
  });

  // 路由控制面命令：/bind /where /unbind（必须在未绑定时也能用）
  if (isRouteCommand(text)) {
    const parsed = parseRouteCommand(text);
    if (!parsed) {
      shouldAdvanceCursor = true;
      return;
    }
    const result = await handleRouteCommand(parsed.command, {
      chatId: message.chatId,
      args: parsed.args,
    });
    await sendText(ctx.imsgClient, message.chatId, result.message);
    shouldAdvanceCursor = true;
    return;
  }

  // 业务路由：群 -> workspace
  const route = routeByChatId(message.chatId);

  // DEBUG: 路由追踪（需 DEBUG_TRACE=1 启用）
  if (process.env.DEBUG_TRACE === "1") {
    logger.debug("路由查找", {
      module: "listener",
      inputChatId: message.chatId,
      routeFound: !!route,
      routeBotType: route?.botType ?? null,
    });
  }

  if (!route) {
    // 只在用户发"命令类消息"时提示绑定（避免对普通聊天刷屏）
    if (text.startsWith("/")) {
      const last = unboundHintAt.get(message.chatId) ?? 0;
      if (now - last > UNBOUND_HINT_COOLDOWN_MS) {
        unboundHintAt.set(message.chatId, now);
        await sendText(
          ctx.imsgClient,
          message.chatId,
          "本群尚未绑定工作目录。\n先发送: /bind <dir>\n例如: /bind acme/ops"
        );
      }
    }
    shouldAdvanceCursor = true;
    return;
  }

  // 命令/转发交给对应 bot handler（默认 bot 直接走 tmux）
  const handler = getHandler(route.botType ?? "default");

  // DEBUG: Handler 调用追踪（需 DEBUG_TRACE=1 启用）
  if (process.env.DEBUG_TRACE === "1") {
    logger.debug("调用 Handler", {
      module: "listener",
      botType: route.botType,
      textLength: text.length,
      textDigest,
      ...(process.env.DEBUG_TRACE_TEXT === "1" ? { textPreview: text.slice(0, 30) } : {}),
    });
  }

  try {
    const result = await handler.handle(text, {
      botType: route.botType ?? "default",
      chatId: route.chatId,
      groupName: route.groupName,
      projectDir: route.projectDir,
      originalMessage: message,
    });

    // DEBUG: Handler 结果追踪（需 DEBUG_TRACE=1 启用）
    if (process.env.DEBUG_TRACE === "1") {
      logger.debug("Handler 结果", {
        module: "listener",
        success: result.success,
        responseLength: result.response?.length ?? 0,
        responseDigest: result.response
          ? crypto.createHash("sha256").update(result.response).digest("hex").slice(0, 12)
          : null,
        ...(process.env.DEBUG_TRACE_TEXT === "1"
          ? { textPreview: result.response?.slice(0, 50) ?? null }
          : {}),
        error: result.error ?? null,
      });
    }

    if (!result.success) {
      logger.error("handler 处理失败", {
        module: "listener",
        chatId: message.chatId,
        botType: route.botType ?? "default",
        error: result.error || "unknown",
      });
      await sendText(
        ctx.imsgClient,
        message.chatId,
        result.error ? `错误: ${result.error}` : "错误: 处理失败"
      );
      shouldAdvanceCursor = true;
      return;
    }

    if (result.response) {
      await sendText(ctx.imsgClient, message.chatId, result.response);
    }

    shouldAdvanceCursor = true;
    return;
  } catch (handlerError: unknown) {
    // DEBUG: Handler 异常追踪（需 DEBUG_TRACE=1 启用）
    if (process.env.DEBUG_TRACE === "1") {
      logger.debug("Handler 异常", {
        module: "listener",
        error: handlerError instanceof Error ? handlerError.message : String(handlerError),
        stack: handlerError instanceof Error ? handlerError.stack?.slice(0, 100) : null,
      });
    }

    await sendText(
      ctx.imsgClient,
      message.chatId,
      `Handler 异常: ${handlerError instanceof Error ? handlerError.message : String(handlerError)}`
    );
    shouldAdvanceCursor = true;
    return;
  }
  } finally {
    if (shouldAdvanceCursor) {
      updateCursor(message);
    }
  }
}

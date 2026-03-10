/**
 * msgcode: Feishu 消息回复工具
 *
 * 功能：按 messageId 回复指定飞书消息。
 */

import { Client, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { logger } from "../logger/index.js";

export interface FeishuReplyMessageArgs {
    messageId: string;
    text: string;
    replyInThread?: boolean;
}

export interface FeishuReplyMessageResult {
    ok: boolean;
    messageId?: string;
    repliedToMessageId: string;
    chatId?: string;
    replyInThread?: boolean;
    error?: string;
}

function getFeishuApiErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error);
    }

    const maybeResponse = (error as Error & {
        response?: {
            status?: number;
            data?: Record<string, unknown>;
        };
    }).response;

    if (!maybeResponse) {
        return error.message;
    }

    const parts: string[] = [];
    if (typeof maybeResponse.status === "number") {
        parts.push(`HTTP ${maybeResponse.status}`);
    }

    const data = maybeResponse.data;
    if (data) {
        const code = typeof data.code === "number" || typeof data.code === "string" ? String(data.code) : "";
        const msg = typeof data.msg === "string" ? data.msg : "";
        if (code) parts.push(`code=${code}`);
        if (msg) parts.push(msg);
    }

    return parts.length > 0 ? parts.join(" ") : error.message;
}

export async function feishuReplyMessage(
    args: FeishuReplyMessageArgs,
    config: {
        appId: string;
        appSecret: string;
    }
): Promise<FeishuReplyMessageResult> {
    const messageId = args.messageId.trim();
    const text = args.text.trim();
    const replyInThread = Boolean(args.replyInThread);

    logger.info("Feishu 消息回复开始", {
        module: "tools",
        messageId,
        replyInThread,
        appId: config.appId,
        hasAppSecret: Boolean(config.appSecret),
    });

    try {
        const client = new Client({
            appId: config.appId,
            appSecret: config.appSecret,
            loggerLevel: LoggerLevel.error,
        } as any);

        const response: any = await client.im.v1.message.reply({
            path: {
                message_id: messageId,
            },
            data: {
                content: JSON.stringify({ text }),
                msg_type: "text",
                reply_in_thread: replyInThread,
            },
        });

        if (response?.code && response.code !== 0) {
            const rawMsg = [response.code, response.msg].filter(Boolean).join(" ");
            return {
                ok: false,
                repliedToMessageId: messageId,
                error: `飞书消息回复失败：${rawMsg || "unknown error"}。请确认机器人能力已开启，目标消息仍存在且机器人仍在对应会话中。`,
            };
        }

        logger.info("Feishu 消息回复成功", {
            module: "tools",
            messageId,
            replyMessageId: response?.data?.message_id,
            chatId: response?.data?.chat_id,
            replyInThread,
        });

        return {
            ok: true,
            messageId: typeof response?.data?.message_id === "string" ? response.data.message_id : undefined,
            repliedToMessageId: messageId,
            chatId: typeof response?.data?.chat_id === "string" ? response.data.chat_id : undefined,
            replyInThread,
        };
    } catch (error) {
        const errorMessage = getFeishuApiErrorMessage(error);
        logger.error("Feishu 消息回复失败", {
            module: "tools",
            messageId,
            replyInThread,
            error: errorMessage,
        });
        return {
            ok: false,
            repliedToMessageId: messageId,
            error: `${errorMessage}。请确认机器人能力已开启，目标消息仍存在且机器人仍在对应会话中。`,
        };
    }
}

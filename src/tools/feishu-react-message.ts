/**
 * msgcode: Feishu 消息表情回复工具
 *
 * 功能：按 messageId 对飞书消息添加表情回复。
 */

import { Client, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { logger } from "../logger/index.js";

export interface FeishuReactMessageArgs {
    messageId: string;
    emoji?: string;
}

export interface FeishuReactMessageResult {
    ok: boolean;
    messageId: string;
    reactionId?: string;
    emojiType?: string;
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

function normalizeEmojiType(input: string | undefined): string {
    const normalized = (input ?? "").trim().toLowerCase();
    switch (normalized) {
        case "":
        case "+1":
        case "like":
        case "thumbsup":
        case "thumbs_up":
        case "点赞":
            return "THUMBSUP";
        case "heart":
        case "爱心":
        case "喜欢":
            return "HEART";
        case "laugh":
        case "haha":
        case "笑":
            return "JOY";
        case "eyes":
        case "看":
            return "EYES";
        case "ok":
        case "完成":
            return "OK";
        default:
            return (input ?? "THUMBSUP").trim() || "THUMBSUP";
    }
}

export async function feishuReactMessage(
    args: FeishuReactMessageArgs,
    config: {
        appId: string;
        appSecret: string;
    }
): Promise<FeishuReactMessageResult> {
    const messageId = args.messageId.trim();
    const emojiType = normalizeEmojiType(args.emoji);

    logger.info("Feishu 消息表情回复开始", {
        module: "tools",
        messageId,
        emojiType,
        appId: config.appId,
        hasAppSecret: Boolean(config.appSecret),
    });

    try {
        const client = new Client({
            appId: config.appId,
            appSecret: config.appSecret,
            loggerLevel: LoggerLevel.error,
        } as any);

        const response: any = await client.im.v1.messageReaction.create({
            path: {
                message_id: messageId,
            },
            data: {
                reaction_type: {
                    emoji_type: emojiType,
                },
            },
        });

        if (response?.code && response.code !== 0) {
            const rawMsg = [response.code, response.msg].filter(Boolean).join(" ");
            return {
                ok: false,
                messageId,
                error: `飞书消息表情回复失败：${rawMsg || "unknown error"}。请确认机器人能力已开启，目标消息仍存在且机器人仍在对应会话中。`,
            };
        }

        logger.info("Feishu 消息表情回复成功", {
            module: "tools",
            messageId,
            emojiType,
            reactionId: response?.data?.reaction_id,
        });

        return {
            ok: true,
            messageId,
            reactionId: typeof response?.data?.reaction_id === "string" ? response.data.reaction_id : undefined,
            emojiType,
        };
    } catch (error) {
        const errorMessage = getFeishuApiErrorMessage(error);
        logger.error("Feishu 消息表情回复失败", {
            module: "tools",
            messageId,
            emojiType,
            error: errorMessage,
        });
        return {
            ok: false,
            messageId,
            error: `${errorMessage}。请确认机器人能力已开启，目标消息仍存在且机器人仍在对应会话中。`,
        };
    }
}

/**
 * msgcode: Feishu 最近消息列表工具
 *
 * 功能：拉取当前飞书会话最近若干条消息的最小结构表
 * 目标：给 LLM 提供 messageId 级别的只读查询能力，不做消息平台。
 */

import { Client, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { logger } from "../logger/index.js";

export interface FeishuListRecentMessagesArgs {
    chatId: string;
    limit?: number;
}

export interface FeishuRecentMessageItem {
    messageId: string;
    senderId: string;
    messageType: string;
    sentAt?: string;
    replyToMessageId?: string;
    textSnippet: string;
}

export interface FeishuListRecentMessagesResult {
    ok: boolean;
    chatId: string;
    count?: number;
    messages?: FeishuRecentMessageItem[];
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

function parseFeishuBodySnippet(content: unknown, msgType: string): string {
    let raw = "";
    if (typeof content === "string") {
        raw = content.trim();
    } else if (content !== null && content !== undefined) {
        raw = String(content).trim();
    }

    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
            if (text) {
                return text.length > 120 ? `${text.slice(0, 120)}...` : text;
            }
            const compact = JSON.stringify(parsed);
            return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
        } catch {
            return raw.length > 120 ? `${raw.slice(0, 120)}...` : raw;
        }
    }

    return `[${msgType}]`;
}

export async function feishuListRecentMessages(
    args: FeishuListRecentMessagesArgs,
    config: {
        appId: string;
        appSecret: string;
    }
): Promise<FeishuListRecentMessagesResult> {
    const chatId = args.chatId.trim();
    const limit = Math.max(1, Math.min(args.limit ?? 40, 40));

    logger.info("Feishu 最近消息查询开始", {
        module: "tools",
        chatId,
        limit,
        appId: config.appId,
        hasAppSecret: Boolean(config.appSecret),
    });

    try {
        const client = new Client({
            appId: config.appId,
            appSecret: config.appSecret,
            loggerLevel: LoggerLevel.error,
        } as any);

        const response: any = await client.im.v1.message.list({
            params: {
                container_id_type: "chat",
                container_id: chatId,
                sort_type: "ByCreateTimeDesc",
                page_size: limit,
            },
        });

        if (response?.code && response.code !== 0) {
            const rawMsg = [response.code, response.msg].filter(Boolean).join(" ");
            return {
                ok: false,
                chatId,
                error: `飞书最近消息接口失败：${rawMsg || "unknown error"}。如果是群聊，请确认飞书后台已开启“获取群组中所有消息”权限，且机器人仍在群里。`,
            };
        }

        const items = Array.isArray(response?.data?.items) ? response.data.items : [];
        const messages = items
            .map((it: any) => ({
                messageId: String(it?.message_id || "").trim(),
                senderId: String(it?.sender?.id || "").trim(),
                messageType: String(it?.msg_type || "unknown").trim() || "unknown",
                sentAt: typeof it?.create_time === "string" && it.create_time ? it.create_time : undefined,
                replyToMessageId: typeof it?.parent_id === "string" && it.parent_id ? it.parent_id : undefined,
                textSnippet: parseFeishuBodySnippet(it?.body?.content, String(it?.msg_type || "unknown").trim() || "unknown"),
            }))
            .filter((it: FeishuRecentMessageItem) => it.messageId && it.senderId);

        logger.info("Feishu 最近消息查询成功", {
            module: "tools",
            chatId,
            count: messages.length,
        });

        return {
            ok: true,
            chatId,
            count: messages.length,
            messages,
        };
    } catch (error) {
        const errorMessage = getFeishuApiErrorMessage(error);
        logger.error("Feishu 最近消息查询失败", {
            module: "tools",
            chatId,
            limit,
            error: errorMessage,
        });
        return {
            ok: false,
            chatId,
            error: `${errorMessage}。如果是群聊，请确认飞书后台已开启“获取群组中所有消息”权限，且机器人仍在群里。`,
        };
    }
}

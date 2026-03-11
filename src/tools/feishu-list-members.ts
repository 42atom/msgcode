/**
 * msgcode: Feishu 群成员列表工具
 *
 * 功能：拉取飞书群成员的 open_id/user_id/union_id 与名字
 * 目标：给 LLM 和 character-identity skill 提供最小可用 roster，不做平台层。
 */

import { Client, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { logger } from "../logger/index.js";

export interface FeishuListMembersArgs {
    chatId: string;
    memberIdType?: "open_id" | "user_id" | "union_id";
    pageSize?: number;
}

export interface FeishuListMembersResult {
    ok: boolean;
    chatId: string;
    memberIdType: "open_id" | "user_id" | "union_id";
    memberTotal?: number;
    members?: Array<{ senderId: string; name: string }>;
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

export async function feishuListMembers(
    args: FeishuListMembersArgs,
    config: {
        appId: string;
        appSecret: string;
    }
): Promise<FeishuListMembersResult> {
    const chatId = args.chatId.trim();
    const memberIdType = args.memberIdType ?? "open_id";
    const pageSize = Math.max(1, Math.min(args.pageSize ?? 100, 200));

    logger.info("Feishu 群成员列表查询开始", {
        module: "tools",
        chatId,
        memberIdType,
        pageSize,
        appId: config.appId,
        hasAppSecret: Boolean(config.appSecret),
    });

    try {
        const client = new Client({
            appId: config.appId,
            appSecret: config.appSecret,
            loggerLevel: LoggerLevel.error,
        } as any);

        const response: any = await client.im.v1.chatMembers.get({
            path: { chat_id: chatId },
            params: {
                member_id_type: memberIdType,
                page_size: pageSize,
            },
        });

        if (response?.code && response.code !== 0) {
            const rawMsg = [response.code, response.msg].filter(Boolean).join(" ");
            return {
                ok: false,
                chatId,
                memberIdType,
                error: `飞书群成员接口失败：${rawMsg || "unknown error"}。可能是机器人不在群里，或飞书后台未开启群成员读取权限。`,
            };
        }

        const items = Array.isArray(response?.data?.items) ? response.data.items : [];
        const members = items
            .map((it: any) => ({
                senderId: String(it?.member_id || "").trim(),
                name: String(it?.name || "").trim(),
            }))
            .filter((it: { senderId: string; name: string }) => it.senderId);

        logger.info("Feishu 群成员列表查询成功", {
            module: "tools",
            chatId,
            memberIdType,
            memberTotal: response?.data?.member_total ?? members.length,
            returned: members.length,
        });

        return {
            ok: true,
            chatId,
            memberIdType,
            memberTotal: Number(response?.data?.member_total ?? members.length),
            members,
        };
    } catch (error) {
        const errorMessage = getFeishuApiErrorMessage(error);
        logger.error("Feishu 群成员列表查询失败", {
            module: "tools",
            chatId,
            memberIdType,
            error: errorMessage,
        });
        return {
            ok: false,
            chatId,
            memberIdType,
            error: `${errorMessage}。可能是机器人不在群里，或飞书后台未开启群成员读取权限。`,
        };
    }
}

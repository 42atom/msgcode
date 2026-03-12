/**
 * msgcode: Feishu Send File 工具
 *
 * 功能：发送文件到飞书群聊
 * 流程：
 * 1. 上传文件到飞书服务器，获取 file_key
 * 2. 发送文件消息到指定群聊
 */

import { logger } from "../logger/index.js";
import type { ChannelSendResult, OutboundMessage } from "../channels/types.js";

export interface FeishuSendFileArgs {
    filePath: string;
    chatId: string;
    message?: string;
}

export interface FeishuSendFileResult {
    ok: boolean;
    error?: string;
    attachmentType?: "file" | "image";
    attachmentKey?: string;
    chatId: string;
}

/**
 * 发送文件到飞书群聊
 *
 * @param args.filePath 本地文件路径
 * @param args.chatId 飞书群聊 ID
 * @param args.message 可选的附加文本消息
 * @param config.appId 飞书应用 ID
 * @param config.appSecret 飞书应用密钥
 */
export async function feishuSendFile(
    args: FeishuSendFileArgs,
    config: {
        appId: string;
        appSecret: string;
        createTransport?: (params: {
            appId: string;
            appSecret: string;
            onInbound: () => void;
        }) => {
            send: (params: OutboundMessage) => Promise<ChannelSendResult>;
        };
    }
): Promise<FeishuSendFileResult> {
    logger.info("Feishu 文件发送开始", {
        module: "tools",
        filePath: args.filePath,
        chatId: args.chatId,
        appId: config.appId, // 不打印 secret
        hasAppSecret: !!config.appSecret,
    });

    try {
        // 1. 动态导入飞书 SDK 和 transport
        const { createFeishuTransport } = await import("../feishu/transport.js");

        // 2. 创建临时 transport 实例（仅用于发送）
        const transportFactory = config.createTransport ?? createFeishuTransport;
        const transport = transportFactory({
            appId: config.appId,
            appSecret: config.appSecret,
            onInbound: () => {
                // 不接收消息
            },
        });

        // 3. 使用 transport 的 send 方法发送文件
        const result = await transport.send({
            chatId: `feishu:${args.chatId}`,
            text: args.message || "",
            file: args.filePath,
        });

        if (result.ok && result.attachmentType && result.attachmentKey) {
            logger.info("Feishu 文件发送成功", {
                module: "tools",
                filePath: args.filePath,
                chatId: args.chatId,
                attachmentType: result.attachmentType,
            });
            return {
                ok: true,
                chatId: args.chatId,
                attachmentType: result.attachmentType,
                attachmentKey: result.attachmentKey,
            };
        }

        return { ok: false, error: result.error || "文件未发送成功", chatId: args.chatId };
    } catch (error) {
        const errorStr = error instanceof Error ? error.message : String(error);
        logger.error("Feishu 文件发送失败", {
            module: "tools",
            filePath: args.filePath,
            chatId: args.chatId,
            error: errorStr,
            // 如果是 API 错误，打印响应
            isApiError: errorStr.includes("Request failed"),
        });
        return { ok: false, error: errorStr, chatId: args.chatId };
    }
}

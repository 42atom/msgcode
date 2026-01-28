/**
 * msgcode: 安全模块
 *
 * 白名单验证、权限检查
 */

import type { Message } from "@photon-ai/imessage-kit";
import { isWhitelisted } from "./config.js";

/**
 * 安全检查结果
 */
export interface SecurityCheck {
    allowed: boolean;
    reason?: string;
    sender?: string;
}

/**
 * 检查消息发送者是否在白名单中
 */
export function checkWhitelist(message: Message): SecurityCheck {
    // 自己发的消息，总是允许
    if (message.isFromMe) {
        return { allowed: true, sender: "me" };
    }

    // 直接使用 message.sender 作为发送者标识
    // sender 是邮箱或电话号码
    const sender = message.sender || "unknown";

    if (isWhitelisted(sender)) {
        return { allowed: true, sender };
    }

    return {
        allowed: false,
        reason: `发送者不在白名单中: ${sender}`,
        sender,
    };
}

/**
 * 格式化发送者显示名称
 */
export function formatSender(message: Message): string {
    if (message.isFromMe) return "你";

    return (
        message.sender ||
        message.handle ||
        message.address ||
        (message.chatId?.includes(";-;") ? message.chatId.split(";-;")[1] : undefined) ||
        message.chatId ||
        "unknown"
    );
}

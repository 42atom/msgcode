/**
 * msgcode: 安全模块
 *
 * 白名单验证、权限检查
 */

import type { InboundMessage } from "./imsg/types.js";
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
export function checkWhitelist(message: InboundMessage): SecurityCheck {
    // 自己发的消息，总是允许
    if (message.isFromMe) {
        return { allowed: true, sender: "me" };
    }

    // 使用 message.sender 或 message.handle 作为发送者标识（电话/邮箱）
    const sender = message.sender || message.handle || "unknown";

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
export function formatSender(message: InboundMessage): string {
    if (message.isFromMe) return "你";

    return (
        message.senderName ||
        message.sender ||
        message.handle ||
        message.chatId ||
        "unknown"
    );
}

/**
 * msgcode: 安全模块
 *
 * 白名单验证、权限检查
 */

import type { InboundMessage } from "./imsg/types.js";
import { config, isWhitelisted } from "./config.js";
import { isGroupChatId } from "./imsg/adapter.js";

/**
 * 安全检查结果
 */
export interface SecurityCheck {
    allowed: boolean;
    reason?: string;
    sender?: string;
}

function isOwnerIdentifier(identifier: string): boolean {
    const owners = config.ownerIdentifiers;
    if (owners.length === 0) return false;

    // 1) 邮箱：大小写不敏感精确匹配
    const idLower = identifier.toLowerCase();
    for (const owner of owners) {
        if (idLower === owner.toLowerCase()) return true;
    }

    // 2) 电话：仅数字包含匹配（兼容 +86、空格、短号等）
    const normalizedIdentifier = identifier.replace(/\D/g, "");
    if (!normalizedIdentifier) return false;

    for (const owner of owners) {
        const normalizedOwner = owner.replace(/\D/g, "");
        if (!normalizedOwner) continue;
        if (
            normalizedIdentifier.includes(normalizedOwner) ||
            normalizedOwner.includes(normalizedIdentifier)
        ) {
            return true;
        }
    }

    return false;
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

    // 群聊收口：仅允许 owner 触发（不降低 sandbox 权限，只收口信任边界）
    const isGroup = message.isGroup ?? isGroupChatId(message.chatId);
    if (config.ownerOnlyInGroup && isGroup) {
        if (!isOwnerIdentifier(sender)) {
            return {
                allowed: false,
                reason: `群聊仅允许 owner 触发: ${sender}`,
                sender,
            };
        }
    }

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

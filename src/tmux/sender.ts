/**
 * matcode-mac: 消息发送器
 *
 * 将用户消息发送到 Claude Code (tmux)
 */

import { TmuxSession } from "./session.js";
import type { Message } from "@photon-ai/imessage-kit";

/**
 * 消息发送结果
 */
export interface SendResult {
    success: boolean;
    error?: string;
}

/**
 * 发送消息到 Claude
 */
export async function sendMessage(
    groupName: string,
    message: string,
    attachments?: Message["attachments"]
): Promise<SendResult> {
    const sessionName = TmuxSession.getSessionName(groupName);

    // 检查会话是否存在
    const exists = await TmuxSession.exists(groupName);
    if (!exists) {
        return { success: false, error: `tmux 会话未运行，请先发送 /start` };
    }

    try {
        // 处理附件
        if (attachments && attachments.length > 0) {
            for (const attachment of attachments) {
                const filePath = attachment.path;
                if (filePath) {
                    await TmuxSession.sendCommand(sessionName, `请分析这个文件: ${filePath}`);
                    // Claude 需要额外一次 Enter 确认
                    await TmuxSession.sendCommand(sessionName, "");
                    // 等待处理完成
                    await sleep(500);
                }
            }
        }

        // 发送普通消息（如果有）
        if (message.trim()) {
            // 转义特殊字符
            const escapedMessage = escapeMessage(message);
            await TmuxSession.sendCommand(sessionName, escapedMessage);
            // Claude 需要额外一次 Enter 确认
            await TmuxSession.sendCommand(sessionName, "");
        }

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * 发送快照命令
 */
export async function sendSnapshot(groupName: string): Promise<string> {
    const sessionName = TmuxSession.getSessionName(groupName);
    const exists = await TmuxSession.exists(groupName);

    if (!exists) {
        return "⚠️  tmux 会话未运行";
    }

    const output = await TmuxSession.capturePane(sessionName, 200);
    return output || "终端无输出";
}

/**
 * 发送 ESC 中断
 */
export async function sendEscape(groupName: string): Promise<string> {
    const sessionName = TmuxSession.getSessionName(groupName);
    const exists = await TmuxSession.exists(groupName);

    if (!exists) {
        return "⚠️  tmux 会话未运行";
    }

    await TmuxSession.sendEscape(sessionName);
    return "✅ 已发送 ESC 中断";
}

/**
 * 发送 /clear 清空上下文
 */
export async function sendClear(groupName: string): Promise<string> {
    const sessionName = TmuxSession.getSessionName(groupName);
    const exists = await TmuxSession.exists(groupName);

    if (!exists) {
        return "⚠️  tmux 会话未运行";
    }

    await TmuxSession.sendCommand(sessionName, "/clear");
    await TmuxSession.sendCommand(sessionName, ""); // 额外 Enter
    return "✅ 已发送 /clear 清空上下文";
}

/**
 * 转义消息中的特殊字符
 */
function escapeMessage(message: string): string {
    // tmux send-keys 需要转义的字符
    return message
        .replace(/\\/g, "\\\\")    // 反斜杠
        .replace(/"/g, '\\"')      // 双引号
        .replace(/\$/g, "\\$")     // 美元符号
        .replace(/;/g, "\\;")      // 分号
        .replace(/\(/g, "\\(")     // 左括号
        .replace(/\)/g, "\\)");    // 右括号
}

/**
 * 延时函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

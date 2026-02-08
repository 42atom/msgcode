/**
 * msgcode: 消息发送器
 *
 * 将用户消息发送到 Claude Code (tmux)
 */

import { TmuxSession, type RunnerType } from "./session.js";
import type { Attachment } from "../imsg/types.js";
import { withRemoteHintIfNeeded } from "./remote_hint.js";

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
    attachments?: readonly Attachment[]
): Promise<SendResult> {
    const sessionName = TmuxSession.getSessionName(groupName);

    // 检查会话是否存在
    const exists = await TmuxSession.exists(groupName);
    if (!exists) {
        return { success: false, error: `tmux 会话未运行，请先发送 /start` };
    }

    try {
        // 处理附件
        await sendAttachmentsToSession(sessionName, attachments);

        // 发送普通消息（如果有）
        if (message.trim()) {
            const payload = withRemoteHintIfNeeded(sessionName, message);
            // P0: 使用 sendTextLiteral + sendEnter，直接发送原文（-l 字面量模式无需转义）
            await TmuxSession.sendTextLiteral(sessionName, payload);
            await new Promise(resolve => setTimeout(resolve, 50)); // 延迟防止UI吞键
            await TmuxSession.sendEnter(sessionName);
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
        return "tmux 会话未运行";
    }

    const output = await TmuxSession.capturePane(sessionName, 200);
    if (!output.trim()) {
        return "终端无输出";
    }
    return summarizeSnapshot(output);
}

/**
 * 发送 ESC 中断
 */
export async function sendEscape(groupName: string): Promise<string> {
    const sessionName = TmuxSession.getSessionName(groupName);
    const exists = await TmuxSession.exists(groupName);

    if (!exists) {
        return "tmux 会话未运行";
    }

    await TmuxSession.sendEscape(sessionName);
    return "已发送 ESC 中断";
}

/**
 * 发送 /clear 清空上下文（E16-S7: kill+start 语义）
 *
 * 杀掉现有会话并重新启动，彻底清空上下文
 *
 * @param groupName 群组名称
 * @param projectDir 项目目录
 * @param runner 执行臂类型（必须为 "tmux"）
 * @param runnerOld 具体执行臂（codex/claude-code）
 */
export async function sendClear(
    groupName: string,
    projectDir: string | undefined,
    runner: RunnerType,
    runnerOld?: "codex" | "claude-code"
): Promise<string> {
    if (runner !== "tmux") {
        throw new Error(`sendClear 仅支持 tmux 执行臂，当前: ${runner}`);
    }

    const exists = await TmuxSession.exists(groupName);

    // E16-S7: 无论会话是否存在，都执行 kill+start
    // 先 kill（如果存在）
    if (exists) {
        try {
            await TmuxSession.stop(groupName);
        } catch {
            // ignore stop failure
        }
    }

    // 再 start（传入具体执行臂）
    const startResult = await TmuxSession.start(groupName, projectDir, runner, runnerOld);
    return `已清空上下文（kill+start）\n${startResult}`;
}

/**
 * 延时函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendAttachmentsToSession(
    sessionName: string,
    attachments?: readonly Attachment[]
): Promise<void> {
    if (!attachments || attachments.length === 0) {
        return;
    }

    for (const attachment of attachments) {
        const filePath = attachment.path;
        if (!filePath) {
            continue;
        }
        // P0: 使用 sendTextLiteral + sendEnter 避免Enter被吞
        const payload = withRemoteHintIfNeeded(sessionName, `请分析这个文件: ${filePath}`);
        await TmuxSession.sendTextLiteral(sessionName, payload);
        await new Promise(resolve => setTimeout(resolve, 50)); // 延迟防止UI吞键
        await TmuxSession.sendEnter(sessionName);
        await sleep(500);
    }
}

function summarizeSnapshot(output: string): string {
    const lines = output.split("\n").map(line => line.trimEnd());
    if (lines.length === 0) {
        return "终端无输出";
    }

    const head = lines.slice(0, 3);
    const tail = lines.length > 3 ? lines.slice(-3) : [];
    const summary: string[] = [];
    summary.push(`snapshot 概览（共 ${lines.length} 行，展示前/后各 3 行）：`);
    summary.push(...head.filter(Boolean));
    if (tail.length > 0 && lines.length > head.length) {
        summary.push("...");
        summary.push(...tail.filter(Boolean));
    }
    if (lines.length > head.length + tail.length) {
        summary.push("...（已截断，使用 tmux capture-pane 手动查看完整内容）");
    }
    return summary.join("\n");
}

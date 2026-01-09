/**
 * msgcode: 流式响应处理器
 *
 * 实现"节奏控制的段落式流式输出"
 * - 缓冲区管理：累积内容，在语义触发点发送
 * - 节流控制：确保最小发送间隔
 * - 工具通知：tool_use 立即通知用户
 */

import { TmuxSession } from "./session.js";
import { OutputReader } from "../output/reader.js";
import { AssistantParser, type ToolUseInfo } from "../output/parser.js";
import { BufferManager } from "../output/buffer.js";
import { Throttler } from "../output/throttler.js";
import { logger } from "../logger/index.js";

// 轮询配置（与 responder.ts 保持一致）
const FAST_INTERVAL = 300;      // 首次交付前
const SLOW_INTERVAL = 1000;     // 首次交付后（缩短以更快捕获内容）
const MAX_WAIT_MS = 300000;     // 最大等待 5 分钟（复杂问题需要更久）

/**
 * 延时函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 转义消息中的特殊字符（从 responder.ts 复用）
 */
function escapeMessage(message: string): string {
    return message
        .replace(/\\/g, '\\\\')   // 反斜杠
        .replace(/"/g, '\\"')      // 双引号
        .replace(/\$/g, '\\$')     // 美元符号
        .replace(/;/g, '\\;')      // 分号
        .replace(/\(/g, '\\(')     // 左括号
        .replace(/\)/g, '\\)');    // 右括号
}

/**
 * 流式输出选项
 */
export interface StreamOptions {
    projectDir?: string;
    timeout?: number;         // 默认 30s
    fastInterval?: number;    // 默认 300ms
    slowInterval?: number;    // 默认 3000ms
    minInterval?: number;     // 发送最小间隔，默认 1500ms
    onChunk: (chunk: string, isToolUse: boolean) => Promise<void>;
}

/**
 * 流式输出结果
 */
export interface StreamResult {
    success: boolean;
    error?: string;
}

/**
 * 流式发送消息到 Claude 并逐块返回响应
 *
 * 流程：
 * 1. 发送消息到 tmux
 * 2. 轮询检查新内容
 * 3. 累积到缓冲区，检查触发条件
 * 4. 触发时通过 onChunk 回调发送
 * 5. 检测到 tool_use 时立即发送通知
 * 6. 完成时发送剩余内容
 */
export async function handleTmuxStream(
    groupName: string,
    message: string,
    options: StreamOptions
): Promise<StreamResult> {
    const sessionName = TmuxSession.getSessionName(groupName);

    // 检查会话是否存在
    const exists = await TmuxSession.exists(groupName);
    if (!exists) {
        return { success: false, error: `tmux 会话未运行，请先发送 /start` };
    }

    // 创建独立的 reader、buffer、throttler（并发安全）
    const reader = new OutputReader();
    const buffer = new BufferManager();
    const throttler = new Throttler(options.minInterval ?? 800);  // 默认 800ms 节流

    // 发送前记录当前状态
    const beforeResult = await reader.readProject(options.projectDir);
    let currentText = "";  // 累积的完整文本

    console.log(`[Streamer ${groupName}] 发送前 offset: ${beforeResult.newOffset}`);
    logger.debug(`[Streamer ${groupName}] 发送前 offset: ${beforeResult.newOffset}`, { module: "streamer", groupName, offset: beforeResult.newOffset });

    // 发送消息
    try {
        const escapedMessage = escapeMessage(message);
        await TmuxSession.sendCommand(sessionName, escapedMessage);
        await TmuxSession.sendCommand(sessionName, ""); // 额外 Enter 确认
    } catch (error: any) {
        return { success: false, error: `发送失败: ${error.message}` };
    }

    // 轮询参数
    const timeout = options.timeout ?? MAX_WAIT_MS;
    const fastInterval = options.fastInterval ?? FAST_INTERVAL;
    const slowInterval = options.slowInterval ?? SLOW_INTERVAL;

    let pollInterval = fastInterval;
    let hasResponse = false;
    const startTime = Date.now();

    try {
        while (Date.now() - startTime < timeout) {
            await sleep(pollInterval);

            // 读取新增内容
            const result = await reader.readProject(options.projectDir);
            if (result.entries.length === 0) {
                continue;
            }

            // 解析新增内容
            const parseResult = AssistantParser.parse(result.entries);
            const newText = parseResult.text;

            // 工具调用检测已禁用（用户反馈工具通知无可读性）
            // const toolUses = AssistantParser.detectToolUses(result.entries);
            // for (const tool of toolUses) {
            //     const toolKey = `${groupName}-${toolIndex++}-${tool.name}`;
            //     if (!processedTools.has(toolKey)) {
            //         processedTools.add(toolKey);
            //         console.log(`[Streamer ${groupName}] 检测到工具: ${tool.name}`);
            //         await throttler.wait();
            //         await options.onChunk(`⚡️ 执行: ${tool.name}`, true);
            //         throttler.recordSend();
            //     }
            // }

            if (newText.length > 0) {
                // 计算增量文本
                const deltaText = newText.slice(currentText.length);
                currentText = newText;

                // 累积到缓冲区
                buffer.append(deltaText);

                console.log(`[Streamer ${groupName}] 新增 ${deltaText.length} 字符, 缓冲区: ${buffer.length}, 完成: ${parseResult.isComplete}`);
                logger.debug(`[Streamer ${groupName}] 新增 ${deltaText.length} 字符, 缓冲区: ${buffer.length}, 完成: ${parseResult.isComplete}`, { module: "streamer", groupName, deltaChars: deltaText.length, bufferLength: buffer.length, isComplete: parseResult.isComplete });

                // 首次检测到内容后，切换到慢速轮询
                if (!hasResponse) {
                    hasResponse = true;
                    pollInterval = slowInterval;
                }

                // 检查触发条件
                if (buffer.shouldFlush()) {
                    const chunk = buffer.flush();
                    if (chunk.trim()) {
                        console.log(`[Streamer ${groupName}] 发送块: ${chunk.length} 字符`);
                        logger.debug(`[Streamer ${groupName}] 发送块: ${chunk.length} 字符`, { module: "streamer", groupName, chunkLength: chunk.length });
                        await throttler.wait();
                        await options.onChunk(chunk, false);
                        throttler.recordSend();
                    }
                }

                // 检查完成
                if (parseResult.isComplete) {
                    console.log(`[Streamer ${groupName}] 检测到完成，发送剩余内容`);
                    logger.info(`[Streamer ${groupName}] 检测到完成，发送剩余内容`, { module: "streamer", groupName });
                    // 发送剩余内容（不等待节流，立即发送）
                    const remaining = buffer.forceFlush();
                    if (remaining.trim()) {
                        await options.onChunk(remaining, false);
                    }
                    return { success: true };
                }
            }
        }

        // 超时处理
        console.log(`[Streamer ${groupName}] 超时，发送剩余内容`);
        logger.warn(`[Streamer ${groupName}] 超时，发送剩余内容`, { module: "streamer", groupName });
        const remaining = buffer.forceFlush();
        if (remaining.trim()) {
            await options.onChunk(remaining, false);
        }
        return { success: true };  // 部分内容也算成功
    } catch (error: any) {
        console.error(`[Streamer ${groupName}] 轮询异常: ${error.message}`);
        logger.error(`[Streamer ${groupName}] 轮询异常: ${error.message}`, { module: "streamer", groupName, error });
        // 发送剩余内容
        const remaining = buffer.forceFlush();
        if (remaining.trim()) {
            await options.onChunk(remaining, false);
        }
        return { success: false, error: error.message };
    }
}

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

// 轮询配置（优化响应速度）
const FAST_INTERVAL = 200;        // 首次交付前（更快的初始检测）
const SLOW_INTERVAL = 500;        // 首次交付后（更快的持续检测）
const MAX_WAIT_MS = 30000;        // 绝对超时 30 秒
const SILENT_TIMEOUT = 10000;     // 静默超时 10 秒（长回复兜底）
const STALLED_TIMEOUT = 5000;     // 卡住超时 5 秒（有内容但无新增时快速收尾）
const SHORT_SILENT_TIMEOUT = 3000; // 短回复静默超时 3 秒
const SHORT_RESPONSE_THRESHOLD = 200; // 短回复长度阈值
const NO_RESPONSE_TIMEOUT = 5000; // 未收到任何输出时的兜底超时

/**
 * 延时函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从 tmux 输出中提取新增内容（去除发送的消息和提示符）
 */
function extractTmuxDiff(oldOutput: string, newOutput: string, sentMessage: string): string {
    if (!oldOutput || !newOutput) return "";

    const oldLines = oldOutput.split("\n");
    const newLines = newOutput.split("\n");

    // 找到第一个不同的行
    let diffIndex = 0;
    for (let i = 0; i < Math.min(oldLines.length, newLines.length); i++) {
        if (oldLines[i] !== newLines[i]) {
            diffIndex = i;
            break;
        }
        diffIndex = i + 1;
    }

    // 提取差异部分
    let diffLines = newLines.slice(diffIndex);

    // 过滤掉：1. 发送的消息本身
    // 2. 纯提示符行（如 "❯ " 或 "? for shortcuts"）
    // 3. 空行
    const filteredLines = diffLines
        .filter(line => {
            const trimmed = line.trim();
            // 移除发送的消息
            if (trimmed === sentMessage || trimmed.includes(sentMessage.substring(0, 30))) {
                return false;
            }
            // 移除纯提示符
            if (trimmed === "❯" || trimmed === "?" || trimmed.startsWith("? for")) {
                return false;
            }
            // 移除分隔线
            if (trimmed.startsWith("──")) {
                return false;
            }
            return true;
        });

    return filteredLines.join("\n").trim();
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
    minInterval?: number;     // 发送最小间隔，默认 1000ms（优化响应速度）
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
    const throttler = new Throttler(options.minInterval ?? 1000);  // 默认 1000ms 节流，平衡响应速度和碎片化

    // 发送前记录当前状态
    const beforeResult = await reader.readProject(options.projectDir);
    let currentText = "";  // 累积的完整文本
    let lastTmuxOutput = await TmuxSession.capturePane(sessionName, 50); // 记录发送前的 tmux 输出

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
    let hasToolUse = false; // 检测是否有工具调用
    const startTime = Date.now();
    let lastContentTime = Date.now(); // 最近收到内容的时间戳

    try {
        while (Date.now() - startTime < timeout) {
            await sleep(pollInterval);

            // 读取新增内容
            const result = await reader.readProject(options.projectDir);
            if (result.entries.length === 0) {
                // 完全无输出：5 秒兜底，先尝试读取 tmux 输出
                if (!hasResponse && Date.now() - startTime > NO_RESPONSE_TIMEOUT) {
                    // 先尝试读取 tmux 输出
                    const tmuxOutput = await TmuxSession.capturePane(sessionName, 100);
                    const tmuxDiff = extractTmuxDiff(lastTmuxOutput, tmuxOutput, message);

                    if (tmuxDiff) {
                        console.log(`[Streamer ${groupName}] 无响应但 tmux 有输出，使用 tmux 内容`);
                        logger.info(`[Streamer ${groupName}] 无响应但 tmux 有输出，使用 tmux 内容`, { module: "streamer", groupName, tmuxDiffLength: tmuxDiff.length });
                        buffer.append(tmuxDiff);
                        const remaining = buffer.forceFlush();
                        if (remaining.trim()) {
                            await options.onChunk(remaining, false);
                        }
                        return { success: true };
                    }

                    // tmux 也没有输出，发送兜底提示
                    const fallback = "⚠️ 未收到 Claude 响应，请稍后重试";
                    console.log(`[Streamer ${groupName}] 无响应超时，发送兜底提示`);
                    logger.warn(`[Streamer ${groupName}] 无响应超时，发送兜底提示`, { module: "streamer", groupName });
                    await options.onChunk(fallback, false);
                    return { success: false, error: "no response" };
                }
                // 静默检测：无新增内容且已超过静默阈值时结束
                if (hasResponse) {
                    const silentSpan = Date.now() - lastContentTime;
                    // 短回复快速收尾
                    if (buffer.length <= SHORT_RESPONSE_THRESHOLD && silentSpan > SHORT_SILENT_TIMEOUT) {
                        console.log(`[Streamer ${groupName}] 静默超时（短回复），发送剩余内容`);
                        logger.info(`[Streamer ${groupName}] 静默超时（短回复），发送剩余内容`, { module: "streamer", groupName, silentSpan });
                        const remaining = buffer.forceFlush();
                        if (remaining.trim()) {
                            await options.onChunk(remaining, false);
                        }
                        return { success: true };
                    }
                    // 有内容但卡住：工具调用时延长等待，否则 5 秒收尾
                    const stalledTimeout = hasToolUse ? SILENT_TIMEOUT : STALLED_TIMEOUT;
                    if (buffer.length > 0 && silentSpan > stalledTimeout) {
                        console.log(`[Streamer ${groupName}] 卡住超时（${silentSpan}ms 无增量，有 ${buffer.length} 字符，工具调用: ${hasToolUse}），发送剩余内容`);
                        logger.info(`[Streamer ${groupName}] 卡住超时，发送剩余内容`, { module: "streamer", groupName, silentSpan, bufferLength: buffer.length, hasToolUse });
                        const remaining = buffer.forceFlush();
                        if (remaining.trim()) {
                            await options.onChunk(remaining, false);
                        }
                        return { success: true };
                    }
                    // 普通静默收尾
                    if (silentSpan > SILENT_TIMEOUT) {
                        console.log(`[Streamer ${groupName}] 静默超时，发送剩余内容`);
                        logger.info(`[Streamer ${groupName}] 静默超时，发送剩余内容`, { module: "streamer", groupName, silentSpan });
                        const remaining = buffer.forceFlush();
                        if (remaining.trim()) {
                            await options.onChunk(remaining, false);
                        }
                        return { success: true };
                    }
                }
                continue;
            }

            // 解析新增内容
            const parseResult = AssistantParser.parse(result.entries);
            const newText = parseResult.text;

            // 检测工具调用（文本包含 🔧 执行: 标记）
            if (newText.includes("🔧 执行:")) {
                hasToolUse = true;
            }

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
                lastContentTime = Date.now();
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
            } else {
                // 已有响应且长时间无新增字符，认为完成
                if (hasResponse) {
                    const silentSpan = Date.now() - lastContentTime;
                    // 短回复快速收尾
                    if (buffer.length <= SHORT_RESPONSE_THRESHOLD && silentSpan > SHORT_SILENT_TIMEOUT) {
                        console.log(`[Streamer ${groupName}] 静默超时（短回复，无增量），发送剩余内容`);
                        logger.info(`[Streamer ${groupName}] 静默超时（短回复，无增量），发送剩余内容`, { module: "streamer", groupName, silentSpan });
                        const remaining = buffer.forceFlush();
                        if (remaining.trim()) {
                            await options.onChunk(remaining, false);
                        }
                        return { success: true };
                    }
                    // 有内容但卡住：工具调用时延长等待，否则 5 秒收尾
                    const stalledTimeout = hasToolUse ? SILENT_TIMEOUT : STALLED_TIMEOUT;
                    if (buffer.length > 0 && silentSpan > stalledTimeout) {
                        console.log(`[Streamer ${groupName}] 卡住超时（${silentSpan}ms 无增量，有 ${buffer.length} 字符，工具调用: ${hasToolUse}），发送剩余内容`);
                        logger.info(`[Streamer ${groupName}] 卡住超时，发送剩余内容`, { module: "streamer", groupName, silentSpan, bufferLength: buffer.length, hasToolUse });
                        const remaining = buffer.forceFlush();
                        if (remaining.trim()) {
                            await options.onChunk(remaining, false);
                        }
                        return { success: true };
                    }
                    if (silentSpan > SILENT_TIMEOUT) {
                        console.log(`[Streamer ${groupName}] 静默超时（无增量），发送剩余内容`);
                        logger.info(`[Streamer ${groupName}] 静默超时（无增量），发送剩余内容`, { module: "streamer", groupName, silentSpan });
                        const remaining = buffer.forceFlush();
                        if (remaining.trim()) {
                            await options.onChunk(remaining, false);
                        }
                        return { success: true };
                    }
                }
            }
        }

        // 超时处理
        console.log(`[Streamer ${groupName}] 超时，尝试读取 tmux 输出作为兜底`);
        logger.warn(`[Streamer ${groupName}] 超时，尝试读取 tmux 输出作为兜底`, { module: "streamer", groupName });

        // 读取 tmux 终端输出作为兜底
        const tmuxOutput = await TmuxSession.capturePane(sessionName, 100);
        const tmuxDiff = extractTmuxDiff(lastTmuxOutput, tmuxOutput, message);

        // 如果 tmux 有新内容，添加到缓冲区
        if (tmuxDiff) {
            console.log(`[Streamer ${groupName}] 从 tmux 捕获到 ${tmuxDiff.length} 字符`);
            logger.info(`[Streamer ${groupName}] 从 tmux 捕获到 ${tmuxDiff.length} 字符`, { module: "streamer", groupName, tmuxDiffLength: tmuxDiff.length });
            buffer.append(tmuxDiff);
        }

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

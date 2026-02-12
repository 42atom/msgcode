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
import { sendAttachmentsToSession } from "./sender.js";
import type { Attachment } from "../imsg/types.js";

// 轮询配置（优化响应速度）
const FAST_INTERVAL = 150;        // 首次交付前（更快的初始检测）
const SLOW_INTERVAL = 1000;       // 首次交付后（更快的持续检测）
const MAX_WAIT_MS = 30 * 60 * 1000; // 绝对超时 30 分钟
const SILENT_TIMEOUT = 6000;      // 静默超时 6 秒（长回复兜底）
const STALLED_TIMEOUT = 2500;     // 卡住超时 2.5 秒（有内容但无新增时快速收尾）
const TOOL_SILENT_TIMEOUT = 90000; // 工具执行期静默超时 90 秒（WebSearch 可能较慢）
const SHORT_SILENT_TIMEOUT = 1500; // 短回复静默超时 1.5 秒
const SHORT_RESPONSE_THRESHOLD = 200; // 短回复长度阈值
const NO_RESPONSE_TIMEOUT = 3000; // 未收到任何输出时的兜底超时（避免过早打断）
const PROMPT_GRACE_TIMEOUT = 20000; // 提示符未出现时的宽限等待
const PROMPT_GRACE_MAX = 3; // 提示符宽限次数上限，避免无穷等待

/**
 * 延时函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 检测交互提示文本
 */
function detectInteractionPrompt(text: string): string | null {
    const promptPatterns = [
        /Do you want to proceed\?/i,
        /Type here to tell Claude what to do differently/i,
        /选择.*是否/i,
        /请输入.*数字/i,
        /Press 1\/2/i,
    ];

    for (const pattern of promptPatterns) {
        if (pattern.test(text)) {
            return text.split("\n").slice(-2).join(" ").trim();
        }
    }
    return null;
}

function isClaudePromptReady(output: string): boolean {
    return output.includes("How can I help?") || output.includes("╭") || output.trim().endsWith("❯");
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
            // 移除 Claude 过程提示
            if (/Pontificating|Coalescing|Thinking|esc to interrupt/i.test(trimmed)) {
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
 * 流式输出选项
 */
export interface StreamOptions {
    projectDir?: string;
    timeout?: number;         // 默认 30s
    fastInterval?: number;    // 默认 300ms
    slowInterval?: number;    // 默认 3000ms
    minInterval?: number;     // 发送最小间隔，默认 1000ms（优化响应速度）
    onChunk: (chunk: string, isToolUse: boolean) => Promise<void>;
    attachments?: readonly Attachment[];
}

/**
 * 流式输出结果
 *
 * P0 增强：增加状态标志，让调用方能区分完整响应和超时兆底
 */
export interface StreamResult {
    success: boolean;
    partial?: boolean;     // 部分完成（超时但有内容）
    incomplete?: boolean;  // 是否未完整发送
    timedOut?: boolean;    // 是否因超时结束
    finished?: boolean;    // 是否检测到完成标记
    finishReason?: string; // 完成的理由（stop hook / status）
    interactionPrompt?: string; // Claude 正在等待交互提示
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

    await sendAttachmentsToSession(sessionName, options.attachments);

    // 创建独立的 reader、buffer、throttler（并发安全）
    const reader = new OutputReader();
    const buffer = new BufferManager();
    const throttler = new Throttler(options.minInterval ?? 1000);  // 默认 1000ms 节流，平衡响应速度和碎片化
    let interactionPrompt: string | null = null;

    const finalizeResult = async (reason: string, params?: {
        timedOut?: boolean;
        partial?: boolean;
        finished?: boolean;
        incomplete?: boolean;
    }): Promise<StreamResult> => {
        const remaining = buffer.forceFlush();
        if (remaining.trim()) {
            await options.onChunk(remaining, false);
        }
        return {
            success: true,
            timedOut: params?.timedOut ?? false,
            partial: params?.partial ?? (remaining.trim() !== ""),
            finished: params?.finished ?? true,
            incomplete: params?.incomplete,
            finishReason: reason,
            interactionPrompt: interactionPrompt ?? undefined,
        };
    };

    // 发送前记录当前状态
    const beforeResult = await reader.readProject(options.projectDir);
    let currentText = "";  // 累积的完整文本
    let lastTmuxOutput = await TmuxSession.capturePane(sessionName, 50); // 记录发送前的 tmux 输出

    // E16: trace 发送前状态
    console.log(`[Streamer ${groupName}] 发送前 offset: ${beforeResult.newOffset}`);
    logger.debug(`[Streamer ${groupName}] 发送前 offset: ${beforeResult.newOffset}`, {
        module: "streamer",
        groupName,
        offset: beforeResult.newOffset,
        entriesCount: beforeResult.entries.length,
        messagePreview: message.slice(0, 50),
    });

    if (process.env.DEBUG_TRACE === "1") {
        logger.debug("发送前 JSONL 状态", {
            module: "streamer",
            groupName,
            offset: beforeResult.newOffset,
            entriesCount: beforeResult.entries.length,
        });
    }

    // 发送消息（P0: 使用 sendTextLiteral + sendEnter，直接发送原文）
    try {
        await TmuxSession.sendTextLiteral(sessionName, message);
        await new Promise(resolve => setTimeout(resolve, 50)); // 延迟防止UI吞键
        await TmuxSession.sendEnter(sessionName);
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
    let sentThinking = false; // 无响应时只提示一次
    const startTime = Date.now();
    let lastContentTime = Date.now(); // 最近收到内容的时间戳
    let promptGraceUntil = 0;
    let promptGraceCount = 0;

    try {
    while (Date.now() - startTime < timeout) {
            await sleep(pollInterval);

            // 读取新增内容
            const result = await reader.readProject(options.projectDir);
            if (result.entries.length === 0) {
                // 完全无输出：5 秒提示“思考中”，继续等待最终回复
                if (!hasResponse && Date.now() - startTime > NO_RESPONSE_TIMEOUT) {
                    if (!sentThinking) {
                        const fallback = "思考中";
                        console.log(`[Streamer ${groupName}] 无响应超时，发送兜底提示`);
                        logger.warn(`[Streamer ${groupName}] 无响应超时，发送兜底提示`, { module: "streamer", groupName });
                        await options.onChunk(fallback, false);
                        sentThinking = true;
                    }
                }
                // 静默检测：无新增内容且已超过静默阈值时结束
                if (hasResponse) {
                    const silentSpan = Date.now() - lastContentTime;
                    // 短回复快速收尾
                if (!hasToolUse && buffer.length <= SHORT_RESPONSE_THRESHOLD && silentSpan > SHORT_SILENT_TIMEOUT) {
                    const now = Date.now();
                    if (now < promptGraceUntil) {
                        continue;
                    }
                    const pane = await TmuxSession.capturePane(sessionName, 50);
                    if (pane && !isClaudePromptReady(pane)) {
                        if (promptGraceCount < PROMPT_GRACE_MAX) {
                            promptGraceUntil = now + PROMPT_GRACE_TIMEOUT;
                            promptGraceCount += 1;
                            logger.info(`[Streamer ${groupName}] Claude 未返回提示符，延长等待`, { module: "streamer", groupName, silentSpan, promptGraceCount });
                            continue;
                        }
                        logger.warn(`[Streamer ${groupName}] 提示符等待次数上限，结束等待`, { module: "streamer", groupName, silentSpan, promptGraceCount });
                    }
                    console.log(`[Streamer ${groupName}] 静默超时（短回复），发送剩余内容`);
                    logger.info(`[Streamer ${groupName}] 静默超时（短回复），发送剩余内容`, { module: "streamer", groupName, silentSpan });
                    return await finalizeResult("silent_short_timeout", { timedOut: true, finished: true, partial: false });
                }
                // 有内容但卡住：工具调用时延长等待，否则 5 秒收尾
                const stalledTimeout = hasToolUse ? TOOL_SILENT_TIMEOUT : STALLED_TIMEOUT;
                if (buffer.length > 0 && silentSpan > stalledTimeout) {
                    console.log(`[Streamer ${groupName}] 卡住超时（${silentSpan}ms 无增量，有 ${buffer.length} 字符，工具调用: ${hasToolUse}），发送剩余内容`);
                    logger.info(`[Streamer ${groupName}] 卡住超时，发送剩余内容`, { module: "streamer", groupName, silentSpan, bufferLength: buffer.length, hasToolUse });
                    return await finalizeResult("stalled_timeout", { timedOut: true, finished: true });
                }
                // 普通静默收尾
                const silentTimeout = hasToolUse ? TOOL_SILENT_TIMEOUT : SILENT_TIMEOUT;
                if (silentSpan > silentTimeout) {
                    console.log(`[Streamer ${groupName}] 静默超时，发送剩余内容`);
                    logger.info(`[Streamer ${groupName}] 静默超时，发送剩余内容`, { module: "streamer", groupName, silentSpan });
                    return await finalizeResult("silent_timeout", { timedOut: true, finished: true });
                }
                }
                continue;
            }

            // 解析新增内容
            const parseResult = AssistantParser.parse(result.entries);
            const newText = parseResult.text;

            const detected = detectInteractionPrompt(newText);
            if (detected) {
                interactionPrompt = detected;
            }

            // 检测工具调用（来自 JSONL 的 tool_use/tool_result）
            if (parseResult.hasToolUse || AssistantParser.hasToolActivity(result.entries)) {
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

            const deltaText = newText.slice(currentText.length);
            currentText = newText;
            if (deltaText.length > 0) {
                lastContentTime = Date.now();
                // 累积到缓冲区
                buffer.append(deltaText);

                console.log(`[Streamer ${groupName}] 新增 ${deltaText.length} 字符, 缓冲区: ${buffer.length}, 完成: ${parseResult.isComplete}`);
                logger.debug(`[Streamer ${groupName}] 新增 ${deltaText.length} 字符, 缓冲区: ${buffer.length}, 完成: ${parseResult.isComplete}`, { module: "streamer", groupName, deltaChars: deltaText.length, bufferLength: buffer.length, isComplete: parseResult.isComplete });

                // 首次检测到内容后，切换到慢速轮询
                if (!hasResponse) {
                    hasResponse = true;
                    pollInterval = slowInterval;
                }

                // 短回复立即发送
                const immediateFlush = buffer.length <= SHORT_RESPONSE_THRESHOLD;

                if (immediateFlush || buffer.shouldFlush()) {
                    const chunk = buffer.flush();
                    if (chunk.trim()) {
                        console.log(`[Streamer ${groupName}] 发送块: ${chunk.length} 字符`);
                        logger.debug(`[Streamer ${groupName}] 发送块: ${chunk.length} 字符`, { module: "streamer", groupName, chunkLength: chunk.length, immediateFlush });
                        await throttler.wait();
                        await options.onChunk(chunk, false);
                        throttler.recordSend();
                    }
                }
            } else if (hasResponse) {
                // 已有响应且长时间无新增字符，认为完成
                const silentSpan = Date.now() - lastContentTime;
                // 短回复快速收尾
                if (!hasToolUse && buffer.length <= SHORT_RESPONSE_THRESHOLD && silentSpan > SHORT_SILENT_TIMEOUT) {
                    const now = Date.now();
                    if (now < promptGraceUntil) {
                        continue;
                    }
                    const pane = await TmuxSession.capturePane(sessionName, 50);
                    if (pane && !isClaudePromptReady(pane)) {
                        if (promptGraceCount < PROMPT_GRACE_MAX) {
                            promptGraceUntil = now + PROMPT_GRACE_TIMEOUT;
                            promptGraceCount += 1;
                            logger.info(`[Streamer ${groupName}] Claude 未返回提示符，延长等待`, { module: "streamer", groupName, silentSpan, promptGraceCount });
                            continue;
                        }
                        logger.warn(`[Streamer ${groupName}] 提示符等待次数上限，结束等待`, { module: "streamer", groupName, silentSpan, promptGraceCount });
                    }
                    console.log(`[Streamer ${groupName}] 静默超时（短回复，无增量），发送剩余内容`);
                    logger.info(`[Streamer ${groupName}] 静默超时（短回复，无增量），发送剩余内容`, { module: "streamer", groupName, silentSpan });
                    return await finalizeResult("silent_short_timeout", { timedOut: true, finished: true, partial: false });
                }
                // 有内容但卡住：工具调用时延长等待，否则 5 秒收尾
                const stalledTimeout = hasToolUse ? TOOL_SILENT_TIMEOUT : STALLED_TIMEOUT;
                if (buffer.length > 0 && silentSpan > stalledTimeout) {
                    console.log(`[Streamer ${groupName}] 卡住超时（${silentSpan}ms 无增量，有 ${buffer.length} 字符，工具调用: ${hasToolUse}），发送剩余内容`);
                    logger.info(`[Streamer ${groupName}] 卡住超时，发送剩余内容`, { module: "streamer", groupName, silentSpan, bufferLength: buffer.length, hasToolUse });
                    return await finalizeResult("stalled_timeout", { timedOut: true, finished: true });
                }
                const silentTimeout = hasToolUse ? TOOL_SILENT_TIMEOUT : SILENT_TIMEOUT;
                if (silentSpan > silentTimeout) {
                    console.log(`[Streamer ${groupName}] 静默超时（无增量），发送剩余内容`);
                    logger.info(`[Streamer ${groupName}] 静默超时（无增量），发送剩余内容`, { module: "streamer", groupName, silentSpan });
                    return await finalizeResult("silent_timeout", { timedOut: true, finished: true });
                }
            }
            if (parseResult.isComplete) {
                console.log(`[Streamer ${groupName}] 检测到完成，发送剩余内容`);
                logger.info(`[Streamer ${groupName}] 检测到完成，发送剩余内容`, { module: "streamer", groupName });
                return await finalizeResult(parseResult.finishReason ?? "complete");
            }
        }

        // 超时处理
        console.log(`[Streamer ${groupName}] 超时，发送剩余内容`);
        logger.warn(`[Streamer ${groupName}] 超时，发送剩余内容`, { module: "streamer", groupName });
        if (!hasResponse) {
            await options.onChunk("未收到最终回复，请稍后重试", false);
        }
        return await finalizeResult("timeout", { timedOut: true, finished: false, incomplete: !hasResponse });
    } catch (error: any) {
        console.error(`[Streamer ${groupName}] 轮询异常: ${error.message}`);
        logger.error(`[Streamer ${groupName}] 轮询异常: ${error.message}`, { module: "streamer", groupName, error, stack: error.stack });
        // 发送剩余内容
        const remaining = buffer.forceFlush();
        if (remaining.trim()) {
            await options.onChunk(remaining, false);
        }
        return { success: false, finished: false, interactionPrompt: interactionPrompt ?? undefined, error: error.message };
    }
}

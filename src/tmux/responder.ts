/**
 * matcode-mac: 请求-响应模式的 Claude 交互
 *
 * 发送消息到 Claude 并同步等待回复
 */

import { TmuxSession } from "./session.js";
import { OutputReader } from "../output/reader.js";
import { AssistantParser, type ParseResult } from "../output/parser.js";

/**
 * 轮询配置（参考 Matcode）
 */
const FAST_INTERVAL = 300;      // 首次交付前
const SLOW_INTERVAL = 3000;     // 首次交付后
const MAX_WAIT_MS = 30000;      // 最大等待
const STABLE_COUNT = 3;         // 稳定计数（连续 N 次无变化视为完成）

/**
 * 共享的 Reader 实例（单例模式）
 * 保持 offset 状态跨请求共享
 */
const sharedReader = new OutputReader();

/**
 * 响应选项
 */
export interface ResponseOptions {
    projectDir?: string;
    timeout?: number;       // 默认 30s
    fastInterval?: number;  // 默认 300ms
    slowInterval?: number;  // 默认 3000ms
}

/**
 * 响应结果
 */
export interface ResponseResult {
    success: boolean;
    response?: string;
    error?: string;
    incomplete?: boolean;  // 超时但有部分内容
}

/**
 * 延时函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 发送消息到 Claude 并等待回复（请求-响应模式）
 *
 * 流程：
 * 1. 发送前记录 JSONL offset
 * 2. 发送消息到 tmux
 * 3. 轮询检查新内容（快慢策略 + 稳定计数）
 * 4. 检测 Stop Hook 后返回
 * 5. 超时处理
 */
export async function handleTmuxSend(
    groupName: string,
    message: string,
    options: ResponseOptions = {}
): Promise<ResponseResult> {
    const sessionName = TmuxSession.getSessionName(groupName);

    // 检查会话是否存在
    const exists = await TmuxSession.exists(groupName);
    if (!exists) {
        return { success: false, error: `tmux 会话未运行，请先发送 /start` };
    }

    // 默认参数
    const timeout = options.timeout ?? MAX_WAIT_MS;
    const fastInterval = options.fastInterval ?? FAST_INTERVAL;
    const slowInterval = options.slowInterval ?? SLOW_INTERVAL;

    // 1. 发送前记录当前状态（使用共享 reader）
    const beforeResult = await sharedReader.readProject(options.projectDir);
    const startOffset = beforeResult.newOffset;

    console.log(`[Responder ${groupName}] 发送前 offset: ${startOffset}`);

    // 3. 发送消息
    try {
        const escapedMessage = escapeMessage(message);
        await TmuxSession.sendCommand(sessionName, escapedMessage);
        await TmuxSession.sendCommand(sessionName, ""); // 额外 Enter 确认
    } catch (error: any) {
        return { success: false, error: `发送失败: ${error.message}` };
    }

    // 4. 轮询等待回复（快慢策略 + 稳定计数）
    let pollInterval = fastInterval;
    let hasResponse = false;
    let currentText = "";
    let stableCount = 0;  // 稳定计数：连续 N 次无新内容
    let lastTextLength = 0;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        await sleep(pollInterval);

        // 读取新增内容
        const result = await sharedReader.readProject(options.projectDir);
        if (result.entries.length === 0) {
            continue;
        }

        // 解析新增内容
        const parseResult = AssistantParser.parse(result.entries);
        const newText = AssistantParser.toPlainText(parseResult);

        console.log(`[Responder ${groupName}] 新增 ${newText.length} 字符, 完成: ${parseResult.isComplete}, 稳定: ${stableCount}/${STABLE_COUNT}`);

        if (newText.length > 0) {
            currentText += newText;

            // 首次检测到内容后，切换到慢速轮询
            if (!hasResponse) {
                hasResponse = true;
                pollInterval = slowInterval;
            }

            // 重置稳定计数
            stableCount = 0;
            lastTextLength = currentText.length;

            // 检测 Stop Hook - 完成后立即返回
            if (parseResult.isComplete) {
                const cleanedText = removeUserEcho(currentText, message);
                return {
                    success: true,
                    response: formatResponse(cleanedText)
                };
            }
        } else {
            // 无新内容，增加稳定计数
            if (hasResponse && currentText.length > 0) {
                stableCount++;
                // 连续 N 次无新内容，视为完成
                if (stableCount >= STABLE_COUNT) {
                    console.log(`[Responder ${groupName}] 稳定计数达标，返回`);
                    const cleanedText = removeUserEcho(currentText, message);
                    return {
                        success: true,
                        response: formatResponse(cleanedText)
                    };
                }
            }
        }
    }

    // 5. 超时处理
    if (hasResponse && currentText.length > 0) {
        const cleanedText = removeUserEcho(currentText, message);
        return {
            success: true,
            incomplete: true,
            response: formatResponse(cleanedText) + "\n\n... (超时，可能未完成)"
        };
    }

    return { success: false, error: "Claude 响应超时（30s）" };
}

/**
 * 转义消息中的特殊字符
 */
function escapeMessage(message: string): string {
    return message
        .replace(/\\/g, '\\\\\\\\')  // 反斜杠：\ → \\
        .replace(/"/g, '\\"')        // 双引号
        .replace(/\$/g, '\\$')       // 美元符号
        .replace(/;/g, '\\;')        // 分号
        .replace(/\(/g, '\\(')       // 左括号
        .replace(/\)/g, '\\)');      // 右括号
}

/**
 * 移除 Claude 回显的用户输入（参考 Matcode）
 */
function removeUserEcho(text: string, userPrompt: string): string {
    // Claude 有时会回显用户输入
    const trimmedText = text.trim();
    const trimmedPrompt = userPrompt.trim();

    if (trimmedText.startsWith(trimmedPrompt)) {
        return trimmedText.slice(trimmedPrompt.length).trim();
    }
    return trimmedText;
}

/**
 * 格式化响应（长度限制）
 */
function formatResponse(text: string): string {
    const maxLength = 4000;
    if (text.length <= maxLength) {
        return text;
    }
    return text.slice(0, maxLength - 50) + "\n\n... (消息过长，已截断)";
}

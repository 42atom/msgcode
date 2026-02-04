/**
 * msgcode: 请求-响应模式的 Claude/Codex 交互（T2/T3: 支持 Codex）
 *
 * 发送消息到 Claude/Codex 并同步等待回复
 */

import { TmuxSession, type RunnerType } from "./session.js";
import { SessionStatus } from "./session.js";
import { OutputReader } from "../output/reader.js";
import { AssistantParser } from "../output/parser.js";
import { CodexOutputReader } from "../output/codex-reader.js";
import { CodexParser } from "../output/codex-parser.js";
import { logger } from "../logger/index.js";
import { sendAttachmentsToSession } from "./sender.js";
import type { Attachment } from "../imsg/types.js";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * 轮询配置（参考 Matcode）
 */
const FAST_INTERVAL = 300;      // 首次交付前
const SLOW_INTERVAL = 3000;     // 首次交付后
const MAX_WAIT_MS_CLAUDE = 300000; // Claude 默认最大等待 5 分钟
const MAX_WAIT_MS_CODEX = 600000;  // Codex 偶尔会更慢，默认给到 10 分钟避免误判超时
const STABLE_COUNT = 3;         // 稳定计数（连续 N 次无变化视为完成）

/**
 * 响应选项
 */
export interface ResponseOptions {
    projectDir?: string;
    runner?: RunnerType;    // T2/T3: 执行臂类型（claude 或 codex）
    timeout?: number;       // 默认 30s
    fastInterval?: number;  // 默认 300ms
    slowInterval?: number;  // 默认 3000ms
    attachments?: readonly Attachment[];
    signal?: AbortSignal;   // 允许上游中断（如 /stop /esc /status）
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
async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
        await sleep(ms);
        return;
    }
    await sleep(ms, undefined, { signal });
}

/**
 * 发送消息到 Claude/Codex 并等待回复（T2/T3: 支持 Codex）
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
    const runner = options.runner ?? "claude";
    // fail-fast：会话存在但尚未就绪时，不要把消息直接塞进输入流（会导致长时间无输出）
    // 远程手机端体验：必须快速给到“还在启动”的反馈，而不是等待 5-10 分钟超时。
    try {
        const status = await TmuxSession.getRunnerStatus(groupName, runner);
        if (status !== SessionStatus.Ready) {
            const runnerName = runner === "codex" ? "Codex" : "Claude";
            return { success: false, error: `${runnerName} 尚未就绪，请稍等后再试（/status 查看），或发送 /start 重启会话` };
        }
    } catch {
        // best-effort：status 探测失败时继续走原逻辑（避免误伤）
    }

    const timeout = options.timeout ?? (runner === "codex" ? MAX_WAIT_MS_CODEX : MAX_WAIT_MS_CLAUDE);
    const fastInterval = options.fastInterval ?? FAST_INTERVAL;
    const slowInterval = options.slowInterval ?? SLOW_INTERVAL;

    // T2/T3: 根据执行臂选择不同的读取器和解析器
    const isCodex = runner === "codex";
    const signal = options.signal;

    // 1. 创建独立 reader 实例（并发安全：每个请求有独立状态）
    const codexReader = isCodex ? new CodexOutputReader() : null;
    const claudeReader = !isCodex ? new OutputReader() : null;

    // T3/P0: Codex 必须按 workspace 定位 JSONL 文件，避免跨项目串味/泄露
    const codexJsonlPath = isCodex
        ? (options.projectDir ? await codexReader!.findLatestJsonlForWorkspace(options.projectDir) : null)
        : null;
    if (isCodex && !options.projectDir) {
        return { success: false, error: "缺少工作区路径（projectDir），无法定位 Codex 会话日志。请先 /bind 绑定工作区。" };
    }
    if (isCodex && !codexJsonlPath) {
        return { success: false, error: "未找到 Codex 会话日志（~/.codex/sessions/**/rollout-*.jsonl）。请先 /start 启动 Codex，会话生成后再试。" };
    }

    // 2. 发送前记录当前状态
    const startOffset = isCodex
        ? await codexReader!.seekToEnd(codexJsonlPath!)
        : (await claudeReader!.readProject(options.projectDir)).newOffset;

    console.log(`[Responder ${groupName}] 发送前 offset: ${startOffset}, runner: ${runner}`);
    logger.debug(`[Responder ${groupName}] 发送前 offset: ${startOffset}`, { module: "responder", groupName, offset: startOffset, runner, codexJsonlPath });

    // 3. 发送附件（Codex 暂不支持附件）
    if (!isCodex) {
        await sendAttachmentsToSession(sessionName, options.attachments);
    }

    // 4. 发送消息（P0: 使用 sendTextLiteral + sendEnter，避免 Enter 被吞）
    try {
        if (signal?.aborted) {
            return { success: false, error: "__CANCELLED__" };
        }

        // P0: Codex 输入清洗 - 把 \n 折叠成空格（避免多行输入模式）
        let preparedMessage = prepareMessageForTmux(message);
        if (isCodex) {
            // Codex: 折叠换行符为空格，避免进入多行输入模式
            preparedMessage = preparedMessage.replace(/\n+/g, " ").trim();
        }

        // P0: 两步发送 - 先发送字面量文本，再发送 Enter
        await TmuxSession.sendTextLiteral(sessionName, preparedMessage);
        // 延迟 30-80ms 防止 UI 吞键
        await sleepMs(50, signal);
        await TmuxSession.sendEnter(sessionName);

        // P0: 提交校验兜底 - 检查文本是否仍在输入栏，如果是则补发 Enter
        await sleepMs(100, signal); // 等待一下让 UI 更新
        if (await TmuxSession.isTextStillInInput(sessionName, preparedMessage)) {
            logger.warn(`检测到 Enter 被吞，补发一次`, { module: "responder", groupName, runner });
            await TmuxSession.sendEnter(sessionName);
        }
    } catch (error: any) {
        if (signal?.aborted) {
            return { success: false, error: "__CANCELLED__" };
        }
        return { success: false, error: `发送失败: ${error.message}` };
    }

    // 4. 轮询等待回复（快慢策略 + 稳定计数）
    let pollInterval = fastInterval;
    let hasResponse = false;
    let currentText = "";
    let stableCount = 0;  // 稳定计数：连续 N 次无新内容
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        try {
            await sleepMs(pollInterval, signal);
        } catch {
            if (signal?.aborted) {
                return { success: false, error: "__CANCELLED__" };
            }
            throw new Error("sleep failed");
        }

        if (signal?.aborted) {
            return { success: false, error: "__CANCELLED__" };
        }

        // 读取新增内容
        const result = isCodex
            ? await codexReader!.read(codexJsonlPath!)
            : await claudeReader!.readProject(options.projectDir);

        // 注意：Codex/Claude 的 JSONL 有时会在输出完成后不再追加任何事件行。
        // 若我们只在“有新行”时推进稳定计数，会导致请求卡住直到超时。
        if (result.entries.length === 0) {
            if (hasResponse && currentText.length > 0) {
                stableCount++;
                if (stableCount >= STABLE_COUNT) {
                    logger.info(`[Responder ${groupName}] 无新日志行，稳定计数达标，返回`, {
                        module: "responder",
                        groupName,
                        stableCount,
                        runner,
                    });
                    const cleanedText = removeUserEcho(currentText, message);
                    return {
                        success: true,
                        response: formatResponse(cleanedText),
                    };
                }
            }
            continue;
        }

        // 解析新增内容（根据执行臂选择解析器）
        let newText = "";
        let isComplete = false;

        if (isCodex) {
            const codexEntries = result.entries as import("../output/codex-reader.js").CodexJSONLEntry[];
            const codexParseResult = CodexParser.parse(codexEntries);
            newText = CodexParser.toPlainText(codexParseResult);
            isComplete = codexParseResult.isComplete;
        } else {
            const claudeEntries = result.entries as import("../output/reader.js").JSONLEntry[];
            const claudeParseResult = AssistantParser.parse(claudeEntries);
            newText = AssistantParser.toPlainText(claudeParseResult);
            isComplete = claudeParseResult.isComplete;
        }

        console.log(`[Responder ${groupName}] 新增 ${newText.length} 字符, 完成: ${isComplete}, 稳定: ${stableCount}/${STABLE_COUNT}`);
        logger.debug(`[Responder ${groupName}] 新增 ${newText.length} 字符, 完成: ${isComplete}, 稳定: ${stableCount}/${STABLE_COUNT}`, { module: "responder", groupName, newChars: newText.length, isComplete, stableCount, runner });

        if (newText.length > 0) {
            currentText += newText;

            // 首次检测到内容后，切换到慢速轮询
            if (!hasResponse) {
                hasResponse = true;
                pollInterval = slowInterval;
            }

            // 重置稳定计数
            stableCount = 0;

            // 检测完成标志 - 完成后立即返回
            if (isComplete) {
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
                    logger.info(`[Responder ${groupName}] 稳定计数达标，返回`, { module: "responder", groupName, stableCount, runner });
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

    const runnerName = isCodex ? "Codex" : "Claude";
    return { success: false, error: `${runnerName} 响应超时（${Math.round(timeout / 1000)}s）` };
}

/**
 * 准备发送到 tmux 的消息
 *
 * 注意：tmux send-keys 使用 spawn(..., {shell:false})，无需做 shell escaping。
 * 这里仅做最小清洗，避免不必要的语义污染。
 */
function prepareMessageForTmux(message: string): string {
    // 统一换行（避免 Windows CRLF 混入）
    return message.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

/**
 * msgcode: 请求-响应模式的 Claude/Codex 交互（T2/T3: 支持 Codex）
 *
 * 发送消息到 Claude/Codex 并同步等待回复
 */

import { TmuxSession, type RunnerType, type RunnerTypeOld } from "./session.js";
import { SessionStatus } from "./session.js";
import { CodexOutputReader } from "../output/codex-reader.js";
import { CodexParser } from "../output/codex-parser.js";
import { logger } from "../logger/index.js";
import { sendAttachmentsToSession } from "./sender.js";
import { withRemoteHintIfNeeded } from "./remote_hint.js";
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
    /** 运行时分类（tmux 执行臂固定为 "tmux"） */
    runnerType?: RunnerType;
    /** 具体执行臂（用于区分 Codex vs Claude） */
    runnerOld?: RunnerTypeOld;
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
 * 查找 pane 中最后一个提示符行（用于诊断）
 *
 * @param paneOutput tmux pane 输出
 * @returns 最后一个提示符行，如果没找到返回空字符串
 */
function findLastPromptLine(paneOutput: string): string {
    const lines = paneOutput.split("\n");
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
        const line = lines[i]?.trim() || "";
        if (/^[›❯>]/.test(line)) {
            return line;
        }
    }
    return "";
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
    const promptForEchoRemoval = withRemoteHintIfNeeded(sessionName, message);
    // Claude 回读定位：优先用“用户原始消息”的末行作为 marker（更稳定，不受远程上下文多行影响）
    const userMarkerLine = getMarkerLineFromUserMessage(message);
    let sentTextForMarker = ""; // baseline-tail diff 的兜底锚点（基于真实发送到 tmux 的文本）

    // 检查会话是否存在
    const exists = await TmuxSession.exists(groupName);
    if (!exists) {
        return { success: false, error: `tmux 会话未运行，请先发送 /start` };
    }

    // 默认参数（P0: 收敛新旧类型）
    const runnerType: RunnerType = options.runnerType ?? "tmux";
    const runnerOld: RunnerTypeOld = options.runnerOld ?? "claude";

    // fail-fast：会话存在但尚未就绪时，不要把消息直接塞进输入流（会导致长时间无输出）
    // 远程手机端体验：必须快速给到"还在启动"的反馈，而不是等待 5-10 分钟超时。
    try {
        const status = await TmuxSession.getRunnerStatus(groupName, runnerType);
        if (status !== SessionStatus.Ready) {
            const runnerName = runnerOld === "codex" ? "Codex" : (runnerOld === "claude-code" ? "Claude Code" : "Claude");
            return { success: false, error: `${runnerName} 尚未就绪，请稍等后再试（/status 查看），或发送 /start 重启会话` };
        }
    } catch {
        // best-effort：status 探测失败时继续走原逻辑（避免误伤）
    }

    const timeout = options.timeout ?? (runnerOld === "codex" ? MAX_WAIT_MS_CODEX : MAX_WAIT_MS_CLAUDE);
    const fastInterval = options.fastInterval ?? FAST_INTERVAL;
    const slowInterval = options.slowInterval ?? SLOW_INTERVAL;

    // T2/T3: 根据执行臂选择不同的读取器和解析器
    // isCoderCLI: 仅 codex 使用 JSONL 输出（~/.codex/sessions/**/rollout-*.jsonl）
    // claude-code 默认从 tmux pane 读取（避免把它误判为 codex JSONL，导致“永远无回复”）
    const isCoderCLI = runnerOld === "codex";
    const signal = options.signal;

    // 1. 创建独立 reader 实例（并发安全：每个请求有独立状态）
    const coderReader = isCoderCLI ? new CodexOutputReader() : null;

    // T3/P0: Coder CLI 必须按 workspace 定位 JSONL 文件，避免跨项目串味/泄露
    const coderJsonlPath = isCoderCLI
        ? (options.projectDir ? await coderReader!.findLatestJsonlForWorkspace(options.projectDir) : null)
        : null;
    if (isCoderCLI && !options.projectDir) {
        return { success: false, error: "缺少工作区路径（projectDir），无法定位 Coder CLI 会话日志。请先 /bind 绑定工作区。" };
    }
    if (isCoderCLI && !coderJsonlPath) {
        return { success: false, error: "未找到 Coder CLI 会话日志（~/.codex/sessions/**/rollout-*.jsonl）。请先 /start 启动会话，日志生成后再试。" };
    }

    // 2. 发送前记录当前状态
    // - Coder CLI: 记录 JSONL offset
    // - Claude: 记录 tmux pane baseline tail（用于后续 diff）
    // P0 修复：使用末尾 8KB 作为锚点，而不是完整 pane，避免滚屏导致锚点丢失
    const BASELINE_TAIL_SIZE = 8192; // 8KB
    let startOffset = 0;
    let startPaneTail = "";
    if (isCoderCLI) {
        startOffset = await coderReader!.seekToEnd(coderJsonlPath!);
    } else {
        // Claude: 记录发送前的 pane 末尾作为 baseline tail
        const fullPane = await TmuxSession.capturePane(sessionName, 1200);
        startPaneTail = fullPane.slice(-BASELINE_TAIL_SIZE);
    }

    // 计算 baseline tail 的 SHA256（用于诊断，不泄露内容）
    const crypto = await import("node:crypto");
    const baselineTailSha = startPaneTail ? crypto.createHash("sha256").update(startPaneTail).digest("hex").slice(0, 8) : "";

    logger.debug(`[Responder ${groupName}] 发送前状态`, {
        module: "responder",
        groupName,
        runnerOld,
        coderJsonlPath,
        startOffset,
        baselineTailLen: startPaneTail.length,
        baselineTailSha,
    });

    // 3. 发送附件（Coder CLI 暂不支持附件）
    if (!isCoderCLI) {
        await sendAttachmentsToSession(sessionName, options.attachments);
    }

    logger.debug(`[Responder ${groupName}] 准备发送消息`, { module: "responder", groupName, runnerOld });
    // 4. 发送消息（P0: 使用 sendTextLiteral + sendEnter，避免 Enter 被吞）
    try {
        if (signal?.aborted) {
            return { success: false, error: "__CANCELLED__" };
        }

        // P0: Coder CLI 输入清洗 - 把 \n 折叠成空格（避免多行输入模式）
        let preparedMessage = prepareMessageForTmux(promptForEchoRemoval);
        if (isCoderCLI) {
            // Coder CLI: 折叠换行符为空格，避免进入多行输入模式
            preparedMessage = preparedMessage.replace(/\n+/g, " ").trim();
        }
        sentTextForMarker = preparedMessage;

        logger.debug(`[Responder ${groupName}] 发送消息`, { module: "responder", groupName, runnerOld, messageLen: preparedMessage.length });
        // P0: 两步发送 - 先发送字面量文本，再发送 Enter
        await TmuxSession.sendTextLiteral(sessionName, preparedMessage);
        // 延迟 30-80ms 防止 UI 吞键
        await sleepMs(50, signal);
        await TmuxSession.sendEnter(sessionName);

        logger.debug(`[Responder ${groupName}] 消息已发送，开始轮询`, { module: "responder", groupName, runnerOld });
        // P0: 提交校验兜底 - 检查文本是否仍在输入栏，如果是则补发 Enter
        await sleepMs(100, signal); // 等待一下让 UI 更新
        if (await TmuxSession.isTextStillInInput(sessionName, preparedMessage)) {
            logger.warn(`检测到 Enter 被吞，补发一次`, { module: "responder", groupName, runnerOld });
            await TmuxSession.sendEnter(sessionName);
        }
    } catch (error: any) {
        logger.error(`[Responder ${groupName}] 发送失败`, { module: "responder", groupName, runnerOld, error: error.message });
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
    let promptButNoOutputSince: number | null = null; // 防卡死：看到 prompt 但抓不到输出

    logger.debug(`[Responder ${groupName}] 开始轮询`, { module: "responder", groupName, runnerOld, timeout, pollInterval });
    let iteration = 0;

    while (Date.now() - startTime < timeout) {
        iteration++;
        if (iteration % 10 === 0) {
            logger.debug(`[Responder ${groupName}] 轮询迭代 ${iteration}`, { module: "responder", groupName, runnerOld, iteration });
        }
        try {
            await sleepMs(pollInterval, signal);
        } catch {
            logger.error(`[Responder ${groupName}] sleep 失败`, { module: "responder", groupName, runnerOld });
            if (signal?.aborted) {
                return { success: false, error: "__CANCELLED__" };
            }
            throw new Error("sleep failed");
        }

        if (signal?.aborted) {
            return { success: false, error: "__CANCELLED__" };
        }

        // 读取新增内容
        // - Codex: 从 JSONL 读取
        // - Claude: 从 tmux pane 读取
        let newText = "";
        let isComplete = false;

        if (isCoderCLI) {
            const result = await coderReader!.read(coderJsonlPath!);

            // Coder CLI JSONL 有时会在输出完成后不再追加任何事件行
            if (result.entries.length === 0) {
                if (hasResponse && currentText.length > 0) {
                    stableCount++;
                    if (stableCount >= STABLE_COUNT) {
                        logger.info(`[Responder ${groupName}] 无新日志行，稳定计数达标，返回`, {
                            module: "responder",
                            groupName,
                            stableCount,
                            runnerOld,
                        });
                        const cleanedText = removeUserEcho(currentText, promptForEchoRemoval);
                        return {
                            success: true,
                            response: formatResponse(cleanedText),
                        };
                    }
                }
                continue;
            }

            // 解析 Coder CLI 输出
            const codexEntries = result.entries as import("../output/codex-reader.js").CodexJSONLEntry[];
            const codexParseResult = CodexParser.parse(codexEntries);
            newText = CodexParser.toPlainText(codexParseResult);
            isComplete = codexParseResult.isComplete;
        } else {
            // Claude: 从 tmux pane 读取输出
            //
            // P0 经验：Claude Code 的 pane 输出会因为 resize/换行重排/动态状态行而变化，
            // baseline-tail diff 容易失效；因此优先用“发送文本的 marker”定位最后一次输入行。
            const currentPaneOutput = await TmuxSession.capturePane(sessionName, 2000);

            const markerExtract = extractAfterLastMarkerLine(currentPaneOutput, userMarkerLine);
            if (markerExtract) {
                // P0: marker 命中时，以 marker 边界为准（更稳定，避免 baseline-tail diff 覆盖结果）
                newText = cleanClaudeOutput(markerExtract.rawAfterMarker);
                // Claude Code UI 里 prompt 可能在“仍在思考”时出现（如 · Unravelling… + ❯），不能单靠 prompt 判定完成。
                // 经验：真正的 assistant 输出通常以 "⏺" 开头；因此用 hasAssistantOutput 做完成闸门，避免把“状态行”当最终输出。
                if (markerExtract.hasPromptAfter && markerExtract.hasAssistantOutput && (newText.length > 0 || currentText.length > 0)) {
                    isComplete = true;
                }
                if (markerExtract.hasPromptAfter && markerExtract.hasAssistantOutput && newText.length === 0 && currentText.length === 0) {
                    // 看到 assistant 输出（⏺）但提取结果为空：可能是输出被过滤/格式变化
                    if (promptButNoOutputSince === null) {
                        promptButNoOutputSince = Date.now();
                    }
                } else {
                    // 没看到 assistant 输出（⏺）时：认为仍在进行中，不启用 fuse
                    promptButNoOutputSince = null;
                }
                // rolling tail：用当前末尾更新锚点，下一轮更抗滚屏
                startPaneTail = currentPaneOutput.slice(-BASELINE_TAIL_SIZE);
            } else {
                // marker 没找到时，再走 baseline-tail diff 兜底（极端情况：用户输入行不在 pane 内）
                // 用 baseline tail 定位：在当前 pane 中找到 startPaneTail 的位置
                // 注意：直接 indexOf 可能因为 pane resize/换行重排/滚屏而失败，所以需要兜底策略
                let tailIndex = currentPaneOutput.indexOf(startPaneTail);
                let matchedTailLen = startPaneTail.length;

                if (tailIndex === -1 && startPaneTail) {
                    // 兜底：缩短 tail（8KB → 4KB → ...），尽量找到一个稳定锚点
                    const shrinkResult = findTailIndexByShrinking(currentPaneOutput, startPaneTail);
                    if (shrinkResult) {
                        tailIndex = shrinkResult.index;
                        matchedTailLen = shrinkResult.matchedTailLen;
                    }
                }

                if (tailIndex === -1) {
                    // 诊断日志：记录关键信息而不泄露内容
                    const lastPromptLine = findLastPromptLine(currentPaneOutput);
                    logger.warn(`[Responder ${groupName}] marker/baseline 均未命中，继续等待`, {
                        module: "responder",
                        groupName,
                        runnerOld,
                        baselineTailSha,
                        baselineTailLen: startPaneTail.length,
                        currentPaneLen: currentPaneOutput.length,
                        lastPromptLine: lastPromptLine?.slice(0, 50),
                    });

                    if (hasResponse && currentText.length > 0) {
                        stableCount++;
                        if (stableCount >= STABLE_COUNT) {
                            logger.info(`[Responder ${groupName}] 稳定计数达标（fallback），返回`, {
                                module: "responder",
                                groupName,
                                stableCount,
                                runnerOld,
                            });
                            const cleanedText = removeUserEcho(currentText, promptForEchoRemoval);
                            return {
                                success: true,
                                response: formatResponse(cleanedText)
                            };
                        }
                    }
                    continue;
                }

                // 提取 tail 之后的新增内容
                const rawNewContent = currentPaneOutput.slice(tailIndex + matchedTailLen);
                newText = cleanClaudeOutput(rawNewContent);
                const hasAssistantOutput = rawNewContent.includes("⏺");

                // 检测是否完成：当前 pane 的最后一行是提示符
                const currentPaneLines = currentPaneOutput.split("\n");
                // Claude Code 底部可能还有 UI 状态行（如 bypass permissions），不能只看最后一行
                const tailLines = currentPaneLines.slice(-15).map(l => (l ?? "").trim());
                const hasPrompt = tailLines.some(l => /^[›❯]\s*$/.test(l));
                if (hasPrompt && (newText.length > 0 || currentText.length > 0)) {
                    isComplete = true;
                }
                if (hasPrompt && hasAssistantOutput && newText.length === 0 && currentText.length === 0) {
                    if (promptButNoOutputSince === null) {
                        promptButNoOutputSince = Date.now();
                    }
                } else {
                    promptButNoOutputSince = null;
                }

                // rolling tail：以当前 pane 的末尾作为下一轮锚点，避免输出较长时“初始锚点滚屏丢失”
                startPaneTail = currentPaneOutput.slice(-BASELINE_TAIL_SIZE);
            }
        }

        logger.debug(
            `[Responder ${groupName}] 新增 ${newText.length} 字符, 完成: ${isComplete}, 稳定: ${stableCount}/${STABLE_COUNT}`,
            { module: "responder", groupName, newChars: newText.length, isComplete, stableCount, runnerOld }
        );

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
                const cleanedText = removeUserEcho(currentText, promptForEchoRemoval);
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
                    logger.info(`[Responder ${groupName}] 稳定计数达标，返回`, { module: "responder", groupName, stableCount, runnerOld });
                    const cleanedText = removeUserEcho(currentText, promptForEchoRemoval);
                    return {
                        success: true,
                        response: formatResponse(cleanedText)
                    };
                }
            }
        }

        // P0 防卡死：如果连续看到 prompt 但始终抓不到任何输出，提前退出，避免 perChatQueue 被占满
        if (!isCoderCLI && promptButNoOutputSince !== null) {
            const elapsed = Date.now() - promptButNoOutputSince;
            if (elapsed > 2000) {
                logger.warn(`[Responder ${groupName}] prompt 已出现但无输出，提前退出`, {
                    module: "responder",
                    groupName,
                    runnerOld,
                    elapsedMs: elapsed,
                });
                return {
                    success: false,
                    error: "Claude 已返回提示符，但未捕获到可发送的输出。请重试一次；如仍复现，发送 /snapshot 查看 tmux 内容。",
                };
            }
        }
    }

    // 5. 超时处理
    if (hasResponse && currentText.length > 0) {
        const cleanedText = removeUserEcho(currentText, promptForEchoRemoval);
        return {
            success: true,
            incomplete: true,
            response: formatResponse(cleanedText) + "\n\n... (超时，可能未完成)"
        };
    }

    const runnerName = runnerOld === "codex" ? "Codex" : (runnerOld === "claude-code" ? "Claude Code" : "Claude");
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

/**
 * Claude 输出清理（适配 Claude/Claude Code）
 *
 * - 移除输出标记（如 "⏺"）
 * - 移除提示符行（› / ❯）
 * - 移除分隔线
 * - 保留非空内容
 */
function cleanClaudeOutput(raw: string): string {
    // Claude Code 会在输出中混入“状态前缀”（不属于答案），例如：
    // ✽ Seasoning… / ✶ Flummoxing… / · Unravelling…
    // 有时状态前缀会和答案连在同一行：✽ Seasoning…7+8等于15。
    const spinnerPrefix = /^[^\p{L}\p{N}\s]{1,3}\s*[A-Za-z][A-Za-z\s-]{1,40}…\s*/u;

    const lines = raw.split("\n");
    let inWelcomePanel = false;

    const cleanedLines = lines
        .map(l => l.trimEnd())
        .filter(l => {
            let cleaned = l.trim();
            cleaned = cleaned.replace(/^⏺\s*/, "").trim();

            // Claude Code 启动欢迎面板（ASCII box）不是答案：整块丢弃。
            // 典型：
            // ╭─── Claude Code vX.Y.Z ───╮
            // │ ... Tips for getting started ... │
            // ╰──────────────────────────╯
            if (cleaned.startsWith("╭─── Claude Code v")) {
                inWelcomePanel = true;
                return false;
            }
            if (inWelcomePanel) {
                if (cleaned.startsWith("╰") && cleaned.includes("╯")) {
                    inWelcomePanel = false;
                }
                return false;
            }

            // 欢迎面板后的提示（非答案）
            if (/^\/model\s+to\s+try\b/i.test(cleaned)) return false;

            if (/^[›❯]/.test(cleaned)) return false;
            if (/^─+$/.test(cleaned)) return false;
            // Claude Code UI 状态行（非答案）
            // 例：· Unravelling… / ✳ Kneading… / bypass permissions on ...
            if (/running stop hook/i.test(cleaned)) return false;
            if (/^⏵⏵\s*bypass permissions on\b/i.test(cleaned)) return false;
            // 常见“转轮”状态：符号 + 英文单词 + …（整行都是状态）
            if (spinnerPrefix.test(cleaned) && cleaned.replace(spinnerPrefix, "").trim().length === 0) return false;
            if (/^(?:[·•✳✶*]\s*)?(?:Kneading|Unravelling|Thinking|Compacting|Processing|Searching|Flummoxing)[^\\n]*…$/.test(cleaned)) return false;
            return cleaned.length > 0;
        })
        .map(l => {
            let cleaned = l.replace(/^⏺\s*/, "").trim();
            // 状态前缀剥离：✽ Seasoning…答案 → 只保留“答案”
            cleaned = cleaned.replace(spinnerPrefix, "").trim();
            cleaned = cleaned.replace(/^\(thinking\)\s*/i, "").trim();
            return cleaned;
        })
        .filter(Boolean);

    return cleanedLines.join("\n");
}

/**
 * baseline tail 精确匹配失败时的兜底：逐步缩短 tail 并尝试匹配
 *
 * 典型原因：
 * - tmux pane resize 导致换行重排
 * - 输出较多导致滚屏，初始 tail 不在最近 capture 的窗口内
 */
function findTailIndexByShrinking(currentPaneOutput: string, startPaneTail: string): { index: number; matchedTailLen: number } | null {
    const sizes = [4096, 2048, 1024, 512, 256, 128, 64];
    for (const size of sizes) {
        if (startPaneTail.length <= size) {
            continue;
        }
        const tail = startPaneTail.slice(-size);
        const idx = currentPaneOutput.indexOf(tail);
        if (idx !== -1) {
            return { index: idx, matchedTailLen: tail.length };
        }
    }
    return null;
}

/**
 * 兜底：用用户输入 marker 定位最后一次输入行，然后取其后内容
 *
 * 关键：只取“输入行之后、下一次提示符之前”的内容，避免把下一次远程上下文/用户输入带进输出。
 */
function extractAfterLastMarkerLine(
    currentPaneOutput: string,
    marker: string
): { rawAfterMarker: string; hasPromptAfter: boolean; hasAssistantOutput: boolean } | null {
    if (!marker) return null;
    const lines = currentPaneOutput.split("\n");
    let idx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = normalizeForMarker(lines[i] ?? "");
        if (line.includes(marker) && hasPromptNearInput(lines, i)) {
            idx = i;
            break;
        }
    }
    if (idx === -1) return null;
    const collected: string[] = [];
    let hasPromptAfter = false;
    let hasAssistantOutput = false;
    for (let j = idx + 1; j < lines.length; j++) {
        const trimmed = (lines[j] ?? "").trim();
        if (/^[›❯]/.test(trimmed)) {
            hasPromptAfter = true;
            break;
        }
        if (/^⏺\s*/.test(trimmed)) {
            hasAssistantOutput = true;
        }
        collected.push(lines[j] ?? "");
    }
    return { rawAfterMarker: collected.join("\n"), hasPromptAfter, hasAssistantOutput };
}

function normalizeForMarker(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function hasPromptNearInput(lines: string[], inputLineIndex: number): boolean {
    // prompt 和输入在同一行（❯ foo）时也算“靠近”
    const self = (lines[inputLineIndex] ?? "").trim();
    if (/^[›❯]/.test(self)) return true;

    // Claude Code 常见两种输入块：
    // 1) ❯ user text   （prompt+输入同一行）
    // 2) ❯ 【远程上下文…】(多行)
    //      ...
    //      user text   （prompt 在上方较远处）
    //
    // 因此：向上找“最近的 prompt 行”，允许跨越若干行（如远程提示块）。
    const maxLookback = 40;
    for (let k = 1; k <= maxLookback; k++) {
        const idx = inputLineIndex - k;
        if (idx < 0) break;
        const t = (lines[idx] ?? "").trim();
        if (!t) continue;
        if (/^[›❯]/.test(t)) return true;
    }
    return false;
}

function getMarkerLineFromUserMessage(userMessage: string): string {
    const lines = userMessage
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return normalizeForMarker(userMessage).slice(0, 30);
    }
    // 用“最后一行”定位（在 tmux UI 中通常是独立一行，不容易跨行）
    return normalizeForMarker(lines[lines.length - 1] ?? "").slice(0, 60);
}

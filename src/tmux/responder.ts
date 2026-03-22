/**
 * msgcode: 请求-响应模式的 Claude/Codex 交互（T2/T3: 支持 Codex）
 *
 * 发送消息到 Claude/Codex 并同步等待回复
 */

import { TmuxSession, type RunnerType, type RunnerTypeOld } from "./session.js";
import { SessionStatus } from "./session.js";
import { CodexOutputReader } from "../output/codex-reader.js";
import { CodexParser } from "../output/codex-parser.js";
import { OutputReader } from "../output/reader.js";
import { AssistantParser } from "../output/parser.js";
import { logger } from "../logger/index.js";
import { sendAttachmentsToSession } from "./sender.js";
import { withRemoteHintIfNeeded } from "./remote_hint.js";
import type { Attachment } from "../channels/types.js";
import { setTimeout as sleep } from "node:timers/promises";
import { promises as fs } from "node:fs";

interface ResponderRuntimeDeps {
    tmuxSession: typeof TmuxSession;
    sessionStatus: typeof SessionStatus;
    createCodexReader: () => CodexOutputReader;
    createOutputReader: () => OutputReader;
    sendAttachments: typeof sendAttachmentsToSession;
}

const responderRuntimeDeps: ResponderRuntimeDeps = {
    tmuxSession: TmuxSession,
    sessionStatus: SessionStatus,
    createCodexReader: () => new CodexOutputReader(),
    createOutputReader: () => new OutputReader(),
    sendAttachments: sendAttachmentsToSession,
};

const defaultResponderRuntimeDeps: ResponderRuntimeDeps = {
    ...responderRuntimeDeps,
};

export function __setResponderTestDeps(overrides: Partial<ResponderRuntimeDeps>): void {
    if (overrides.tmuxSession) responderRuntimeDeps.tmuxSession = overrides.tmuxSession;
    if (overrides.sessionStatus) responderRuntimeDeps.sessionStatus = overrides.sessionStatus;
    if (overrides.createCodexReader) responderRuntimeDeps.createCodexReader = overrides.createCodexReader;
    if (overrides.createOutputReader) responderRuntimeDeps.createOutputReader = overrides.createOutputReader;
    if (overrides.sendAttachments) responderRuntimeDeps.sendAttachments = overrides.sendAttachments;
}

export function __resetResponderTestDeps(): void {
    responderRuntimeDeps.tmuxSession = defaultResponderRuntimeDeps.tmuxSession;
    responderRuntimeDeps.sessionStatus = defaultResponderRuntimeDeps.sessionStatus;
    responderRuntimeDeps.createCodexReader = defaultResponderRuntimeDeps.createCodexReader;
    responderRuntimeDeps.createOutputReader = defaultResponderRuntimeDeps.createOutputReader;
    responderRuntimeDeps.sendAttachments = defaultResponderRuntimeDeps.sendAttachments;
}

// ============================================
// 读取模式（三态）
// ============================================

// 读取模式：codex_jsonl | claude_jsonl | pane
type ReadMode = "codex_jsonl" | "claude_jsonl" | "pane";

/**
 * 轮询配置（参考 Matcode）
 */
const FAST_INTERVAL = 300;      // 首次交付前
const SLOW_INTERVAL = 3000;     // 首次交付后
const MAX_WAIT_MS_CLAUDE = 300000; // Claude 默认最大等待 5 分钟
const MAX_WAIT_MS_CODEX = 600000;  // Codex 偶尔会更慢，默认给到 10 分钟避免误判超时
const STABLE_COUNT = 3;         // 稳定计数（连续 N 次无变化视为完成）
const CODEX_JSONL_READY_WAIT_MS = 15000;
const CODEX_JSONL_READY_POLL_MS = 500;

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

interface ReadSetup {
    readMode: ReadMode;
    coderReader: CodexOutputReader | null;
    claudeReader: OutputReader | null;
    coderJsonlPath: string | null;
    claudeJsonlPath: string | null;
    claudeJsonlSelectionInfo: import("../output/reader.js").ReadResult["selectionInfo"] | null;
}

interface BaselineState {
    startOffset: number;
    startPaneTail: string;
    baselineTailSha: string;
}

interface PollState {
    pollInterval: number;
    hasResponse: boolean;
    currentText: string;
    stableCount: number;
    startTime: number;
    promptButNoOutputSince: number | null;
    hasRepath: boolean;
    lastTextChangeTime: number;
    lastOffset: number;
    seenStopHookSummary: boolean;
    startPaneTail: string;
}

interface ReadChunkResult {
    newText: string;
    isComplete: boolean;
    earlyResult?: ResponseResult;
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

async function waitForCodexJsonlPath(
    reader: CodexOutputReader,
    projectDir: string,
    maxWaitMs: number,
    signal?: AbortSignal,
): Promise<string | null> {
    const deadline = Date.now() + Math.min(CODEX_JSONL_READY_WAIT_MS, maxWaitMs);

    while (Date.now() < deadline) {
        if (signal?.aborted) {
            return null;
        }
        const filePath = await reader.findLatestJsonlForWorkspace(projectDir);
        if (filePath) {
            return filePath;
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            break;
        }
        await sleepMs(Math.min(CODEX_JSONL_READY_POLL_MS, remainingMs), signal);
    }

    return null;
}

function createSuccessResponse(text: string, promptForEchoRemoval: string): ResponseResult {
    const cleanedText = removeUserEcho(text, promptForEchoRemoval);
    return {
        success: true,
        response: formatResponse(cleanedText),
    };
}

function createIncompleteResponse(text: string, promptForEchoRemoval: string): ResponseResult {
    const cleanedText = removeUserEcho(text, promptForEchoRemoval);
    return {
        success: true,
        incomplete: true,
        response: formatResponse(cleanedText) + "\n\n... (超时，可能未完成)",
    };
}

async function resolveReadSetup(
    groupName: string,
    runnerOld: RunnerTypeOld,
    options: ResponseOptions,
    timeout: number,
    signal?: AbortSignal,
): Promise<ReadSetup> {
    let readMode: ReadMode = "pane";
    let coderReader: CodexOutputReader | null = null;
    let claudeReader: OutputReader | null = null;
    let coderJsonlPath: string | null = null;
    let claudeJsonlPath: string | null = null;
    let claudeJsonlSelectionInfo: import("../output/reader.js").ReadResult["selectionInfo"] | null = null;

    if (runnerOld === "codex") {
        coderReader = responderRuntimeDeps.createCodexReader();
        if (options.projectDir) {
            coderJsonlPath = await waitForCodexJsonlPath(coderReader, options.projectDir, timeout, signal);
        }
        if (coderJsonlPath) {
            readMode = "codex_jsonl";
        } else {
            logger.warn(`[Responder ${groupName}] 未找到 Codex JSONL，fallback 到 pane 读屏`, {
                module: "responder",
                groupName,
                runnerOld,
                readMode,
                projectDir: options.projectDir,
            });
        }
    } else if (runnerOld === "claude-code") {
        claudeReader = responderRuntimeDeps.createOutputReader();
        if (options.projectDir) {
            const initResult = await claudeReader.readProject(options.projectDir);
            if (initResult.selectionInfo) {
                claudeJsonlPath = initResult.selectionInfo.path;
                claudeJsonlSelectionInfo = initResult.selectionInfo;
            }
        }
        if (claudeJsonlPath) {
            readMode = "claude_jsonl";
        } else {
            logger.warn(`[Responder ${groupName}] 未找到 Claude Code JSONL，fallback 到 pane 读屏`, {
                module: "responder",
                groupName,
                runnerOld,
                readMode,
                projectDir: options.projectDir,
            });
        }
    }

    logger.info(`[Responder ${groupName}] 读取模式: ${readMode}`, {
        module: "responder",
        groupName,
        runnerOld,
        readMode,
        codexJsonlPath: coderJsonlPath ?? "(none)",
        claudeJsonlPath: claudeJsonlPath ?? "(none)",
    });

    return {
        readMode,
        coderReader,
        claudeReader,
        coderJsonlPath,
        claudeJsonlPath,
        claudeJsonlSelectionInfo,
    };
}

async function captureReadBaseline(
    tmuxSession: typeof TmuxSession,
    sessionName: string,
    readSetup: ReadSetup,
): Promise<BaselineState> {
    const BASELINE_TAIL_SIZE = 8192;
    let startOffset = 0;
    let startPaneTail = "";

    if (readSetup.readMode === "codex_jsonl") {
        startOffset = await readSetup.coderReader!.seekToEnd(readSetup.coderJsonlPath!);
    } else if (readSetup.readMode === "claude_jsonl") {
        const stats = await fs.stat(readSetup.claudeJsonlPath!);
        startOffset = stats.size;
        readSetup.claudeReader!.setPosition(readSetup.claudeJsonlPath!, startOffset);
    } else {
        const fullPane = await tmuxSession.capturePane(sessionName, 1200);
        startPaneTail = fullPane.slice(-BASELINE_TAIL_SIZE);
    }

    const crypto = await import("node:crypto");
    const baselineTailSha = startPaneTail
        ? crypto.createHash("sha256").update(startPaneTail).digest("hex").slice(0, 8)
        : "";

    return { startOffset, startPaneTail, baselineTailSha };
}

async function sendPromptToSession(params: {
    tmuxSession: typeof TmuxSession;
    sessionName: string;
    groupName: string;
    runnerOld: RunnerTypeOld;
    readMode: ReadMode;
    promptForEchoRemoval: string;
    signal?: AbortSignal;
}): Promise<string> {
    const { tmuxSession, sessionName, groupName, runnerOld, readMode, promptForEchoRemoval, signal } = params;

    if (signal?.aborted) {
        throw new Error("__CANCELLED__");
    }

    let preparedMessage = prepareMessageForTmux(promptForEchoRemoval);
    if (readMode === "codex_jsonl") {
        preparedMessage = preparedMessage.replace(/\n+/g, " ").trim();
    }

    logger.debug(`[Responder ${groupName}] 发送消息`, { module: "responder", groupName, runnerOld, messageLen: preparedMessage.length });
    await tmuxSession.sendTextLiteral(sessionName, preparedMessage);
    await sleepMs(50, signal);
    await tmuxSession.sendEnter(sessionName);

    logger.debug(`[Responder ${groupName}] 消息已发送，开始轮询`, { module: "responder", groupName, runnerOld });
    await sleepMs(100, signal);
    if (await tmuxSession.isTextStillInInput(sessionName, preparedMessage)) {
        logger.warn(`检测到 Enter 被吞，补发一次`, { module: "responder", groupName, runnerOld });
        await tmuxSession.sendEnter(sessionName);
    }

    return preparedMessage;
}

async function readNextResponseChunk(params: {
    tmuxSession: typeof TmuxSession;
    sessionName: string;
    groupName: string;
    runnerOld: RunnerTypeOld;
    readSetup: ReadSetup;
    pollState: PollState;
    baseline: BaselineState;
    options: ResponseOptions;
    promptForEchoRemoval: string;
    delegationMarkers: { doneMarker?: string; failedMarker?: string };
    userMarkerLine: string;
}): Promise<ReadChunkResult> {
    const {
        tmuxSession,
        sessionName,
        groupName,
        runnerOld,
        readSetup,
        pollState,
        baseline,
        options,
        promptForEchoRemoval,
        delegationMarkers,
        userMarkerLine,
    } = params;

    if (readSetup.readMode === "codex_jsonl") {
        const result = await readSetup.coderReader!.read(readSetup.coderJsonlPath!);
        if (result.entries.length === 0) {
            return { newText: "", isComplete: false };
        }
        const codexEntries = result.entries as import("../output/codex-reader.js").CodexJSONLEntry[];
        const codexParseResult = CodexParser.parse(codexEntries);
        return {
            newText: CodexParser.toPlainText(codexParseResult),
            isComplete: codexParseResult.isComplete,
        };
    }

    if (readSetup.readMode === "claude_jsonl") {
        const result = await readSetup.claudeReader!.read(readSetup.claudeJsonlPath!);
        const currentOffset = readSetup.claudeReader!.getPosition(readSetup.claudeJsonlPath!);
        const hasIncrement = result.newOffset > pollState.lastOffset;
        if (hasIncrement) {
            pollState.lastOffset = result.newOffset;
            pollState.lastTextChangeTime = Date.now();
        }

        logger.info(`[Responder ${groupName}] JSONL 轮询`, {
            module: "responder",
            groupName,
            runnerOld,
            jsonlPath: readSetup.claudeJsonlPath,
            startOffset: currentOffset,
            newOffset: result.newOffset,
            entriesCount: result.entries.length,
            bytesRead: result.bytesRead,
            ...(readSetup.claudeJsonlSelectionInfo ? {
                selection: {
                    isDeliverable: readSetup.claudeJsonlSelectionInfo.isDeliverable,
                    score: readSetup.claudeJsonlSelectionInfo.score,
                    candidatesCount: readSetup.claudeJsonlSelectionInfo.candidatesCount,
                },
            } : {}),
        });

        const elapsedSinceChange = Date.now() - pollState.lastTextChangeTime;
        if (!pollState.hasRepath && elapsedSinceChange > 30000 && pollState.currentText === "" && result.entries.length === 0) {
            logger.warn(`[Responder ${groupName}] 连续 30 秒无增量且当前为空，尝试重选路`, {
                module: "responder",
                groupName,
                runnerOld,
                elapsedSinceChange,
            });
            const newPath = await readSetup.claudeReader!.findLatestJsonl(options.projectDir);
            if (newPath && newPath !== readSetup.claudeJsonlPath) {
                logger.info(`[Responder ${groupName}] 重选路成功`, {
                    module: "responder",
                    groupName,
                    oldPath: readSetup.claudeJsonlPath,
                    newPath,
                });
                const stats = await fs.stat(newPath);
                readSetup.claudeReader!.setPosition(newPath, stats.size);
                readSetup.claudeJsonlPath = newPath;
                pollState.lastOffset = stats.size;
                pollState.lastTextChangeTime = Date.now();
                pollState.hasRepath = true;
                return { newText: "", isComplete: false };
            }
            logger.warn(`[Responder ${groupName}] 重选路失败，无新文件`, {
                module: "responder",
                groupName,
            });
            pollState.hasRepath = true;
        }

        if (result.entries.length === 0) {
            return { newText: "", isComplete: false };
        }

        const parseResult = AssistantParser.parse(result.entries);
        if (parseResult.seenStopHookSummary) {
            pollState.seenStopHookSummary = true;
        }

        logger.info(`[Responder ${groupName}] JSONL 解析`, {
            module: "responder",
            groupName,
            runnerOld,
            textLen: AssistantParser.toPlainText(parseResult).length,
            isComplete: parseResult.isComplete,
            finishReason: parseResult.finishReason,
            seenStopHookSummary: parseResult.seenStopHookSummary,
        });

        return {
            newText: AssistantParser.toPlainText(parseResult),
            isComplete: parseResult.isComplete,
        };
    }

    const currentPaneOutput = await tmuxSession.capturePane(sessionName, 2000);
    if (
        (delegationMarkers.doneMarker && currentPaneOutput.includes(delegationMarkers.doneMarker)) ||
        (delegationMarkers.failedMarker && currentPaneOutput.includes(delegationMarkers.failedMarker))
    ) {
        return {
            newText: "",
            isComplete: true,
            earlyResult: createSuccessResponse(cleanClaudeOutput(currentPaneOutput), promptForEchoRemoval),
        };
    }

    const markerExtract = extractAfterLastMarkerLine(currentPaneOutput, userMarkerLine);
    if (markerExtract) {
        const newText = cleanClaudeOutput(markerExtract.rawAfterMarker);
        let isComplete = false;
        if (markerExtract.hasPromptAfter && markerExtract.hasAssistantOutput && (newText.length > 0 || pollState.currentText.length > 0)) {
            isComplete = true;
        }
        if (markerExtract.hasPromptAfter && markerExtract.hasAssistantOutput && newText.length === 0 && pollState.currentText.length === 0) {
            if (pollState.promptButNoOutputSince === null) {
                pollState.promptButNoOutputSince = Date.now();
            }
        } else {
            pollState.promptButNoOutputSince = null;
        }
        pollState.startPaneTail = currentPaneOutput.slice(-8192);
        return { newText, isComplete };
    }

    let tailIndex = currentPaneOutput.indexOf(pollState.startPaneTail);
    let matchedTailLen = pollState.startPaneTail.length;
    if (tailIndex === -1 && pollState.startPaneTail) {
        const shrinkResult = findTailIndexByShrinking(currentPaneOutput, pollState.startPaneTail);
        if (shrinkResult) {
            tailIndex = shrinkResult.index;
            matchedTailLen = shrinkResult.matchedTailLen;
        }
    }

    if (tailIndex === -1) {
        const lastPromptLine = findLastPromptLine(currentPaneOutput);
        logger.warn(`[Responder ${groupName}] marker/baseline 均未命中，继续等待`, {
            module: "responder",
            groupName,
            runnerOld,
            baselineTailSha: baseline.baselineTailSha,
            baselineTailLen: pollState.startPaneTail.length,
            currentPaneLen: currentPaneOutput.length,
            lastPromptLine: lastPromptLine?.slice(0, 50),
        });
        return { newText: "", isComplete: false };
    }

    const rawNewContent = currentPaneOutput.slice(tailIndex + matchedTailLen);
    const newText = cleanClaudeOutput(rawNewContent);
    const hasAssistantOutput = rawNewContent.includes("⏺");
    const currentPaneLines = currentPaneOutput.split("\n");
    const tailLines = currentPaneLines.slice(-15).map(l => (l ?? "").trim());
    const hasPrompt = tailLines.some(l => /^[›❯]\s*$/.test(l));
    let isComplete = false;
    if (hasPrompt && (newText.length > 0 || pollState.currentText.length > 0)) {
        isComplete = true;
    }
    if (hasPrompt && hasAssistantOutput && newText.length === 0 && pollState.currentText.length === 0) {
        if (pollState.promptButNoOutputSince === null) {
            pollState.promptButNoOutputSince = Date.now();
        }
    } else {
        pollState.promptButNoOutputSince = null;
    }
    pollState.startPaneTail = currentPaneOutput.slice(-8192);
    return { newText, isComplete };
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

function extractDelegationMarkers(message: string): { doneMarker?: string; failedMarker?: string } {
    const doneMatch = message.match(/MSGCODE_SUBAGENT_DONE [a-f0-9-]+/i);
    const failedMatch = message.match(/MSGCODE_SUBAGENT_FAILED [a-f0-9-]+/i);
    return {
        doneMarker: doneMatch?.[0],
        failedMarker: failedMatch?.[0],
    };
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
    const tmuxSession = responderRuntimeDeps.tmuxSession;
    const sessionStatus = responderRuntimeDeps.sessionStatus;
    const sessionName = tmuxSession.getSessionName(groupName);
    const promptForEchoRemoval = withRemoteHintIfNeeded(sessionName, message);
    const delegationMarkers = extractDelegationMarkers(message);
    // Claude 回读定位：优先用“用户原始消息”的末行作为 marker（更稳定，不受远程上下文多行影响）
    const userMarkerLine = getMarkerLineFromUserMessage(message);
    let sentTextForMarker = ""; // baseline-tail diff 的兜底锚点（基于真实发送到 tmux 的文本）

    // 检查会话是否存在
    const exists = await tmuxSession.exists(groupName);
    if (!exists) {
        return { success: false, error: `tmux 会话未运行，请先发送 /start` };
    }

    // 默认参数（P0: 收敛新旧类型）
    const runnerType: RunnerType = options.runnerType ?? "tmux";
    const runnerOld: RunnerTypeOld = options.runnerOld ?? "claude";

    // fail-fast：会话存在但尚未就绪时，不要把消息直接塞进输入流（会导致长时间无输出）
    // 远程手机端体验：必须快速给到"还在启动"的反馈，而不是等待 5-10 分钟超时。
    try {
        const status = await tmuxSession.getRunnerStatus(groupName, runnerType);
        if (status !== sessionStatus.Ready) {
            const runnerName = runnerOld === "codex" ? "Codex" : (runnerOld === "claude-code" ? "Claude Code" : "Claude");
            return { success: false, error: `${runnerName} 尚未就绪，请稍等后再试（/status 查看），或发送 /start 重启会话` };
        }
    } catch {
        // best-effort：status 探测失败时继续走原逻辑（避免误伤）
    }

    const timeout = options.timeout ?? (runnerOld === "codex" ? MAX_WAIT_MS_CODEX : MAX_WAIT_MS_CLAUDE);
    const fastInterval = options.fastInterval ?? FAST_INTERVAL;
    const slowInterval = options.slowInterval ?? SLOW_INTERVAL;
    const signal = options.signal;
    const readSetup = await resolveReadSetup(groupName, runnerOld, options, timeout, signal);
    const baseline = await captureReadBaseline(tmuxSession, sessionName, readSetup);
    logger.debug(`[Responder ${groupName}] 发送前状态`, {
        module: "responder",
        groupName,
        runnerOld,
        readMode: readSetup.readMode,
        coderJsonlPath: readSetup.coderJsonlPath ?? "(none)",
        claudeJsonlPath: readSetup.claudeJsonlPath ?? "(none)",
        startOffset: baseline.startOffset,
        baselineTailLen: baseline.startPaneTail.length,
        baselineTailSha: baseline.baselineTailSha,
    });

    if (readSetup.readMode !== "codex_jsonl") {
        await responderRuntimeDeps.sendAttachments(sessionName, options.attachments);
    }

    logger.debug(`[Responder ${groupName}] 准备发送消息`, { module: "responder", groupName, runnerOld });
    try {
        sentTextForMarker = await sendPromptToSession({
            tmuxSession,
            sessionName,
            groupName,
            runnerOld,
            readMode: readSetup.readMode,
            promptForEchoRemoval,
            signal,
        });
    } catch (error: any) {
        logger.error(`[Responder ${groupName}] 发送失败`, { module: "responder", groupName, runnerOld, error: error.message });
        if (signal?.aborted) {
            return { success: false, error: "__CANCELLED__" };
        }
        return { success: false, error: `发送失败: ${error.message}` };
    }

    // 4. 轮询等待回复（快慢策略 + 稳定计数）
    const pollState: PollState = {
        pollInterval: fastInterval,
        hasResponse: false,
        currentText: "",
        stableCount: 0,
        startTime: Date.now(),
        promptButNoOutputSince: null,
        hasRepath: false,
        lastTextChangeTime: Date.now(),
        lastOffset: 0,
        seenStopHookSummary: false,
        startPaneTail: baseline.startPaneTail,
    };

    logger.debug(`[Responder ${groupName}] 开始轮询`, { module: "responder", groupName, runnerOld, timeout, pollInterval: pollState.pollInterval });
    let iteration = 0;

    while (Date.now() - pollState.startTime < timeout) {
        iteration++;
        if (iteration % 10 === 0) {
            logger.debug(`[Responder ${groupName}] 轮询迭代 ${iteration}`, { module: "responder", groupName, runnerOld, iteration });
        }
        try {
            await sleepMs(pollState.pollInterval, signal);
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

        const chunk = await readNextResponseChunk({
            tmuxSession,
            sessionName,
            groupName,
            runnerOld,
            readSetup,
            pollState,
            baseline,
            options,
            promptForEchoRemoval,
            delegationMarkers,
            userMarkerLine,
        });
        if (chunk.earlyResult) {
            return chunk.earlyResult;
        }
        const { newText, isComplete } = chunk;

        logger.debug(
            `[Responder ${groupName}] 新增 ${newText.length} 字符, 完成: ${isComplete}, 稳定: ${pollState.stableCount}/${STABLE_COUNT}`,
            { module: "responder", groupName, newChars: newText.length, isComplete, stableCount: pollState.stableCount, runnerOld }
        );

        if (newText.length > 0) {
            pollState.currentText += newText;

            // 首次检测到内容后，切换到慢速轮询
            if (!pollState.hasResponse) {
                pollState.hasResponse = true;
                pollState.pollInterval = slowInterval;
            }

            // 重置稳定计数
            pollState.stableCount = 0;

            // 检测完成标志 - 完成后立即返回
            if (isComplete) {
                return createSuccessResponse(pollState.currentText, promptForEchoRemoval);
            }
        } else {
            // 无新内容，增加稳定计数
            if (pollState.hasResponse && pollState.currentText.length > 0) {
                pollState.stableCount++;
                // 连续 N 次无新内容，视为完成
                if (pollState.stableCount >= STABLE_COUNT) {
                    console.log(`[Responder ${groupName}] 稳定计数达标，返回`);
                    logger.info(`[Responder ${groupName}] 稳定计数达标，返回`, { module: "responder", groupName, stableCount: pollState.stableCount, runnerOld });
                    return createSuccessResponse(pollState.currentText, promptForEchoRemoval);
                }
            }
            if (readSetup.readMode === "claude_jsonl" && pollState.seenStopHookSummary && pollState.stableCount >= STABLE_COUNT) {
                logger.info(`[Responder ${groupName}] 检测到 stop_hook_summary，返回`, {
                    module: "responder",
                    groupName,
                    runnerOld,
                });
                return createSuccessResponse(pollState.currentText, promptForEchoRemoval);
            }
        }

        // P0 防卡死：如果连续看到 prompt 但始终抓不到任何输出，提前退出，避免 perChatQueue 被占满
        // 仅对 pane 模式生效（JSONL 模式不依赖 prompt 检测）
        if (readSetup.readMode === "pane" && pollState.promptButNoOutputSince !== null) {
            const elapsed = Date.now() - pollState.promptButNoOutputSince;
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
    if (pollState.hasResponse && pollState.currentText.length > 0) {
        return createIncompleteResponse(pollState.currentText, promptForEchoRemoval);
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

/**
 * msgcode: 统一 Context Policy（Phase 3）
 *
 * 职责：
 * - 统一 summary / recent window / task checkpoint 的上下文装配
 * - 统一 budget observation 与 compact 入口
 *
 * 约束：
 * - 只做薄 helper，不新增 manager / platform
 * - handlers 与 task 续跑都通过本文件进入同一套 policy
 */

import { estimateTotalTokens } from "../budget.js";
import { getInputBudgetFromCapabilities, resolveRuntimeCapabilities } from "../capabilities.js";
import { resolveSoulContext } from "../config/souls.js";
import { logger } from "../logger/index.js";
import {
    loadWindow,
    rewriteWindow,
    trimWindowWithResult,
    type WindowMessage,
} from "../session-window.js";
import {
    extractSummary,
    formatSummaryAsContext,
    loadSummary,
    saveSummary,
    type ChatSummary,
} from "../summary.js";
import { formatTaskCheckpointAsContext, type TaskCheckpoint } from "./task-types.js";
import type { RunSource } from "./run-types.js";
import type { SessionChannel } from "./session-key.js";

export interface ConversationContextBudget {
    maxSummaryChars: number;
    maxWindowMessages: number;
    maxWindowChars: number;
    maxTotalContextChars: number;
    maxMessageChars: number;
}

export const DEFAULT_CONVERSATION_CONTEXT_BUDGET: ConversationContextBudget = {
    maxSummaryChars: 2400,
    maxWindowMessages: 12,
    maxWindowChars: 4200,
    maxTotalContextChars: 6600,
    maxMessageChars: 1200,
};

export const CONTEXT_COMPACT_SOFT_THRESHOLD = 70;
export const CONTEXT_COMPACT_HARD_THRESHOLD = 85;
export const CONTEXT_COMPACT_KEEP_RECENT = 16;

type NormalizedContextMessage = {
    role: "user" | "assistant";
    content: string;
};

export interface AssembleAgentContextInput {
    source: Extract<RunSource, "message" | "task" | "heartbeat">;
    chatId: string;
    prompt: string;
    workspacePath?: string;
    taskGoal?: string;
    checkpoint?: TaskCheckpoint;
    agentProvider?: string;
    includeSoulContext?: boolean;
    runId?: string;
    sessionKey?: string;
    currentChannel?: SessionChannel;
    currentSpeakerId?: string;
    currentSpeakerName?: string;
    currentMessageId?: string;
    currentIsGroup?: boolean;
    currentMessageType?: string;
    primaryOwnerIds?: string[];
}

export interface AssembledAgentContext {
    prompt: string;
    windowMessages: WindowMessage[];
    summaryContext?: string;
    soulContext?: { content: string; source: string; path: string; chars: number };
    defaultActionTargetMessageId?: string;
    checkpointContext?: string;
    contextWindowTokens: number;
    contextBudget: number;
    contextUsedTokens: number;
    contextUsagePct: number;
    budgetRemaining: number;
    compactionTriggered: boolean;
    compactionReason?: string;
    postCompactUsagePct?: number;
    messageIdentityContext?: string;
    recentMessageRosterContext?: string;
    artifactRosterContext?: string;
    speakerIdentityContext?: string;
}

const RECENT_MESSAGE_ROSTER_LIMIT = 40;
const RECENT_MESSAGE_SNIPPET_CHARS = 80;
const ARTIFACT_ROSTER_LIMIT = 20;

export function clipContextText(text: string, maxChars: number): string {
    if (!text) return "";
    if (text.length <= maxChars) return text;
    if (maxChars <= 16) return text.slice(0, maxChars);
    return `${text.slice(0, maxChars - 14)}...(truncated)`;
}

/**
 * 统一对话上下文预算装配：
 * - 先给 summary 固定预算
 * - 再从最新消息往回选窗口
 * - 单条消息也有限额，避免一条超长消息吃掉整个上下文
 */
export function buildConversationContextBlocks(params: {
    summaryContext?: string;
    windowMessages?: Array<{ role: string; content?: string }>;
    budget?: Partial<ConversationContextBudget>;
}): {
    summaryText?: string;
    windowMessages: NormalizedContextMessage[];
    usedChars: number;
    budget: ConversationContextBudget;
} {
    const budget: ConversationContextBudget = {
        ...DEFAULT_CONVERSATION_CONTEXT_BUDGET,
        ...(params.budget || {}),
    };

    let remainingChars = budget.maxTotalContextChars;
    let usedChars = 0;
    let summaryText: string | undefined;

    const rawSummary = (params.summaryContext || "").trim();
    if (rawSummary && remainingChars > 0) {
        const summaryBudget = Math.min(budget.maxSummaryChars, remainingChars);
        const clippedSummary = clipContextText(rawSummary, summaryBudget).trim();
        if (clippedSummary) {
            summaryText = clippedSummary;
            remainingChars -= clippedSummary.length;
            usedChars += clippedSummary.length;
        }
    }

    const windowBudget = Math.min(budget.maxWindowChars, remainingChars);
    const sourceMessages = (params.windowMessages || []).slice(-budget.maxWindowMessages);
    const collected: NormalizedContextMessage[] = [];
    let usedWindowChars = 0;

    for (let i = sourceMessages.length - 1; i >= 0; i -= 1) {
        const msg = sourceMessages[i];
        const rawContent = (msg.content || "").trim();
        if (!rawContent) continue;

        const role: "user" | "assistant" = msg.role === "assistant" ? "assistant" : "user";
        const remainingForMessage = windowBudget - usedWindowChars - role.length - 4;
        if (remainingForMessage <= 0) break;

        const contentBudget = Math.min(budget.maxMessageChars, remainingForMessage);
        const clippedContent = clipContextText(rawContent, contentBudget).trim();
        if (!clippedContent) continue;

        collected.push({ role, content: clippedContent });
        usedWindowChars += clippedContent.length + role.length + 4;
    }

    const windowMessages = collected.reverse();
    usedChars += usedWindowChars;

    return {
        summaryText,
        windowMessages,
        usedChars,
        budget,
    };
}

export function buildDialogPromptWithContext(params: {
    prompt: string;
    summaryContext?: string;
    windowMessages?: Array<{ role: string; content?: string }>;
}): string {
    const sections: string[] = [];
    const contextBlocks = buildConversationContextBlocks({
        summaryContext: params.summaryContext,
        windowMessages: params.windowMessages,
    });

    if (contextBlocks.summaryText) {
        sections.push(`[历史对话摘要]\n${contextBlocks.summaryText}`);
    }

    if (contextBlocks.windowMessages.length > 0) {
        const lines = contextBlocks.windowMessages.map((msg) => `[${msg.role}] ${msg.content}`);
        sections.push(`[最近对话窗口]\n${lines.join("\n")}`);
    }

    sections.push(`[当前用户问题]\n${params.prompt}`);
    return sections.join("\n\n");
}

export async function assembleAgentContext(
    input: AssembleAgentContextInput
): Promise<AssembledAgentContext> {
    const provider = resolveContextAgentProvider(input.agentProvider);
    const runtimeCaps = await resolveRuntimeCapabilities({
        agentProvider: provider,
    });
    const contextWindowTokens = runtimeCaps.contextWindowTokens;
    const contextBudget = getInputBudgetFromCapabilities(runtimeCaps);
    const safeContextBudget = contextBudget > 0 ? contextBudget : 1;

    let windowMessages: WindowMessage[] = [];
    let summaryContext: string | undefined;
    let summaryData: ChatSummary | undefined;
    let soulContext: { content: string; source: string; path: string; chars: number } | undefined;

    if (input.workspacePath) {
        windowMessages = await loadWindow(input.workspacePath, input.chatId);
        summaryData = await loadSummary(input.workspacePath, input.chatId);
        summaryContext = formatSummaryAsContext(summaryData) || undefined;

        if (input.includeSoulContext) {
            soulContext = await resolveSoulContext(input.workspacePath);
        }
    }

    const contextUsedTokens = estimateTotalTokens(windowMessages, runtimeCaps.charsPerToken);
    const contextUsagePct = Math.round((contextUsedTokens / safeContextBudget) * 100);
    const budgetRemaining = contextBudget - contextUsedTokens;
    const checkpointContext = formatTaskCheckpointAsContext(input.checkpoint);
    const messageIdentityContext = buildCurrentMessageIdentityContext({
        channel: input.currentChannel,
        chatId: input.chatId,
        messageId: input.currentMessageId,
        speakerId: input.currentSpeakerId,
        speakerName: input.currentSpeakerName,
        isGroup: input.currentIsGroup,
        messageType: input.currentMessageType,
    });
    const recentMessageRosterContext = buildRecentMessageRosterContext({
        windowMessages,
        primaryOwnerIds: input.primaryOwnerIds,
    });
    const artifactRosterContext = buildArtifactRosterContext(summaryData);
    const speakerIdentityContext = buildSpeakerIdentityContext({
        channel: input.currentChannel,
        speakerId: input.currentSpeakerId,
        primaryOwnerIds: input.primaryOwnerIds,
    });
    const prompt = buildAgentPrompt({
        prompt: input.prompt,
        taskGoal: input.taskGoal,
        checkpointContext,
        messageIdentityContext,
        recentMessageRosterContext,
        artifactRosterContext,
        speakerIdentityContext,
    });

    logger.info("context budget observation", {
        module: "runtime/context-policy",
        runId: input.runId,
        sessionKey: input.sessionKey,
        source: input.source,
        chatId: input.chatId,
        contextWindowTokens,
        contextBudget,
        contextUsedTokens,
        contextUsagePct,
        budgetRemaining,
        isApproachingBudget: contextUsagePct >= CONTEXT_COMPACT_SOFT_THRESHOLD,
        contextCapsSource: runtimeCaps.source,
        contextCapsProvider: runtimeCaps.provider,
        contextCapsModel: runtimeCaps.model || "",
        charsPerToken: runtimeCaps.charsPerToken,
    });

    let compactionTriggered = false;
    let compactionReason: string | undefined;
    let postCompactUsagePct: number | undefined;

    if (input.workspacePath && contextUsagePct >= CONTEXT_COMPACT_SOFT_THRESHOLD) {
        compactionTriggered = true;
        compactionReason = `context usage ${contextUsagePct}% >= ${CONTEXT_COMPACT_SOFT_THRESHOLD}% threshold`;

        logger.info("context compaction triggered", {
            module: "runtime/context-policy",
            runId: input.runId,
            sessionKey: input.sessionKey,
            source: input.source,
            chatId: input.chatId,
            reason: compactionReason,
            preCompactUsage: contextUsagePct,
            preCompactMessages: windowMessages.length,
        });

        try {
            const trimResult = trimWindowWithResult(windowMessages, CONTEXT_COMPACT_KEEP_RECENT);

            if (trimResult.wasTrimmed && trimResult.trimmed.length > 0) {
                const newSummary = extractSummary(trimResult.trimmed, windowMessages);
                const existingSummary = await loadSummary(input.workspacePath, input.chatId);
                const mergedSummary = mergeSummary(existingSummary, newSummary);

                await saveSummary(input.workspacePath, input.chatId, mergedSummary);
                await rewriteWindow(input.workspacePath, input.chatId, trimResult.messages);

                windowMessages = trimResult.messages;
                summaryContext = formatSummaryAsContext(mergedSummary) || undefined;

                const postCompactUsed = estimateTotalTokens(windowMessages, runtimeCaps.charsPerToken);
                postCompactUsagePct = Math.round((postCompactUsed / safeContextBudget) * 100);

                logger.info("context compaction completed", {
                    module: "runtime/context-policy",
                    runId: input.runId,
                    sessionKey: input.sessionKey,
                    source: input.source,
                    chatId: input.chatId,
                    preCompactMessages: trimResult.trimmed.length + trimResult.messages.length,
                    postCompactMessages: trimResult.messages.length,
                    preCompactUsage: contextUsagePct,
                    postCompactUsage: postCompactUsagePct,
                    summaryEntries: {
                        goals: mergedSummary.goal.length,
                        constraints: mergedSummary.constraints.length,
                        decisions: mergedSummary.decisions.length,
                        openItems: mergedSummary.openItems.length,
                        toolFacts: mergedSummary.toolFacts.length,
                    },
                });

                if (postCompactUsagePct >= CONTEXT_COMPACT_HARD_THRESHOLD) {
                    logger.warn("context overflow protected", {
                        module: "runtime/context-policy",
                        runId: input.runId,
                        sessionKey: input.sessionKey,
                        source: input.source,
                        chatId: input.chatId,
                        postCompactUsage: postCompactUsagePct,
                        hardThreshold: CONTEXT_COMPACT_HARD_THRESHOLD,
                    });
                }
            }
        } catch (compactError) {
            logger.error("context compaction failed", {
                module: "runtime/context-policy",
                runId: input.runId,
                sessionKey: input.sessionKey,
                source: input.source,
                chatId: input.chatId,
                error: compactError instanceof Error ? compactError.message : String(compactError),
            });
        }
    }

    return {
        prompt,
        windowMessages,
        summaryContext,
        soulContext,
        defaultActionTargetMessageId: input.currentMessageId?.trim() || undefined,
        checkpointContext: checkpointContext || undefined,
        contextWindowTokens,
        contextBudget,
        contextUsedTokens,
        contextUsagePct,
        budgetRemaining,
        compactionTriggered,
        compactionReason,
        postCompactUsagePct,
        messageIdentityContext,
        recentMessageRosterContext,
        artifactRosterContext,
        speakerIdentityContext,
    };
}

function resolveContextAgentProvider(agentProvider?: string): string {
    const raw = (agentProvider || process.env.AGENT_BACKEND || "").trim();
    return raw || "agent-backend";
}

function buildAgentPrompt(params: {
    prompt: string;
    taskGoal?: string;
    checkpointContext?: string;
    messageIdentityContext?: string;
    recentMessageRosterContext?: string;
    artifactRosterContext?: string;
    speakerIdentityContext?: string;
}): string {
    const basePrompt = params.prompt.trim();
    const sections: string[] = [];

    if (params.messageIdentityContext) {
        sections.push(`[当前消息事实]\n${params.messageIdentityContext}`);
    }

    if (params.recentMessageRosterContext) {
        sections.push(`[最近消息索引]\n${params.recentMessageRosterContext}`);
    }

    if (params.artifactRosterContext) {
        sections.push(`[最近生成产物索引]\n${params.artifactRosterContext}`);
    }

    if (params.speakerIdentityContext) {
        sections.push(`[当前会话身份事实]\n${params.speakerIdentityContext}`);
    }

    if (!params.checkpointContext) {
        sections.push(basePrompt);
        return sections.join("\n\n");
    }

    const goal = (params.taskGoal || basePrompt).trim();
    sections.push(
        `[长期任务目标]\n${goal}\n\n${params.checkpointContext}\n\n请基于上面的任务状态继续推进，优先完成“下一步”；若已满足验收标准，则完成任务并给出可验证结果。`
    );
    return sections.join("\n\n");
}

function buildCurrentMessageIdentityContext(params: {
    channel?: SessionChannel;
    chatId: string;
    messageId?: string;
    speakerId?: string;
    speakerName?: string;
    isGroup?: boolean;
    messageType?: string;
}): string | undefined {
    const messageId = (params.messageId || "").trim();
    if (!messageId) {
        return undefined;
    }

    const lines = [
        `当前渠道: ${params.channel || "unknown"}`,
        `当前会话ID: ${params.chatId}`,
        `当前消息ID: ${messageId}`,
        `本轮默认动作目标消息ID: ${messageId}`,
    ];

    const speakerId = (params.speakerId || "").trim();
    if (speakerId) {
        lines.push(`当前消息发送者ID: ${speakerId}`);
    }

    const speakerName = (params.speakerName || "").trim();
    if (speakerName) {
        lines.push(`当前消息发送者昵称: ${speakerName}`);
    }

    if (typeof params.isGroup === "boolean") {
        lines.push(`当前是否群聊: ${params.isGroup ? "是" : "否"}`);
    }

    const messageType = (params.messageType || "").trim();
    if (messageType) {
        lines.push(`当前消息类型: ${messageType}`);
    }

    return lines.join("\n");
}

function buildRecentMessageRosterContext(params: {
    windowMessages: WindowMessage[];
    primaryOwnerIds?: string[];
}): string | undefined {
    const primaryOwnerIds = new Set((params.primaryOwnerIds || []).map((it) => it.trim()).filter(Boolean));
    const recent = params.windowMessages
        .filter((msg) => {
            const messageId = (msg.messageId || "").trim();
            const senderId = (msg.senderId || "").trim();
            const content = (msg.content || "").trim();
            return Boolean(messageId && senderId && content);
        })
        .slice(-RECENT_MESSAGE_ROSTER_LIMIT);

    if (recent.length === 0) {
        return undefined;
    }

    const lines = recent.map((msg) => {
        const messageId = (msg.messageId || "").trim();
        const senderId = (msg.senderId || "").trim();
        const senderName = (msg.senderName || "").trim();
        const snippet = clipContextText((msg.content || "").trim(), RECENT_MESSAGE_SNIPPET_CHARS).replace(/\n+/g, " ");
        const messageType = (msg.messageType || "").trim() || "text";
        const ownerTag = primaryOwnerIds.has(senderId) ? " owner=yes" : "";
        const namePart = senderName ? ` name=${senderName}` : "";
        return `- msg=${messageId} sender=${senderId}${namePart} type=${messageType}${ownerTag} text=\"${snippet}\"`;
    });

    return lines.join("\n");
}

function buildArtifactRosterContext(summary?: ChatSummary): string | undefined {
    if (!summary || summary.toolFacts.length === 0) {
        return undefined;
    }

    const pathPattern = /(?:\/[^\s;]+AIDOCS\/[^\s;]+|AIDOCS\/[^\s;]+)/g;
    const seen = new Set<string>();
    const artifacts: string[] = [];

    for (const fact of summary.toolFacts) {
        const matches = fact.match(pathPattern) || [];
        for (const match of matches) {
            const normalized = match.trim();
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            artifacts.push(normalized);
        }
    }

    if (artifacts.length === 0) {
        return undefined;
    }

    return artifacts
        .slice(-ARTIFACT_ROSTER_LIMIT)
        .map((artifactPath) => `- path=${artifactPath}`)
        .join("\n");
}

function buildSpeakerIdentityContext(params: {
    channel?: SessionChannel;
    speakerId?: string;
    primaryOwnerIds?: string[];
}): string | undefined {
    const channel = params.channel;
    const speakerId = (params.speakerId || "").trim();
    const primaryOwnerIds = (params.primaryOwnerIds || []).map((it) => it.trim()).filter(Boolean);

    if (!channel || !speakerId) {
        return undefined;
    }

    const isPrimaryOwner = primaryOwnerIds.includes(speakerId);
    const lines = [
        `当前渠道: ${channel}`,
        `当前发言人ID: ${speakerId}`,
    ];

    if (primaryOwnerIds.length > 0) {
        lines.push(`本渠道主人的ID: ${primaryOwnerIds.join(", ")}`);
        lines.push(`当前发言人是否是主人: ${isPrimaryOwner ? "是" : "否"}`);
        lines.push("若当前发言人不是主人，默认更保守，不要擅自扩展成执行型动作；若需求明确，仍可正常回答。");
    }

    return lines.join("\n");
}

function mergeSummary(existingSummary: ChatSummary, newSummary: ChatSummary): ChatSummary {
    return {
        goal: [...existingSummary.goal, ...newSummary.goal].slice(-5),
        constraints: [...existingSummary.constraints, ...newSummary.constraints].slice(-10),
        decisions: [...existingSummary.decisions, ...newSummary.decisions].slice(-10),
        openItems: [...existingSummary.openItems, ...newSummary.openItems].slice(-5),
        toolFacts: [...existingSummary.toolFacts, ...newSummary.toolFacts].slice(-10),
    };
}

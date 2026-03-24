/**
 * msgcode: thread/context token breakdown probe
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { estimateTextTokens } from "../../budget.js";
import { resolveRuntimeCapabilities } from "../../capabilities.js";
import { resolveSoulContext } from "../../config/souls.js";
import { getConflictMode } from "../../config/workspace.js";
import {
    buildConversationContextBlocks,
    buildDialogSystemPrompt,
    resolveBaseSystemPrompt,
} from "../../agent-backend/prompt.js";
import { resolveAgentBackendRuntime } from "../../agent-backend/config.js";
import { loadWindow } from "../../session-window.js";
import { formatSummaryAsContext, loadSummary } from "../../summary.js";
import type { ProbeOptions, ProbeResult } from "../types.js";

type SegmentKey =
    | "system_prompt"
    | "tool_definitions"
    | "project_context"
    | "history_dialogue"
    | "current_input";

type ContextSegment = {
    key: SegmentKey;
    status: "ok" | "unavailable";
    tokens?: number;
    ratio?: number;
    chars?: number;
    reason?: string;
};

export async function probeContext(options?: ProbeOptions): Promise<ProbeResult> {
    const workspacePath = (options?.workspacePath || "").trim();
    const chatId = (options?.chatId || "").trim();
    const prompt = (options?.prompt || "").trim();
    const taskId = (options?.taskId || "").trim();
    const agentProvider = (options?.agentProvider || process.env.AGENT_BACKEND || "").trim() || "agent-backend";
    const model = (options?.model || process.env.AGENT_MODEL || "").trim() || undefined;

    if (!workspacePath && !prompt && !(options?.systemOverride || "").trim()) {
        return {
            name: "thread-context",
            status: "skip",
            message: "thread/context probe 缺少输入：至少提供 workspace、prompt 或 system override",
            fixHint: "使用 msgcode probe context --workspace <dir> --chat-id <id> --prompt \"...\"",
        };
    }

    const runtimeCaps = await resolveRuntimeCapabilities({
        agentProvider,
        model,
    });
    const charsPerToken = runtimeCaps.charsPerToken || 2;
    const backendRuntime = resolveAgentBackendRuntime(agentProvider);
    const baseSystem = await resolveBaseSystemPrompt(options?.systemOverride);
    const conflictMode = workspacePath ? await getConflictMode(workspacePath) : "full";
    const useMcp = backendRuntime.nativeApiEnabled && process.env.LMSTUDIO_ENABLE_MCP === "1" && !!workspacePath;
    const soulContext = workspacePath ? await resolveSoulContext(workspacePath) : undefined;
    const systemPrompt = buildDialogSystemPrompt(
        baseSystem,
        useMcp,
        soulContext && soulContext.source !== "none"
            ? { content: soulContext.content, source: soulContext.source }
            : undefined,
        conflictMode
    );

    const summaryContext = workspacePath && chatId
        ? formatSummaryAsContext(await loadSummary(workspacePath, chatId))
        : "";
    const windowMessages = workspacePath && chatId
        ? await loadWindow(workspacePath, chatId)
        : [];
    const workstateContext = workspacePath
        ? await loadProbeWorkstateContext(workspacePath, taskId)
        : "";
    const contextBlocks = buildConversationContextBlocks({
        summaryContext,
        windowMessages,
    });

    const projectContextParts: string[] = [];
    const workstateText = workstateContext.trim();
    if (workstateText) {
        projectContextParts.push(`[当前工作态骨架]\n${workstateText}`);
    }
    if (contextBlocks.summaryText) {
        projectContextParts.push(`[历史对话摘要]\n${contextBlocks.summaryText}`);
    }
    const projectContext = projectContextParts.join("\n\n");

    const historyDialogue = contextBlocks.windowMessages.length > 0
        ? `[最近对话窗口]\n${contextBlocks.windowMessages.map((msg) => `[${msg.role}] ${msg.content}`).join("\n")}`
        : "";
    const currentInput = prompt ? `[当前用户问题]\n${prompt}` : "";

    const segments: ContextSegment[] = [
        buildOkSegment("system_prompt", systemPrompt, charsPerToken),
        {
            key: "tool_definitions",
            status: "unavailable",
            reason: "no stable single source",
        },
        buildMaybeSegment("project_context", projectContext, charsPerToken),
        buildMaybeSegment("history_dialogue", historyDialogue, charsPerToken),
        buildMaybeSegment("current_input", currentInput, charsPerToken),
    ];

    const totalTokens = segments.reduce((sum, segment) => sum + (segment.tokens || 0), 0);
    for (const segment of segments) {
        if (segment.status === "ok") {
            segment.ratio = totalTokens > 0 ? Number(((segment.tokens || 0) / totalTokens).toFixed(3)) : 0;
        }
    }

    const availableCount = segments.filter((segment) => segment.status === "ok").length;
    const unavailableCount = segments.length - availableCount;
    const status = availableCount > 0 ? "pass" : "skip";

    return {
        name: "thread-context",
        status,
        message: status === "pass"
            ? `thread/context token breakdown: ${totalTokens} tokens, ${unavailableCount} unavailable`
            : "thread/context probe 缺少可观测片段",
        details: {
            totalTokens,
            charsPerToken,
            contextWindowTokens: runtimeCaps.contextWindowTokens,
            reservedOutputTokens: runtimeCaps.reservedOutputTokens,
            provider: runtimeCaps.provider,
            model: runtimeCaps.model || model || "",
            source: runtimeCaps.source,
            conflictMode,
            segments,
        },
        fixHint: status === "skip"
            ? "补充 --workspace/--chat-id/--prompt 后重试"
            : undefined,
    };
}

function buildOkSegment(key: SegmentKey, text: string, charsPerToken: number): ContextSegment {
    return {
        key,
        status: "ok",
        chars: text.length,
        tokens: estimateTextTokens(text, charsPerToken),
    };
}

function buildMaybeSegment(key: SegmentKey, text: string, charsPerToken: number): ContextSegment {
    const normalized = text.trim();
    if (!normalized) {
        return {
            key,
            status: "unavailable",
            reason: "no data",
        };
    }
    return buildOkSegment(key, normalized, charsPerToken);
}

async function loadProbeWorkstateContext(workspacePath: string, taskId: string): Promise<string> {
    if (!taskId) {
        return "";
    }
    const workstatePath = path.join(workspacePath, ".msgcode", "workstates", `${taskId}.md`);
    try {
        return (await readFile(workstatePath, "utf8")).trim();
    } catch {
        return "";
    }
}

/**
 * msgcode: Agent Backend Routed Chat 模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的路由聊天逻辑
 * 主实现已迁出到本文件。
 *
 * 目标：保留单一 agent 执行主链：
 * - 组织上下文
 * - 调起 agent-first tool-loop
 * - 返回真实结果
 */

import * as crypto from "node:crypto";
import { logger } from "../logger/index.js";
import type {
    AgentRoutedChatOptions,
    AgentRoutedChatResult,
} from "./types.js";
import {
    resolveAgentBackendRuntime,
    normalizeModelOverride,
} from "./config.js";
import { selectModelByDegrade, getDegradeState } from "../slo-degrade.js";
import { runAgentToolLoop } from "./tool-loop.js";

function buildToolSequence(actionJournal: AgentRoutedChatResult["actionJournal"]): string {
    return actionJournal
        .filter((entry) => entry.phase === "act")
        .map((entry) => `${entry.ok ? "ok" : "fail"}:${entry.tool}`)
        .join(" -> ");
}

// ============================================
// 主函数：runAgentRoutedChat
// ============================================

export async function runAgentRoutedChat(options: AgentRoutedChatOptions): Promise<AgentRoutedChatResult> {
    const traceId = crypto.randomUUID().slice(0, 8);
    const backendRuntime = resolveAgentBackendRuntime(options.agentProvider);

    const degradeState = getDegradeState();
    const isDegrading = degradeState.level !== "LEVEL_0";

    const workspacePath = options.workspacePath;
    let executorModel: string | undefined;
    let responderModel: string | undefined;
    let modelBindingMode: "backend-single-source" | "workspace-dual-model" = "workspace-dual-model";

    const backendPinnedModel = normalizeModelOverride(backendRuntime.model);
    if (backendPinnedModel) {
        executorModel = backendPinnedModel;
        responderModel = backendPinnedModel;
        modelBindingMode = "backend-single-source";
    }

    if (!backendPinnedModel && workspacePath) {
        try {
            const { getExecutorModel, getResponderModel } = await import("../config/workspace.js");
            executorModel = normalizeModelOverride(await getExecutorModel(workspacePath));
            responderModel = normalizeModelOverride(await getResponderModel(workspacePath));
        } catch {
            // 读取失败，使用 undefined
        }
    }

    let selectedLevel = degradeState.level;
    let selectedModel = executorModel;
    if (executorModel && responderModel) {
        const selected = selectModelByDegrade(executorModel, responderModel);
        selectedLevel = selected.level;
        selectedModel = selected.model;
    } else if (selectedLevel !== "LEVEL_0") {
        selectedModel = responderModel || executorModel;
    }

    const dialogSoulInjected = !!(options.soulContext && options.soulContext.content);
    const execSoulInjected = dialogSoulInjected;

    // P5.7-R12-T10: agent-first 改造 - 不再前置分类，直接进入统一 agent 主链
    logger.info("agent-first chat started", {
        module: "agent-backend",
        traceId,
        phase: "init",
        kernel: "agent-first",
        soulInjected: dialogSoulInjected,
        executorModel,
        responderModel,
        selectedModel,
        degradeLevel: selectedLevel,
        isDegrading,
        agentBackend: backendRuntime.id,
        modelBindingMode,
    });

    // OpenClaw 风格：默认路径直接进入 tool-loop。
    // 路由层不再替模型预判“这轮是否应该用工具”。
    const usedModel = selectedModel;
    const usedTemperature = 0;

    logger.info("agent-first tool-loop started", {
        module: "agent-backend",
        traceId,
        phase: "act",
        kernel: "exec",
        soulInjected: execSoulInjected,
        temperature: usedTemperature,
        model: usedModel,
    });

    const toolLoopResult = await runAgentToolLoop({
        prompt: options.prompt,
        system: options.system,
        workspacePath: options.workspacePath,
        windowMessages: options.windowMessages,
        summaryContext: options.summaryContext,
        soulContext: options.soulContext,
        model: usedModel,
        backendRuntime,
        traceId,
        route: "tool",
    });

    const finalRoute = toolLoopResult.toolCall !== undefined ? "tool" : "no-tool";
    const decisionSource = toolLoopResult.decisionSource ?? "model";

    logger.info("agent-first chat completed", {
        module: "agent-backend",
        traceId,
        route: finalRoute,
        phase: "complete",
        kernel: "exec",
        decisionSource,
        soulInjected: execSoulInjected,
        temperature: usedTemperature,
        model: usedModel,
        toolCallCount: toolLoopResult.actionJournal.length,
        toolName: toolLoopResult.toolCall?.name,
        toolSequence: buildToolSequence(toolLoopResult.actionJournal),
        responseLength: toolLoopResult.answer.length,
    });

    return {
        answer: toolLoopResult.answer,
        route: finalRoute,
        decisionSource,
        temperature: usedTemperature,
        toolCall: toolLoopResult.toolCall,
        actionJournal: toolLoopResult.actionJournal,
        // P5.7-R12-T8: 透传配额与续跑信息
        verifyResult: toolLoopResult.verifyResult,
        continuable: toolLoopResult.continuable,
        quotaProfile: toolLoopResult.quotaProfile,
        perTurnToolCallLimit: toolLoopResult.perTurnToolCallLimit,
        perTurnToolStepLimit: toolLoopResult.perTurnToolStepLimit,
        remainingToolCalls: toolLoopResult.remainingToolCalls,
        remainingSteps: toolLoopResult.remainingSteps,
        continuationReason: toolLoopResult.continuationReason,
    };
}

// ============================================
// 兼容别名
// ============================================

/**
 * @deprecated 请使用 runAgentRoutedChat
 */
export const runLmStudioRoutedChat = runAgentRoutedChat;

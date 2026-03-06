/**
 * msgcode: Agent Backend Routed Chat 模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的路由聊天逻辑
 * 主实现已迁出到本文件。
 *
 * 目标：保留单一 agent 执行主链，只负责少量显式分支：
 * - degrade 强制 no-tool
 * - forceComplexTool 显式 plan/act/report
 * - 默认 agent-first tool-loop
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
import { getToolsForLlm, runAgentToolLoop } from "./tool-loop.js";
import { runLmStudioChat } from "./chat.js";

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

    const { model: selectedModel, level: selectedLevel } = selectModelByDegrade(
        executorModel || "default-executor",
        responderModel || "default-responder"
    );
    const toolsAvailable = options.hasToolsAvailable ?? (
        !!workspacePath && (await getToolsForLlm(workspacePath)).length > 0
    );

    const dialogSoulInjected = !!(options.soulContext && options.soulContext.content);
    const execSoulInjected = false;

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

    // P5.7-R12-T10: 保留 degrade 模式的强制 no-tool
    if (selectedLevel === "LEVEL_2") {
        const usedModel = selectedModel;
        const usedTemperature = 0.2;

        logger.info("degrade mode: forcing no-tool", {
            module: "agent-backend",
            traceId,
            phase: "degrade",
            kernel: "dialog",
            soulInjected: dialogSoulInjected,
            degradeLevel: selectedLevel,
        });

        const answer = await runLmStudioChat({
            prompt: options.prompt,
            system: options.system,
            workspace: options.workspacePath,
            model: usedModel,
            temperature: usedTemperature,
            backendRuntime,
            windowMessages: options.windowMessages,
            summaryContext: options.summaryContext,
            soulContext: options.soulContext,
        });

        logger.info("agent-first chat completed", {
            module: "agent-backend",
            traceId,
            route: "no-tool",
            phase: "complete",
            kernel: "dialog",
            decisionSource: "degrade",
            soulInjected: dialogSoulInjected,
            temperature: usedTemperature,
            responseLength: answer.length,
            model: usedModel,
            degradeLevel: selectedLevel,
        });

        return {
            answer,
            route: "no-tool",
            decisionSource: "degrade",
            temperature: usedTemperature,
            actionJournal: [],
        };
    }

    // P5.7-R12-T10: 保留 complex-tool 的 plan/act/report 流程（需要显式标记）
    if (options.forceComplexTool) {
        const usedModel = executorModel;
        const usedTemperature = 0;

        logger.info("complex-tool pipeline started", {
            module: "agent-backend",
            traceId,
            route: "complex-tool",
            phase: "plan",
            kernel: "dialog",
            soulInjected: dialogSoulInjected,
            decisionSource: "router",
        });

        const planPrompt = `请先分析这个任务并制定执行计划，不需要执行具体操作：${options.prompt}`;
        const planResult = await runLmStudioChat({
            prompt: planPrompt,
            system: options.system,
            workspace: options.workspacePath,
            model: usedModel,
            temperature: usedTemperature,
            backendRuntime,
            windowMessages: options.windowMessages,
            summaryContext: options.summaryContext,
            soulContext: options.soulContext,
        });

        logger.info("complex-tool pipeline completed", {
            module: "agent-backend",
            traceId,
            route: "complex-tool",
            phase: "plan",
            kernel: "dialog",
            soulInjected: dialogSoulInjected,
            temperature: usedTemperature,
            model: usedModel,
            planLength: planResult.length,
        });

        logger.info("complex-tool pipeline started", {
            module: "agent-backend",
            traceId,
            route: "complex-tool",
            phase: "act",
            kernel: "exec",
            soulInjected: execSoulInjected,
        });

        const execPrompt = `${options.prompt}\n\n执行计划：${planResult}`;
        const toolLoopResult = await runAgentToolLoop({
            prompt: execPrompt,
            system: options.system,
            workspacePath: options.workspacePath,
            windowMessages: undefined,
            summaryContext: options.summaryContext,
            soulContext: undefined,
            model: usedModel,
            backendRuntime,
            traceId,
            route: "complex-tool",
        });

        logger.info("complex-tool pipeline completed", {
            module: "agent-backend",
            traceId,
            route: "complex-tool",
            phase: "act",
            kernel: "exec",
            soulInjected: execSoulInjected,
            temperature: usedTemperature,
            model: usedModel,
            toolCallCount: toolLoopResult.toolCall ? 1 : 0,
            toolName: toolLoopResult.toolCall?.name,
        });

        const summaryPrompt = `任务已完成。请总结执行结果：${toolLoopResult.answer}`;
        const summaryResult = await runLmStudioChat({
            prompt: summaryPrompt,
            system: options.system,
            workspace: options.workspacePath,
            model: usedModel,
            temperature: usedTemperature,
            backendRuntime,
            windowMessages: options.windowMessages,
            summaryContext: options.summaryContext,
            soulContext: options.soulContext,
        });

        logger.info("complex-tool pipeline completed", {
            module: "agent-backend",
            traceId,
            route: "complex-tool",
            phase: "report",
            kernel: "dialog",
            soulInjected: dialogSoulInjected,
            temperature: usedTemperature,
            model: usedModel,
            responseLength: summaryResult.length,
        });

        return {
            answer: summaryResult,
            route: "complex-tool",
            decisionSource: "router",
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

    if (!toolsAvailable) {
        const usedModel = responderModel || executorModel || selectedModel;
        const usedTemperature = options.temperature ?? 0.2;

        logger.info("agent-first chat fallback: no tools exposed", {
            module: "agent-backend",
            traceId,
            phase: "route",
            kernel: "dialog",
            decisionSource: "router",
            soulInjected: dialogSoulInjected,
            model: usedModel,
            workspacePath,
        });

        const answer = await runLmStudioChat({
            prompt: options.prompt,
            system: options.system,
            workspace: options.workspacePath,
            model: usedModel,
            temperature: usedTemperature,
            backendRuntime,
            windowMessages: options.windowMessages,
            summaryContext: options.summaryContext,
            soulContext: options.soulContext,
        });

        logger.info("agent-first chat completed", {
            module: "agent-backend",
            traceId,
            route: "no-tool",
            phase: "complete",
            kernel: "dialog",
            decisionSource: "router",
            soulInjected: dialogSoulInjected,
            temperature: usedTemperature,
            responseLength: answer.length,
            model: usedModel,
        });

        return {
            answer,
            route: "no-tool",
            decisionSource: "router",
            temperature: usedTemperature,
            actionJournal: [],
        };
    }

    // P5.7-R12-T10: 默认路径 - 直接调用 tool-loop，让模型自己决定是否调用工具
    const usedModel = executorModel;
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
        allowNoTool: true,  // 关键：允许模型自己决定是否调用工具
    });

    // P5.7-R12-T10: 根据 tool-loop 的返回结果决定最终 route
    const finalRoute = toolLoopResult.toolCall === undefined ? "no-tool" : "tool";
    const decisionSource = "model";  // 模型自己决策

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

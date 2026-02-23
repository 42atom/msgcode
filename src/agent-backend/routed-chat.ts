/**
 * msgcode: Agent Backend Routed Chat 模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的路由聊天逻辑
 * 主实现已迁出到本文件。
 *
 * 目标：分离路由编排与执行逻辑
 */

import { config } from "../config.js";
import * as crypto from "node:crypto";
import { logger } from "../logger/index.js";
import type {
    AgentRoutedChatOptions,
    AgentRoutedChatResult,
    AgentBackendRuntime,
} from "./types.js";
import {
    resolveAgentBackendRuntime,
    normalizeModelOverride,
} from "./config.js";
import {
    getTemperatureForRoute,
    parseModelRouteClassification,
    type RouteClassification,
} from "../routing/classifier.js";
import { selectModelByDegrade, isToolCallAllowed, getDegradeState } from "../slo-degrade.js";
import { resolveBaseSystemPrompt, buildDialogSystemPrompt, buildExecSystemPrompt } from "./prompt.js";
import { runAgentToolLoop } from "./tool-loop.js";

// runLmStudioChat 从 chat.ts 导入（兼容别名）
import { runLmStudioChat } from "./chat.js";

// ============================================
// 路由分类器常量
// ============================================

const ROUTE_CLASSIFIER_SYSTEM_PROMPT = [
    "你是消息路由分类器，只输出 JSON，不要输出任何额外文本。",
    "返回格式：{\"route\":\"no-tool|tool|complex-tool\",\"confidence\":\"high|medium|low\",\"reason\":\"简短原因\"}",
    "判定规则：",
    "- 纯问答/闲聊/解释 = no-tool",
    "- 需要读取文件、查看目录、执行命令、统计文件、调用工具 = tool",
    "- 只要请求涉及真实环境读取/执行（即使是疑问句，如'你能读取 xxx 吗'）= tool",
    "- 内容生成请求（生成图片、生成自拍、生成音乐、TTS 语音合成）= tool",
    "- 多步骤且需要工具（先 A 再 B、分析 + 执行 + 总结） = complex-tool",
].join("\n");

function looksLikeShellCommand(prompt: string): boolean {
    const text = (prompt || "").trim().toLowerCase();
    if (!text) return false;

    if (/[;&|]{1,2}|[<>]/.test(text)) return true;

    const commandRegex = /\b(bash|sh|zsh|pwd|ls|cat|echo|grep|find|sed|awk|curl|wget|sleep|cd|mkdir|rm|cp|mv|git|npm|pnpm|yarn|bun|node|python|uv|ps|kill|pkill|chmod|chown|tail|head)\b/;
    if (commandRegex.test(text)) return true;

    return false;
}

function isLikelyFakeToolExecutionText(text: string): boolean {
    const input = (text || "").trim();
    if (!input) return false;
    return (
        /<[\w:-]*tool_call[\w:-]*>/i.test(input) ||
        /<\/[\w:-]*tool_call>/i.test(input) ||
        /<invoke\b/i.test(input) ||
        /<\/invoke>/i.test(input) ||
        /\[\/?TOOL_CALL\]/i.test(input)
    );
}

async function classifyRouteModelFirst(params: {
    prompt: string;
    toolsAllowed: boolean;
    workspacePath?: string;
    model?: string;
    backendRuntime?: AgentBackendRuntime;
    windowMessages?: Array<{ role: string; content?: string }>;
    summaryContext?: string;
}): Promise<{ classification: RouteClassification; source: "model" | "model-fallback" }> {
    if (!params.toolsAllowed) {
        return {
            classification: {
                route: "no-tool",
                confidence: "high",
                reason: "无可用工具",
            },
            source: "model-fallback",
        };
    }

    if (looksLikeShellCommand(params.prompt)) {
        return {
            classification: {
                route: "tool",
                confidence: "high",
                reason: "命令形态匹配",
            },
            source: "model-fallback",
        };
    }

    const classifierPrompt = [
        "请判断以下用户请求应走哪条路由：",
        params.prompt,
        "",
        "只返回 JSON，不要解释。",
    ].join("\n");

    try {
        const raw = await runLmStudioChat({
            prompt: classifierPrompt,
            system: ROUTE_CLASSIFIER_SYSTEM_PROMPT,
            workspace: params.workspacePath,
            model: params.model,
            temperature: 0,
            backendRuntime: params.backendRuntime,
            windowMessages: params.windowMessages,
            summaryContext: params.summaryContext,
            soulContext: undefined,
        });

        const parsed = parseModelRouteClassification(raw);
        if (!parsed) {
            return {
                classification: {
                    route: "no-tool",
                    confidence: "low",
                    reason: "模型分类输出无效",
                },
                source: "model-fallback",
            };
        }

        return { classification: parsed, source: "model" };
    } catch {
        return {
            classification: {
                route: "no-tool",
                confidence: "low",
                reason: "模型分类调用失败",
            },
            source: "model-fallback",
        };
    }
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

    const hasTools = options.hasToolsAvailable ?? true;
    const toolsAllowed = hasTools && isToolCallAllowed();
    const classifier = await classifyRouteModelFirst({
        prompt: options.prompt,
        toolsAllowed,
        workspacePath,
        model: responderModel,
        backendRuntime,
        windowMessages: options.windowMessages,
        summaryContext: options.summaryContext,
    });
    const classification = classifier.classification;
    const route = classification.route;

    const temperature = options.temperature ?? getTemperatureForRoute(route);

    const { model: selectedModel, level: selectedLevel } = selectModelByDegrade(
        executorModel || "default-executor",
        responderModel || "default-responder"
    );

    const dialogSoulInjected = !!(options.soulContext && options.soulContext.content);
    const execSoulInjected = false;

    logger.info("routed chat started", {
        module: "agent-backend",
        traceId,
        route,
        phase: "init",
        kernel: "router",
        soulInjected: dialogSoulInjected,
        classificationSource: classifier.source,
        confidence: classification.confidence,
        reason: classification.reason,
        temperature,
        executorModel,
        responderModel,
        selectedModel,
        degradeLevel: selectedLevel,
        isDegrading,
        agentBackend: backendRuntime.id,
        modelBindingMode,
    });

    if (route === "no-tool" || selectedLevel === "LEVEL_2") {
        const usedModel = selectedLevel === "LEVEL_2" ? selectedModel : responderModel;
        const usedTemperature = selectedLevel === "LEVEL_2" ? 0.2 : 0.2;

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

        const leakedToolIntent =
            toolsAllowed &&
            selectedLevel === "LEVEL_0" &&
            isLikelyFakeToolExecutionText(answer);

        if (leakedToolIntent) {
            logger.warn("no-tool response contained fake tool-call marker, rerouting to tool loop", {
                module: "agent-backend",
                traceId,
                route: "no-tool",
                phase: "recover",
                kernel: "router",
                soulInjected: execSoulInjected,
                agentBackend: backendRuntime.id,
            });

            const recoveredToolLoop = await runAgentToolLoop({
                prompt: options.prompt,
                system: options.system,
                workspacePath: options.workspacePath,
                windowMessages: undefined,
                summaryContext: options.summaryContext,
                soulContext: undefined,
                model: executorModel,
                backendRuntime,
                traceId,
                route: "tool",
            });

            logger.info("routed chat completed", {
                module: "agent-backend",
                traceId,
                route: "tool(recovered)",
                phase: "complete",
                kernel: "exec",
                soulInjected: execSoulInjected,
                temperature: 0,
                responseLength: recoveredToolLoop.answer.length,
                model: executorModel,
                degradeLevel: selectedLevel,
            });

            return {
                answer: recoveredToolLoop.answer,
                route: "tool",
                temperature: 0,
                toolCall: recoveredToolLoop.toolCall,
                actionJournal: recoveredToolLoop.actionJournal,
            };
        }

        logger.info("routed chat completed", {
            module: "agent-backend",
            traceId,
            route: selectedLevel === "LEVEL_2" ? "no-tool(degraded)" : route,
            phase: "complete",
            kernel: "dialog",
            soulInjected: dialogSoulInjected,
            temperature: usedTemperature,
            responseLength: answer.length,
            model: usedModel,
            degradeLevel: selectedLevel,
        });

        return {
            answer,
            route: selectedLevel === "LEVEL_2" ? "no-tool" : route,
            temperature: usedTemperature,
            actionJournal: [],
        };
    }

    if (route === "complex-tool") {
        if (selectedLevel !== "LEVEL_0") {
            logger.warn("complex-tool request but in degrade mode, skipping tool execution", {
                module: "agent-backend",
                traceId,
                route,
                phase: "degrade",
                kernel: "router",
                soulInjected: dialogSoulInjected,
                degradeLevel: selectedLevel,
            });

            const fallbackPrompt = `请直接用自然语言回答这个问题（当前处于安全模式，无法执行工具）：${options.prompt}`;
            const answer = await runLmStudioChat({
                prompt: fallbackPrompt,
                system: options.system,
                workspace: options.workspacePath,
                model: selectedModel,
                temperature: 0.2,
                backendRuntime,
                windowMessages: options.windowMessages,
                summaryContext: options.summaryContext,
                soulContext: options.soulContext,
            });

            return {
                answer,
                route: "no-tool",
                temperature: 0.2,
                actionJournal: [],
            };
        }

        const usedModel = executorModel;
        const usedTemperature = 0;

        logger.info("pipeline phase started", {
            module: "agent-backend",
            traceId,
            route: "complex-tool",
            phase: "plan",
            kernel: "dialog",
            soulInjected: dialogSoulInjected,
            status: "processing",
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

        logger.info("pipeline phase completed", {
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

        logger.info("pipeline phase started", {
            module: "agent-backend",
            traceId,
            route: "complex-tool",
            phase: "act",
            kernel: "exec",
            soulInjected: execSoulInjected,
            status: "processing",
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

        logger.info("pipeline phase completed", {
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

        logger.info("pipeline phase completed", {
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
            temperature: usedTemperature,
            toolCall: toolLoopResult.toolCall,
            actionJournal: toolLoopResult.actionJournal,
        };
    }

    if (selectedLevel !== "LEVEL_0") {
        logger.warn("tool request but in degrade mode, skipping tool execution", {
            module: "agent-backend",
            traceId,
            route,
            phase: "degrade",
            kernel: "router",
            soulInjected: dialogSoulInjected,
            degradeLevel: selectedLevel,
        });

        const fallbackPrompt = `请直接用自然语言回答这个问题（当前处于安全模式，无法执行工具）：${options.prompt}`;
        const answer = await runLmStudioChat({
            prompt: fallbackPrompt,
            system: options.system,
            workspace: options.workspacePath,
            model: selectedModel,
            temperature: 0.2,
            backendRuntime,
            windowMessages: options.windowMessages,
            summaryContext: options.summaryContext,
            soulContext: options.soulContext,
        });

        return {
            answer,
            route: "no-tool",
            temperature: 0.2,
            actionJournal: [],
        };
    }

    const usedModel = executorModel;
    const usedTemperature = 0;

    logger.info("pipeline phase started", {
        module: "agent-backend",
        traceId,
        route: "tool",
        phase: "plan",
        kernel: "router",
        soulInjected: execSoulInjected,
        temperature: usedTemperature,
        model: usedModel,
        status: "processing",
    });

    logger.info("pipeline phase started", {
        module: "agent-backend",
        traceId,
        route: "tool",
        phase: "act",
        kernel: "exec",
        soulInjected: execSoulInjected,
        status: "processing",
    });

    const toolLoopResult = await runAgentToolLoop({
        prompt: options.prompt,
        system: options.system,
        workspacePath: options.workspacePath,
        windowMessages: undefined,
        summaryContext: options.summaryContext,
        soulContext: undefined,
        model: usedModel,
        backendRuntime,
        traceId,
        route: "tool",
    });

    logger.info("pipeline phase completed", {
        module: "agent-backend",
        traceId,
        route: "tool",
        phase: "act",
        kernel: "exec",
        soulInjected: execSoulInjected,
        temperature: usedTemperature,
        model: usedModel,
        toolCallCount: toolLoopResult.toolCall ? 1 : 0,
        toolName: toolLoopResult.toolCall?.name,
    });

    logger.info("pipeline phase completed", {
        module: "agent-backend",
        traceId,
        route: "tool",
        phase: "report",
        kernel: "dialog",
        soulInjected: dialogSoulInjected,
        temperature: usedTemperature,
        model: usedModel,
        responseLength: toolLoopResult.answer.length,
    });

    return {
        answer: toolLoopResult.answer,
        route,
        temperature: usedTemperature,
        toolCall: toolLoopResult.toolCall,
        actionJournal: toolLoopResult.actionJournal,
    };
}

// ============================================
// 兼容别名
// ============================================

/**
 * @deprecated 请使用 runAgentRoutedChat
 */
export const runLmStudioRoutedChat = runAgentRoutedChat;

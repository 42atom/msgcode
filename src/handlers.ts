/**
 * msgcode: 命令处理器
 *
 * 处理不同类型 Bot 的命令
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BotType } from "./router.js";
import { runLmStudioChat, runLmStudioToolLoop, runLmStudioRoutedChat } from "./lmstudio.js";
import type { InboundMessage } from "./imsg/types.js";
import { clearTtsPrefs, getTtsPrefs, getVoiceReplyMode, setTtsPrefs, setVoiceReplyMode } from "./state/store.js";
import { logger } from "./logger/index.js";
import { loadWorkspaceConfig, getRuntimeKind, getTmuxClient, getPolicyMode } from "./config/workspace.js";
// P5.5: 关键词主触发已禁用，不再 import detectAutoSkill/runAutoSkill
// import { detectAutoSkill, normalizeSkillId, runAutoSkill, runSkill } from "./skills/auto.js";
// P5.7-R9-T2: 导入预算感知模块
import { estimateTotalTokens } from "./budget.js";
import { getInputBudget, getCapabilities } from "./capabilities.js";

// 导入 tmux 模块
import { type RunnerType } from "./tmux/session.js";
import { handleTmuxSend } from "./tmux/responder.js";

// 导入 runtime 编排器
import * as session from "./runtime/session-orchestrator.js";

// P5.6.2-R1: 导入会话窗口
import { loadWindow, appendWindow, type WindowMessage } from "./session-window.js";
import { loadSummary, formatSummaryAsContext } from "./summary.js";
import { resolveSoulContext } from "./config/souls.js";
// P5.6.13-R2: 导入线程存储
import { ensureThread, appendTurn, getThreadInfo } from "./runtime/thread-store.js";

const TMUX_STYLE_MAX_CHARS = 800;

function resolveGlobalAgentProvider(): string {
    const raw = (process.env.AGENT_BACKEND || "").trim();
    if (!raw) return "lmstudio";
    return raw;
}

function normalizeWhitespace(input: string): string {
    return input.replace(/\s+/g, " ").trim();
}

async function buildTmuxStylePreamble(
    projectDir: string | undefined,
    userText: string
): Promise<{ message: string; meta?: { styleId: string; digest8: string } }> {
    // P5.6.1-R2: Persona 全量退役，简化为直接返回用户文本
    return { message: userText };
}

/**
 * 命令处理结果
 */
export interface HandleResult {
    success: boolean;
    response?: string;
    error?: string;
    file?: { path: string } | null;
    defer?: { kind: "tts"; text: string; options?: { model?: string; voice?: string; instruct?: string; speed?: number; temperature?: number } } | null;
}

/**
 * 命令处理器接口
 */
export interface CommandHandler {
    /**
     * 处理命令
     */
    handle(message: string, context: HandlerContext): Promise<HandleResult>;
}

/**
 * 处理器上下文
 */
export interface HandlerContext {
    botType: BotType;
    chatId: string;
    groupName: string;
    projectDir?: string;
    originalMessage: InboundMessage;
    signal?: AbortSignal;
}

/**
 * 基础处理器 - 提供公共命令
 */
export abstract class BaseHandler implements CommandHandler {
    /**
     * 处理命令（模板方法）
     */
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // === 公共命令（会话管理）===
        // P5.6.1: 会话编排抽离到 session-orchestrator

        // /start - 启动 tmux 会话
        if (trimmed === "/start") {
            const result = await session.startSession({
                projectDir: context.projectDir,
                chatId: context.chatId,
                groupName: context.groupName,
            });
            return result;
        }

        // /stop - 关闭 tmux 会话
        if (trimmed === "/stop") {
            const result = await session.stopSession({
                projectDir: context.projectDir,
                chatId: context.chatId,
                groupName: context.groupName,
            });
            return result;
        }

        // /status - 查看会话状态
        if (trimmed === "/status") {
            const result = await session.getSessionStatus({
                projectDir: context.projectDir,
                chatId: context.chatId,
                groupName: context.groupName,
            });
            return result;
        }

        // /snapshot - 获取终端输出快照
        if (trimmed === "/snapshot") {
            const result = await session.getSnapshot({
                projectDir: context.projectDir,
                chatId: context.chatId,
                groupName: context.groupName,
            });
            return result;
        }

        // /esc - 发送 ESC 中断
        if (trimmed === "/esc") {
            const result = await session.sendEscapeInterrupt({
                projectDir: context.projectDir,
                chatId: context.chatId,
                groupName: context.groupName,
            });
            return result;
        }

        // /clear - 清空上下文
        if (trimmed === "/clear") {
            const result = await session.clearSession({
                projectDir: context.projectDir,
                chatId: context.chatId,
                groupName: context.groupName,
            });
            return result;
        }

        // === 非命令消息：转发给 Claude（请求-响应模式）===
        if (!trimmed.startsWith("/")) {
            // P5.5: 关键词主触发已禁用，自然语言由 LLM tool_calls 自主决策
            // const autoSkill = await tryHandleAutoSkill(trimmed, context);
            // if (autoSkill) {
            //     return autoSkill;
            // }

            const r = await session.resolveRunner(context.projectDir);
            if (r.blockedReason) return { success: false, error: r.blockedReason };
            const styled = await buildTmuxStylePreamble(context.projectDir, trimmed);
            if (styled.meta) {
                logger.debug("tmux style preamble applied", {
                    module: "handlers",
                    chatId: context.chatId,
                    runner: r.runner,
                    styleId: styled.meta.styleId,
                    digest8: styled.meta.digest8,
                });
            }
            // 收敛调用口径：传递 runnerType + runnerOld
            const runnerOld = r.runnerConfig === "codex" || r.runnerConfig === "claude-code"
                ? r.runnerConfig
                : "claude-code";  // 默认 fallback
            const result = await handleTmuxSend(
                context.groupName,
                styled.message,
                { projectDir: context.projectDir, runnerType: r.runner, runnerOld, attachments: context.originalMessage.attachments, signal: context.signal }
            );

            if (result.error) {
                return { success: false, error: result.error };
            }

            // 直接返回 Claude 的回复
            return { success: true, response: result.response || "（无回复）" };
        }

        // 委托给子类处理特定命令
        return this.handleSpecific(message, context);
    }

    /**
     * 子类实现：处理特定命令
     */
    protected abstract handleSpecific(message: string, context: HandlerContext): Promise<HandleResult>;

    /**
     * 获取帮助信息（子类可覆盖）
     */
    protected getHelp(extraCommands?: string[]): string {
        const commands = [
            "• /start - 启动 tmux 会话（按 /model 选择执行臂）",
            "• /stop - 关闭 tmux 会话",
            "• /status - 查看会话状态",
            "• /snapshot - 获取终端输出",
            "• /esc - 发送 ESC 中断",
            "• /clear - 清空上下文",
        ];
        if (extraCommands) {
            commands.push(...extraCommands);
        }
        return `📝 命令列表：\n${commands.join("\n")}`;
    }
}

/**
 * 默认处理器 - 回显消息
 */
export class DefaultHandler extends BaseHandler {
    protected async handleSpecific(message: string, context: HandlerContext): Promise<HandleResult> {
        // 处理未知命令
        return {
            success: true,
            response: `未知命令: ${message}\n${this.getHelp()}`,
        };
    }
}

/**
 * Code Bot 处理器
 */
export class CodeHandler extends BaseHandler {
    protected async handleSpecific(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // help 命令
        if (trimmed === "help" || trimmed === "帮助") {
            return {
                success: true,
                response: this.getHelp([
                    "• help / 帮助 - 显示帮助",
                ]),
            };
        }

        // 默认回复
        return {
            success: true,
            response: `Code Bot 收到: "${trimmed}"`,
        };
    }
}

/**
 * Image Bot 处理器
 */
export class ImageHandler extends BaseHandler {
    protected async handleSpecific(message: string, context: HandlerContext): Promise<HandleResult> {
        return {
            success: true,
            response: `🎨 Image Bot 收到: "${message}"`,
        };
    }
}

/**
 * File Bot 处理器
 */
export class FileHandler extends BaseHandler {
    protected async handleSpecific(message: string, context: HandlerContext): Promise<HandleResult> {
        return {
            success: true,
            response: `📁 File Bot 收到: "${message}"`,
        };
    }
}

/**
 * 运行时路由处理器
 *
 * 根据 runner 配置动态路由消息：
 * - lmstudio/llama/claude/openai → 直接调用 provider
 * - codex/claude-code → 通过 tmux session 调用
 * 仍可走 LM Studio（兼容原有行为）
 */

/**
 * 获取当前激活的 persona 内容
 *
 * @param projectDir 工作区路径
 * @returns persona 内容（Markdown 文本），如果没有激活 persona 返回 undefined
 */
// P5.6.1-R2: Persona 全量退役，此函数已删除
// async function getActivePersonaContent(...) { ... }

export class RuntimeRouterHandler implements CommandHandler {
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // P5.5: 关键词主触发已禁用，自然语言由 LLM tool_calls 自主决策
        // if (!trimmed.startsWith("/")) {
        //     const autoSkill = await tryHandleAutoSkill(trimmed, context);
        //     if (autoSkill) {
        //         return autoSkill;
        //     }
        // }

        // === 语音命令：必须在委托给 DefaultHandler 之前短路处理（P5.6.12）===
        // 这些命令在 RuntimeRouterHandler 中实现，不应被 DefaultHandler 吞掉
        if (trimmed === "/mode" ||
            trimmed === "mode" ||
            trimmed.startsWith("/mode ") ||
            trimmed.startsWith("/tts ") ||
            trimmed.startsWith("/voice ")) {
            // 获取语音模式状态（提前获取，供后续逻辑使用）
            const voiceMode = getVoiceReplyMode(context.chatId);
            const ttsPrefs = getTtsPrefs(context.chatId);

            // /mode - 查看语音模式
            if (trimmed === "/mode" || trimmed === "mode") {
                const backendEnv = (process.env.TTS_BACKEND || "").trim().toLowerCase();
                const ttsMode =
                    backendEnv === "qwen"
                        ? "strict:qwen"
                        : backendEnv === "indextts"
                            ? "strict:indextts"
                            : "fallback:qwen->indextts";
                const refAudio = (backendEnv === "qwen" || !backendEnv)
                  ? (process.env.QWEN_TTS_REF_AUDIO || "").trim()
                  : (process.env.INDEXTTS_REF_AUDIO || "").trim();
                return {
                    success: true,
                    response: [
                        `语音回复模式: ${voiceMode}`,
                        `TTS: mode=${ttsMode} normalize=${process.env.TTS_NORMALIZE_TEXT || "1"}`,
                        refAudio ? `refAudio=${refAudio}` : "",
                        ttsPrefs.instruct ? `style=${ttsPrefs.instruct}` : "",
                    ].filter(Boolean).join("\n"),
                };
            }

            // /mode voice on|off|both|audio
            if (trimmed.startsWith("/mode voice ")) {
                const arg = trimmed.slice("/mode voice ".length).trim().toLowerCase();
                const mode =
                    arg === "on" ? "both"
                  : arg === "off" ? "text"
                  : arg === "both" ? "both"
                  : arg === "audio" ? "audio"
                  : arg === "text" ? "text"
                  : null;
                if (!mode) {
                    return { success: true, response: "用法: /mode voice on|off|both|audio" };
                }
                setVoiceReplyMode(context.chatId, mode);
                return { success: true, response: `已设置语音回复模式: ${mode}` };
            }

            // /mode style <desc>
            if (trimmed.startsWith("/mode style ")) {
                const style = trimmed.slice("/mode style ".length).trim();
                if (!style) {
                    return { success: true, response: "用法: /mode style <desc>" };
                }
                setTtsPrefs(context.chatId, { instruct: style });
                return { success: true, response: `已设置语音风格: ${style}` };
            }

            // /mode style-reset
            if (trimmed === "/mode style-reset" || trimmed === "/mode style reset") {
                clearTtsPrefs(context.chatId);
                return { success: true, response: "已清空语音风格（恢复默认）" };
            }

            // /tts <text>
            if (trimmed.startsWith("/tts ")) {
                const body = trimmed.slice("/tts ".length).trim();
                const parsed = parseTtsRequest(body);
                const toSpeak = parsed.text;
                if (!toSpeak) {
                    return { success: true, response: "用法: /tts <text>" };
                }
                if (!context.projectDir) {
                    return { success: false, error: "缺少工作区路径（projectDir），无法写入 TTS 产物" };
                }
                try {
                    const { executeTool } = await import("./tools/bus.js");
                    const { randomUUID } = await import("node:crypto");

                    const result = await executeTool("tts", {
                        text: toSpeak,
                        ...(parsed.instruct && { instruct: parsed.instruct }),
                        ...(parsed.speed && { speed: parsed.speed }),
                        ...(parsed.temperature && { temperature: parsed.temperature }),
                    }, {
                        workspacePath: context.projectDir,
                        chatId: context.chatId,
                        source: "slash-command",
                        requestId: randomUUID(),
                    });

                    if (!result.ok) {
                        const errorMsg = result.error?.code === "TOOL_NOT_ALLOWED"
                            ? "TTS 工具未被允许"
                            : result.error?.message || "TTS 失败";
                        return { success: false, error: errorMsg };
                    }

                    if (!result.data?.audioPath) {
                        return { success: false, error: "TTS 未返回音频文件路径" };
                    }

                    return { success: true, response: "已生成语音", file: { path: result.data.audioPath } };
                } catch (e) {
                    return { success: false, error: e instanceof Error ? e.message : String(e) };
                }
            }

            // /voice <question>
            if (trimmed.startsWith("/voice ")) {
                const question = trimmed.slice("/voice ".length).trim();
                if (!question) {
                    return { success: true, response: "用法: /voice <question>" };
                }
                if (!context.projectDir) {
                    return { success: false, error: "缺少工作区路径（projectDir），无法写入 TTS 产物" };
                }
                try {
                    const useMcp = process.env.LMSTUDIO_ENABLE_MCP === "1";
                    const personaContent = undefined;
                    const answer = await runLmStudioChat({
                        prompt: question,
                        system: personaContent,
                        ...(useMcp && context.projectDir ? { workspace: context.projectDir } : {}),
                    });
                    const cleanAnswer = (answer || "").trim();
                    if (!cleanAnswer) {
                        return { success: false, error: "LM Studio 未返回可展示的文本" };
                    }
                    const { executeTool } = await import("./tools/bus.js");
                    const { randomUUID } = await import("node:crypto");

                    const tts = await executeTool("tts", {
                        text: cleanAnswer,
                    }, {
                        workspacePath: context.projectDir,
                        chatId: context.chatId,
                        source: "slash-command",
                        requestId: randomUUID(),
                    });

                    if (!tts.ok || !tts.data?.audioPath) {
                        return { success: true, response: cleanAnswer };
                    }
                    return { success: true, response: cleanAnswer, file: { path: tts.data.audioPath } };
                } catch (e) {
                    return { success: false, error: e instanceof Error ? e.message : String(e) };
                }
            }
        }

        // === slash 命令：委托给 DefaultHandler（使用 BaseHandler 的统一逻辑）===
        if (trimmed.startsWith("/")) {
            return new DefaultHandler().handle(message, context);
        }

        // === 非 slash 命令：消息路由（先 kind 再 provider/client）===
        // P5.6.14-R2: 顶层只按 runtime.kind 分流
        if (context.projectDir) {
            try {
                const kind = await getRuntimeKind(context.projectDir);
                const client = await getTmuxClient(context.projectDir);
                const mode = await getPolicyMode(context.projectDir);

                // tmux 透传链路
                // P5.6.14-R3: tmux 永远不做注入
                if (kind === "tmux") {
                    // local-only 时拒绝 tmux（需要外网访问）
                    if (mode === "local-only") {
                        return {
                            success: false,
                            error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                        };
                    }

                    const styled = await buildTmuxStylePreamble(context.projectDir, trimmed);
                    if (styled.meta) {
                        logger.debug("tmux style preamble applied", {
                            module: "handlers",
                            chatId: context.chatId,
                            runtimeKind: kind,
                            tmuxClient: client,
                            styleId: styled.meta.styleId,
                            digest8: styled.meta.digest8,
                            // P5.6.14-R3: 注入职责硬边界
                            injectionEnabled: false, // tmux 永远不注入
                        });
                    }

                    // T2: 使用 tmux send-keys 发送消息到 tmux 会话
                    const { handleTmuxSend } = await import("./tmux/responder.js");
                    const result = await handleTmuxSend(
                        context.groupName,
                        styled.message,
                        {
                            projectDir: context.projectDir,
                            runnerType: "tmux",
                            runnerOld: client === "none" ? "codex" : client,
                            attachments: context.originalMessage.attachments,
                        }
                    );

                    if (result.error) {
                        return { success: false, error: result.error };
                    }

                    logger.info("tmux request completed", {
                        module: "handlers",
                        chatId: context.chatId,
                        runtimeKind: kind,
                        tmuxClient: client,
                        injectionEnabled: false, // P5.6.14-R3: tmux 永远不注入
                    });

                    return { success: true, response: result.response || "（无回复）" };
                }
            } catch {
                // ignore
            }
        }

        // agent 编排链路（默认）
        // P5.6.14-R3: agent 链路注入 SOUL/记忆/工具
        const voiceMode = getVoiceReplyMode(context.chatId);
        const ttsPrefs = getTtsPrefs(context.chatId);

        // 单源化：Agent Backend 仅从全局 AGENT_BACKEND 读取
        const provider = resolveGlobalAgentProvider();
        const providerSource = process.env.AGENT_BACKEND ? "env" : "default";

        try {
            const { randomUUID } = await import("node:crypto");
            const traceId = randomUUID();  // 生成链路追踪 ID

            // P5.6.2-R2: 读取短期会话窗口
            let windowMessages: WindowMessage[] = [];
            let summaryContext: string | undefined;
            let soulContext: { content: string; source: string; path: string; chars: number } | undefined;

            if (context.projectDir) {
                windowMessages = await loadWindow(context.projectDir, context.chatId);

                // P5.6.8-R4b: 读取 summary 并格式化为上下文
                const summary = await loadSummary(context.projectDir, context.chatId);
                if (summary) {
                    summaryContext = formatSummaryAsContext(summary);
                }

                // P5.6.8-R4e: 读取 SOUL 上下文
                soulContext = await resolveSoulContext(context.projectDir);
            }

            // P5.7-R9-T2 Step 1: 上下文预算感知（请求前观测）
            const contextWindowTokens = getCapabilities("lmstudio").contextWindowTokens;
            const contextBudget = getInputBudget("lmstudio");
            const contextUsedTokens = estimateTotalTokens(windowMessages);
            const contextUsagePct = Math.round((contextUsedTokens / contextBudget) * 100);
            const budgetRemaining = contextBudget - contextUsedTokens;
            const isApproachingBudget = contextUsagePct >= 70;

            logger.info("context budget observation", {
                module: "handlers",
                chatId: context.chatId,
                contextWindowTokens,
                contextBudget,
                contextUsedTokens,
                contextUsagePct,
                budgetRemaining,
                isApproachingBudget,
            });

            // P5.6.14-R3: 注入观测字段
            const injectionEnabled = !!(windowMessages.length > 0 || summaryContext || soulContext?.content);

            logger.info("agent request started", {
                module: "handlers",
                chatId: context.chatId,
                traceId,
                // P5.6.14-R3: 日志字段锁
                runtimeKind: "agent",
                agentProvider: provider,
                agentProviderSource: providerSource,
                injectionEnabled,
                // 注入详情
                memoryInjected: windowMessages.length > 0 || !!summaryContext,
                memoryTurns: windowMessages.length,
                soulInjected: !!soulContext?.content,
                soulSource: soulContext?.source || "none",
                soulPath: soulContext?.path || "",
                soulChars: soulContext?.chars || 0,
            });

            // P5.6.1-R2: Persona 全量退役，不再注入 personaContent
            const personaContent = undefined;
            // P5.7-R3e: 主链走路由分发（no-tool / tool / complex-tool）
            const routedResult = await runLmStudioRoutedChat({
                prompt: trimmed,
                system: personaContent,
                ...(context.projectDir ? { workspacePath: context.projectDir } : {}),
                agentProvider: provider,
                // P5.6.8-R4b: 注入短期记忆上下文
                windowMessages,
                summaryContext,
                // P5.6.8-R4e: 注入 SOUL 上下文（direct only）
                soulContext,
            });
            const clean = (routedResult.answer || "").trim();
            if (!clean) {
                return {
                    success: false,
                    error: "LM Studio 未返回可展示的文本（可能模型只输出了 reasoning、发生截断，或模型已崩溃）",
                };
            }

            logger.info("agent request completed", {
                module: "handlers",
                chatId: context.chatId,
                traceId,
                responseLength: clean.length,
                voiceMode,
                // P5.6.14-R3: 日志字段锁
                runtimeKind: "agent",
                agentProvider: provider,
                agentProviderSource: providerSource,
                injectionEnabled,
                // P5.7-R3e: 路由观测字段
                route: routedResult.route,
                temperature: routedResult.temperature,
                // P5.6.2-R1: ToolLoop 观测字段
                toolCallCount: routedResult.toolCall ? 1 : 0,
                toolName: routedResult.toolCall?.name,
                // P5.6.8-R4e: SOUL 注入观测字段
                soulInjected: !!soulContext?.content,
                soulSource: soulContext?.source || "none",
                soulPath: soulContext?.path || "",
                soulChars: soulContext?.chars || 0,
            });

            // 自动语音回复：不在 handler 内阻塞生成（避免"很久不回复"）
            if (voiceMode !== "text") {
                const maxChars = parseInt(process.env.TTS_AUTO_MAX_CHARS || "240", 10);
                const speakText = clean.length > maxChars ? clean.slice(0, maxChars) : clean;

                logger.info("LM Studio 返回 TTS defer", {
                    module: "handlers",
                    chatId: context.chatId,
                    traceId,
                    textLength: speakText.length,
                });

                return {
                    success: true,
                    response: voiceMode === "audio" ? "正在生成语音..." : clean,
                    defer: {
                        kind: "tts",
                        text: speakText,
                        options: {
                            instruct: ttsPrefs.instruct,
                            speed: ttsPrefs.speed,
                            temperature: ttsPrefs.temperature,
                        },
                    },
                };
            }

            // P5.6.2-R2: 写回短期会话窗口（user + assistant 双向写回）
            if (context.projectDir && clean) {
                try {
                    await appendWindow(context.projectDir, context.chatId, { role: "user", content: trimmed });
                    await appendWindow(context.projectDir, context.chatId, { role: "assistant", content: clean });
                } catch {
                    // 窗口写回失败不影响主流程
                }
            }

            // P5.6.13-R2: 写回线程文件（首次消息自动创建线程）
            if (context.projectDir && clean) {
                try {
                    // 检查线程是否存在，不存在则创建
                    let threadInfo = getThreadInfo(context.chatId);
                    if (!threadInfo) {
                        // 首次消息，创建新线程
                        const runtimeMeta = {
                            kind: "agent" as const,
                            provider: provider === "none" ? "lmstudio" : provider,
                            tmuxClient: undefined,
                        };
                        await ensureThread(context.chatId, context.projectDir, trimmed, runtimeMeta);
                    }
                    // 追加 turn
                    await appendTurn(context.chatId, trimmed, clean);
                } catch {
                    // 线程写回失败不影响主流程
                }
            }

            return { success: true, response: clean, defer: null };
        } catch (error: unknown) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "调用失败",
            };
        }
    }
}

 /**
  * M5-3: Codex Handler（Codex 执行臂）
  *
  * 使用 codex exec 非交互模式处理消息
  * 参数：--skip-git-repo-check --sandbox danger-full-access --color never --output-last-message <tmp>
  */
export class CodexHandler implements CommandHandler {
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }
        // M5-4: 检查策略模式
        // P5.6.14-R2: 改用 runtime.kind 和 tmux.client 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind, getTmuxClient } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const client = await getTmuxClient(context.projectDir);

            // local-only 时拒绝 tmux 执行（需要外网访问）
            if (currentMode === "local-only" && kind === "tmux") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）",
                };
            }
        }

        // help 命令
        if (trimmed === "help" || trimmed === "帮助" || trimmed === "/help" || trimmed === "/?") {
            return {
                success: true,
                response: [
                    "Codex Bot（远程执行臂）",
                    "",
                    "直接发送消息即可与 Codex 对话。",
                    "",
                    "可用命令:",
                    "help / 帮助 / /help  显示帮助",
                    "",
                    "注意:",
                    "- 使用 codex exec 非交互模式",
                    "- 默认沙箱模式: danger-full-access（完全能力，强副作用）",
                    "- 超时时间: 60秒",
                ].join("\n"),
            };
        }

        // 执行 codex
        const { runCodexExec } = await import("./runners/codex.js");

        const result = await runCodexExec({
            workspacePath: context.projectDir || process.cwd(),
            prompt: trimmed,
            timeoutMs: 60000,
            sandbox: "danger-full-access",
        });

        if (!result.success) {
            return {
                success: false,
                error: result.error || "Codex 执行失败",
            };
        }

        return {
            success: true,
            response: result.response || "（Codex 无返回）",
        };
    }
}

function parseTtsRequest(body: string): {
    text: string;
    model?: string;
    voice?: string;
    instruct?: string;
    speed?: number;
    temperature?: number;
} {
    const s = (body || "").trim();
    if (!s) return { text: "" };

    // 形式A：/tts 某种风格：你好（把 head 当作风格描述，传给 instruct）
    const m = s.match(/^([^：:]{1,20})[：:]\s*([\s\S]+)$/);
    if (!m) return { text: s };

    const head = (m[1] || "").trim();
    const text = (m[2] || "").trim();
    return { text, instruct: head };
}
/**
 * 获取对应 Bot 的处理器
 */
export function getHandler(botType: BotType): CommandHandler {
    switch (botType) {
        case "code":
            return new CodeHandler();
        case "image":
            return new ImageHandler();
        case "file":
            return new FileHandler();
        case "lmstudio":
            return new RuntimeRouterHandler();
        default:
            return new DefaultHandler();
    }
}

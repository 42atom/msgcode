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
import { executeAgentTurn, runAgentChat } from "./agent-backend.js";
import type { InboundMessage } from "./imsg/types.js";
import { clearTtsPrefs, getTtsPrefs, getVoiceReplyMode, setTtsPrefs, setVoiceReplyMode } from "./state/store.js";
import { logger } from "./logger/index.js";
import { getPrimaryOwnerIdsForChannel } from "./config.js";
import { loadWorkspaceConfig, getRuntimeKind, getTmuxClient, getPolicyMode, getCurrentLaneModel } from "./config/workspace.js";
// P5.5: 关键词主触发已禁用，不再 import detectAutoSkill/runAutoSkill
// import { detectAutoSkill, normalizeSkillId, runAutoSkill, runSkill } from "./skills/auto.js";

// 导入 tmux 模块
import { type RunnerType } from "./tmux/session.js";
import { handleTmuxSend } from "./tmux/responder.js";

// 导入 runtime 编排器
import * as session from "./runtime/session-orchestrator.js";

// P5.6.2-R1: 导入会话窗口
import { appendWindow } from "./session-window.js";
// P5.6.13-R2: 导入线程存储
import { ensureThread, appendTurn, getThreadInfo } from "./runtime/thread-store.js";
import { renderUnknownCommandHint } from "./routes/cmd-info.js";
import { assembleAgentContext } from "./runtime/context-policy.js";
import { resolveSessionChannel } from "./runtime/session-key.js";
import { beginRun } from "./runtime/run-store.js";

const TMUX_STYLE_MAX_CHARS = 800;
const TMUX_LOCAL_ONLY_BLOCK_MESSAGE = "当前策略模式为 local-only（禁止外网访问），无法使用 Codex/Claude Code 执行臂。\n\n请执行：/policy on（或 /policy egress-allowed）";

/* =========================
 * tmux 策略守卫（单一真相源）
 * ========================= */
export function resolveTmuxPolicyBlockResult(
    kind: "agent" | "tmux",
    mode: "local-only" | "egress-allowed"
): HandleResult | null {
    if (kind === "tmux" && mode === "local-only") {
        return {
            success: false,
            error: TMUX_LOCAL_ONLY_BLOCK_MESSAGE,
        };
    }
    return null;
}

function resolveGlobalAgentProvider(): string {
    const raw = (process.env.AGENT_BACKEND || "").trim();
    // P5.7-R9-T6: 默认回退到 agent-backend（中性语义）
    if (!raw) return "agent-backend";
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
            "• /start - 启动 tmux 会话（先用 /tmux + /backend tmux 选择执行臂）",
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
            response: `未知命令: ${message}\n\n${renderUnknownCommandHint()}`,
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
 * - agent-backend/local-openai/openai/minimax → 直接调用 provider
 * - codex/claude-code → 通过 tmux session 调用
 * 支持多后端切换（配置驱动）
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
                const configuredTtsModel = context.projectDir
                  ? await getCurrentLaneModel(context.projectDir, "tts")
                  : undefined;
                const backendEnv = (configuredTtsModel || process.env.TTS_BACKEND || "").trim().toLowerCase();
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
                        `tts-model=${configuredTtsModel || "auto"}`,
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
                    const useMcp = process.env.AGENT_ENABLE_MCP === "1";
                    const personaContent = undefined;
                    const answer = await runAgentChat({
                        prompt: question,
                        system: personaContent,
                        ...(useMcp && context.projectDir ? { workspace: context.projectDir } : {}),
                    });
                    const cleanAnswer = (answer || "").trim();
                    if (!cleanAnswer) {
                        return { success: false, error: "Agent Backend 未返回可展示的文本" };
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
                    const blocked = resolveTmuxPolicyBlockResult(kind, mode);
                    if (blocked) {
                        return blocked;
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
        const run = beginRun({
            source: "message",
            kind: "light",
            chatId: context.chatId,
            workspacePath: context.projectDir,
        });

        try {
            const traceId = run.runId;
            const sessionChannel = resolveSessionChannel(context.chatId);
            const assembledContext = await assembleAgentContext({
                source: "message",
                chatId: context.chatId,
                prompt: trimmed,
                workspacePath: context.projectDir,
                agentProvider: provider,
                includeSoulContext: true,
                runId: run.runId,
                sessionKey: run.sessionKey,
                currentChannel: sessionChannel,
                currentMessageId: context.originalMessage.id,
                currentSpeakerId: context.originalMessage.sender || context.originalMessage.handle,
                currentSpeakerName: context.originalMessage.senderName,
                currentIsGroup: context.originalMessage.isGroup,
                currentMessageType: context.originalMessage.messageType,
                primaryOwnerIds: getPrimaryOwnerIdsForChannel(sessionChannel),
            });

            // P5.6.14-R3: 注入观测字段
            const injectionEnabled = !!(
                assembledContext.windowMessages.length > 0 ||
                assembledContext.summaryContext ||
                assembledContext.soulContext?.content
            );

            logger.info("agent request started", {
                module: "handlers",
                runId: run.runId,
                sessionKey: run.sessionKey,
                source: "message",
                chatId: context.chatId,
                traceId,
                // P5.6.14-R3: 日志字段锁
                runtimeKind: "agent",
                agentProvider: provider,
                agentProviderSource: providerSource,
                injectionEnabled,
                // 注入详情
                memoryInjected: assembledContext.windowMessages.length > 0 || !!assembledContext.summaryContext,
                memoryTurns: assembledContext.windowMessages.length,
                soulInjected: !!assembledContext.soulContext?.content,
                soulSource: assembledContext.soulContext?.source || "none",
                soulPath: assembledContext.soulContext?.path || "",
                soulChars: assembledContext.soulContext?.chars || 0,
                // P5.7-R9-T2: 上下文预算与 compact 观测字段（冻结）
                contextWindowTokens: assembledContext.contextWindowTokens,
                contextUsedTokens: assembledContext.contextUsedTokens,
                contextUsagePct: assembledContext.contextUsagePct,
                compactionTriggered: assembledContext.compactionTriggered,
                compactionReason: assembledContext.compactionReason,
                postCompactUsagePct: assembledContext.postCompactUsagePct,
            });

            // P5.6.1-R2: Persona 全量退役，不再注入 personaContent
            const personaContent = undefined;
            // P5.7-R3e: 主链走路由分发（no-tool / tool / complex-tool）
            const routedResult = await executeAgentTurn({
                prompt: assembledContext.prompt,
                system: personaContent,
                ...(context.projectDir ? { workspacePath: context.projectDir } : {}),
                agentProvider: provider,
                traceId,
                runContext: {
                    runId: run.runId,
                    sessionKey: run.sessionKey,
                    source: "message",
                },
                // P5.6.8-R4b: 注入短期记忆上下文
                windowMessages: assembledContext.windowMessages,
                summaryContext: assembledContext.summaryContext,
                // P5.6.8-R4e: 注入 SOUL 上下文（direct only）
                soulContext: assembledContext.soulContext,
                currentMessageId: context.originalMessage.id,
                defaultActionTargetMessageId: assembledContext.defaultActionTargetMessageId,
            });
            const clean = (routedResult.answer || "").trim();
            if (!clean) {
                const errorMessage = "Agent Backend 未返回可展示的文本（可能模型只输出了 reasoning、发生截断，或模型已崩溃）";
                run.finish({
                    status: "failed",
                    error: errorMessage,
                });
                return {
                    success: false,
                    error: errorMessage,
                };
            }

            logger.info("agent request completed", {
                module: "handlers",
                runId: run.runId,
                sessionKey: run.sessionKey,
                source: "message",
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
                toolSequence: routedResult.actionJournal
                    .filter((entry) => entry.phase === "act")
                    .map((entry) => `${entry.ok ? "ok" : "fail"}:${entry.tool}`)
                    .join(" -> "),
                // P5.6.8-R4e: SOUL 注入观测字段
                soulInjected: !!assembledContext.soulContext?.content,
                soulSource: assembledContext.soulContext?.source || "none",
                soulPath: assembledContext.soulContext?.path || "",
                soulChars: assembledContext.soulContext?.chars || 0,
            });

            // 自动语音回复：不在 handler 内阻塞生成（避免"很久不回复"）
            if (voiceMode !== "text") {
                const maxChars = parseInt(process.env.TTS_AUTO_MAX_CHARS || "240", 10);
                const speakText = clean.length > maxChars ? clean.slice(0, maxChars) : clean;

                logger.info("Agent Backend 返回 TTS defer", {
                    module: "handlers",
                    runId: run.runId,
                    source: "message",
                    chatId: context.chatId,
                    traceId,
                    textLength: speakText.length,
                });

                // P5.7-R9-T3 Step 1: TTS 模式也必须写回会话窗口（禁止漏写回）
                if (context.projectDir && clean) {
                    try {
                        await appendWindow(context.projectDir, context.chatId, {
                            role: "user",
                            content: trimmed,
                            messageId: context.originalMessage.id,
                            senderId: context.originalMessage.sender || context.originalMessage.handle,
                            senderName: context.originalMessage.senderName,
                            messageType: context.originalMessage.messageType,
                            isGroup: context.originalMessage.isGroup,
                        });
                        await appendWindow(context.projectDir, context.chatId, { role: "assistant", content: clean });
                    } catch {
                        // 窗口写回失败不影响主流程
                    }
                }

                // P5.7-R9-T3 Step 1: TTS 模式也必须写回线程
                if (context.projectDir && clean) {
                    try {
                        let threadInfo = getThreadInfo(context.chatId);
                        if (!threadInfo) {
                            const runtimeMeta = {
                                kind: "agent" as const,
                                // P5.7-R9-T6: 使用中性语义 agent-backend
                                provider: provider === "none" ? "agent-backend" : provider,
                                tmuxClient: undefined,
                            };
                            await ensureThread(context.chatId, context.projectDir, trimmed, runtimeMeta);
                        }
                        await appendTurn(context.chatId, trimmed, clean);
                    } catch {
                        // 线程写回失败不影响主流程
                    }
                }

                run.finish({
                    status: "completed",
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
                    await appendWindow(context.projectDir, context.chatId, {
                        role: "user",
                        content: trimmed,
                        messageId: context.originalMessage.id,
                        senderId: context.originalMessage.sender || context.originalMessage.handle,
                        senderName: context.originalMessage.senderName,
                        messageType: context.originalMessage.messageType,
                        isGroup: context.originalMessage.isGroup,
                    });
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
                            // P5.7-R9-T6: 使用中性语义 agent-backend
                            provider: provider === "none" ? "agent-backend" : provider,
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

            run.finish({
                status: "completed",
            });
            return { success: true, response: clean, defer: null };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : "调用失败";
            run.finish({
                status: "failed",
                error: errorMessage,
            });
            return {
                success: false,
                error: errorMessage,
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

        // P5.6.14-R2: 改用 runtime.kind 检查
        if (context.projectDir) {
            const { getPolicyMode, getRuntimeKind } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const kind = await getRuntimeKind(context.projectDir);
            const blocked = resolveTmuxPolicyBlockResult(kind, currentMode);
            if (blocked) {
                return blocked;
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
        case "agent-backend":
            return new RuntimeRouterHandler();
        default:
            return new DefaultHandler();
    }
}

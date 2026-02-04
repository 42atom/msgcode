/**
 * msgcode: 命令处理器
 *
 * 处理不同类型 Bot 的命令
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BotType } from "./router.js";
import { runLmStudioChat } from "./lmstudio.js";
import type { InboundMessage } from "./imsg/types.js";
import { clearTtsPrefs, getTtsPrefs, getVoiceReplyMode, setTtsPrefs, setVoiceReplyMode } from "./state/store.js";
import { loadWorkspaceConfig } from "./config/workspace.js";
import { getActivePersona } from "./config/personas.js";

// 导入 tmux 模块
import { TmuxSession, type RunnerType } from "./tmux/session.js";
import { sendSnapshot, sendEscape, sendClear } from "./tmux/sender.js";
import { handleTmuxSend } from "./tmux/responder.js";

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

        // === 执行臂解析（workspace config → tmux runner）===
        // BaseHandler 负责 tmux 交互：runner.default=codex 时切换到 Codex；否则默认 Claude
        const resolveRunner = async (): Promise<{ runner: RunnerType; blockedReason?: string }> => {
            if (!context.projectDir) return { runner: "claude" };
            try {
                const { getPolicyMode, getDefaultRunner } = await import("./config/workspace.js");
                const mode = await getPolicyMode(context.projectDir);
                const r = await getDefaultRunner(context.projectDir);
                const runner: RunnerType = r === "codex" ? "codex" : "claude";
                if (runner === "codex" && mode === "local-only") {
                    return {
                        runner,
                        blockedReason:
                            "当前策略模式为 local-only（禁止外网访问），无法使用 Codex 执行臂。\n\n请执行: /policy egress-allowed",
                    };
                }
                return { runner };
            } catch {
                return { runner: "claude" };
            }
        };

        // === 公共命令 ===

        // /start - 启动 tmux 会话（Claude/Codex）
        if (trimmed === "/start") {
            const r = await resolveRunner();
            if (r.blockedReason) return { success: false, error: r.blockedReason };
            const response = await TmuxSession.start(context.groupName, context.projectDir, r.runner);
            return { success: true, response };
        }

        // /stop - 关闭 tmux 会话
        if (trimmed === "/stop") {
            const response = await TmuxSession.stop(context.groupName);
            return { success: true, response };
        }

        // /status - 查看会话状态
        if (trimmed === "/status") {
            const response = await TmuxSession.status(context.groupName);
            return { success: true, response };
        }

        // /snapshot - 获取终端输出快照
        if (trimmed === "/snapshot") {
            const response = await sendSnapshot(context.groupName);
            return { success: true, response };
        }

        // /esc - 发送 ESC 中断
        if (trimmed === "/esc") {
            const response = await sendEscape(context.groupName);
            return { success: true, response };
        }

        // /clear - 清空 Claude 上下文（E16-S7: kill+start）
        if (trimmed === "/clear") {
            const r = await resolveRunner();
            if (r.blockedReason) return { success: false, error: r.blockedReason };
            const response = await sendClear(context.groupName, context.projectDir, r.runner);
            return { success: true, response };
        }

        // === 非命令消息：转发给 Claude（请求-响应模式）===
        if (!trimmed.startsWith("/")) {
            const r = await resolveRunner();
            if (r.blockedReason) return { success: false, error: r.blockedReason };
            const result = await handleTmuxSend(
                context.groupName,
                trimmed,
                { projectDir: context.projectDir, runner: r.runner, attachments: context.originalMessage.attachments, signal: context.signal }
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
 * LM Studio 处理器
 *
 * 使用 LM Studio 本地 OpenAI 兼容 API（不使用 lms CLI）
 * 不涉及 API key；只转发 content（忽略 reasoning_content）
 */

/**
 * 获取当前激活的 persona 内容
 *
 * @param projectDir 工作区路径
 * @returns persona 内容（Markdown 文本），如果没有激活 persona 返回 undefined
 */
async function getActivePersonaContent(projectDir: string | undefined): Promise<string | undefined> {
    if (!projectDir) {
        return undefined;
    }
    try {
        const workspaceConfig = await loadWorkspaceConfig(projectDir);
        const activePersonaId = workspaceConfig["persona.active"];
        if (!activePersonaId) {
            return undefined;
        }
        const persona = await getActivePersona(projectDir, activePersonaId);
        return persona?.content;
    } catch {
        return undefined;
    }
}

export class LMStudioHandler implements CommandHandler {
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // M5-4 P0: slash 命令永远本地执行（/tts /voice /mode 等）
        const isSlashCommand = trimmed.startsWith("/");

        // M5-4: 检查 workspace config 决定是否路由到 Codex
        // T2: 只对非 slash 命令进行 runner 分流，使用 tmux send-keys
        if (!isSlashCommand && context.projectDir) {
            try {
                const { getPolicyMode, getDefaultRunner } = await import("./config/workspace.js");
                const currentMode = await getPolicyMode(context.projectDir);
                const currentRunner = await getDefaultRunner(context.projectDir);

                // 如果 runner.default=codex，使用 handleTmuxSend（T2/T3）
                if (currentRunner === "codex") {
                    // local-only 时拒绝 codex 执行
                    if (currentMode === "local-only") {
                        return {
                            success: false,
                            error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex 执行臂。\n\n请执行: /policy egress-allowed",
                        };
                    }

                    // T2: 使用 tmux send-keys 发送消息到 Codex 会话
                    const { handleTmuxSend } = await import("./tmux/responder.js");
                    const result = await handleTmuxSend(
                        context.groupName,
                        trimmed,
                        { projectDir: context.projectDir, runner: "codex", attachments: context.originalMessage.attachments }
                    );

                    if (result.error) {
                        return { success: false, error: result.error };
                    }

                    return { success: true, response: result.response || "（无回复）" };
                }
            } catch {
                // 配置读取失败，继续使用本地模型
            }
        }

        const voiceMode = getVoiceReplyMode(context.chatId);
        const ttsPrefs = getTtsPrefs(context.chatId);

        // help
        if (trimmed === "help" || trimmed === "帮助" || trimmed === "/help" || trimmed === "/?") {
            const baseUrl = (process.env.LMSTUDIO_BASE_URL || "http://127.0.0.1:1234").replace(/\/+$/, "");
            const model = process.env.LMSTUDIO_MODEL || "(auto)";
            // /help 里也显示当前 workspace 的策略与执行臂，避免“到底要不要 /start？”的误解
            let mode: "local-only" | "egress-allowed" | "unknown" = "unknown";
            let runner: "lmstudio" | "codex" | "claude-code" | "unknown" = "unknown";
            if (context.projectDir) {
                try {
                    const { getPolicyMode, getDefaultRunner } = await import("./config/workspace.js");
                    mode = await getPolicyMode(context.projectDir);
                    runner = await getDefaultRunner(context.projectDir);
                } catch {
                    // ignore
                }
            }
            const startLine = runner === "codex"
                ? "/start  启动/恢复 Codex tmux 会话"
                : "/start  已就绪（本地模型）";
            const stopLine = runner === "codex"
                ? "/stop   关闭 Codex tmux 会话"
                : "/stop   无需停止（本地模型）";
            const clearLine = runner === "codex"
                ? "/clear  清空 Codex 会话（等价 kill+start）"
                : "/clear  清空本地会话（本地模型无持久上下文）";
            return {
                success: true,
                response: [
                    "LM Studio Bot",
                    `BaseUrl: ${baseUrl}`,
                    `Model: ${model}`,
                    context.projectDir ? `Workspace: ${context.projectDir}` : "",
                    mode !== "unknown" ? `Policy: ${mode}` : "",
                    runner !== "unknown" ? `Runner: ${runner}` : "",
                    "",
                    "直接发送消息即可与模型对话。",
                    "",
                    "可用命令:",
                    "help / 帮助 / /help  显示帮助",
                    startLine,
                    stopLine,
                    clearLine,
                    "/tts <text>   朗读指定文本（生成语音附件）",
                    "/voice <q>    先让模型回答，再把回答转成语音附件",
                    "/mode          查看语音模式",
                    "/mode voice on|off|both|audio  设置语音回复模式",
                    "/mode style <desc>  设置风格描述（VoiceDesign）",
                    "/mode style-reset    清空风格（恢复到默认音色模式）",
                    "",
                    "示例：",
                    "/tts 那真是太好了！保持这种好心情。",
                    "/voice 南京是哪里的城市？",
                    "/mode voice on",
                    "/mode style 温柔女声，语速稍慢",
                    "/mode style-reset",
                ].join("\n"),
            };
        }

        if (trimmed === "/start") {
            // T1: 检查是否需要启动 tmux 会话（runner=codex 时）
            if (context.projectDir) {
                try {
                    const { getDefaultRunner } = await import("./config/workspace.js");
                    const currentRunner = await getDefaultRunner(context.projectDir);

                    // 如果 runner=codex，启动 tmux 会话
                    if (currentRunner === "codex") {
                        // 检查策略模式
                        const { getPolicyMode } = await import("./config/workspace.js");
                        const currentMode = await getPolicyMode(context.projectDir);

                        if (currentMode === "local-only") {
                            return {
                                success: false,
                                error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex 执行臂。\n\n请执行: /policy egress-allowed",
                            };
                        }

                        const response = await TmuxSession.start(context.groupName, context.projectDir, "codex");
                        return { success: true, response };
                    }
                } catch {
                    // 配置读取失败，使用默认行为
                }
            }
            // runner=lmstudio 时，本地模型已就绪
            return { success: true, response: "已就绪（本地模型）" };
        }

        if (trimmed === "/stop") {
            // T1: 检查是否需要停止 tmux 会话（runner=codex 时）
            if (context.projectDir) {
                try {
                    const { getDefaultRunner } = await import("./config/workspace.js");
                    const currentRunner = await getDefaultRunner(context.projectDir);

                    if (currentRunner === "codex") {
                        const response = await TmuxSession.stop(context.groupName);
                        return { success: true, response };
                    }
                } catch {
                    // 配置读取失败，使用默认行为
                }
            }
            return { success: true, response: "无需停止（本地模型）" };
        }

        if (trimmed === "/clear") {
            // T1: 检查是否需要清空 tmux 会话（runner=codex 时）
            if (context.projectDir) {
                try {
                    const { getDefaultRunner } = await import("./config/workspace.js");
                    const currentRunner = await getDefaultRunner(context.projectDir);

                    if (currentRunner === "codex") {
                        const response = await sendClear(context.groupName, context.projectDir, "codex");
                        return { success: true, response };
                    }
                } catch {
                    // 配置读取失败，使用默认行为
                }
            }
            return { success: true, response: "已清空（本地模型无持久上下文）" };
        }

        if (trimmed === "/status") {
            // T1: 检查是否需要查询 tmux 会话状态（runner=codex 时）
            if (context.projectDir) {
                try {
                    const { getDefaultRunner } = await import("./config/workspace.js");
                    const currentRunner = await getDefaultRunner(context.projectDir);

                    if (currentRunner === "codex") {
                        const response = await TmuxSession.status(context.groupName);
                        return { success: true, response };
                    }
                } catch {
                    // 配置读取失败，使用默认行为
                }
            }
            return { success: true, response: "本地模型运行中" };
        }

        if (trimmed === "/snapshot") {
            // T1: 检查是否需要获取 tmux 快照（runner=codex 时）
            if (context.projectDir) {
                try {
                    const { getDefaultRunner } = await import("./config/workspace.js");
                    const currentRunner = await getDefaultRunner(context.projectDir);

                    if (currentRunner === "codex") {
                        const response = await sendSnapshot(context.groupName);
                        return { success: true, response };
                    }
                } catch {
                    // 配置读取失败，使用默认行为
                }
            }
            return { success: true, response: "本地模型无终端快照" };
        }

        if (trimmed === "/esc") {
            // T1: 检查是否需要发送 ESC（runner=codex 时）
            if (context.projectDir) {
                try {
                    const { getDefaultRunner } = await import("./config/workspace.js");
                    const currentRunner = await getDefaultRunner(context.projectDir);

                    if (currentRunner === "codex") {
                        const response = await sendEscape(context.groupName);
                        return { success: true, response };
                    }
                } catch {
                    // 配置读取失败，使用默认行为
                }
            }
            return { success: true, response: "本地模型无 ESC 中断" };
        }

        if (trimmed === "/mode" || trimmed === "mode") {
            return {
                success: true,
                response: [
                    `语音回复模式: ${voiceMode}`,
                    `TTS: model=${ttsPrefs.model || "CustomVoice"} voice=${ttsPrefs.voice || "Serena"}`,
                    ttsPrefs.instruct ? `style=${ttsPrefs.instruct}` : "",
                ].filter(Boolean).join("\n"),
            };
        }

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

        if (trimmed.startsWith("/mode style ")) {
            const style = trimmed.slice("/mode style ".length).trim();
            if (!style) {
                return { success: true, response: "用法: /mode style <desc>" };
            }
            setTtsPrefs(context.chatId, { model: "VoiceDesign", instruct: style });
            return { success: true, response: `已设置语音风格: ${style}` };
        }

        if (trimmed === "/mode style-reset" || trimmed === "/mode style reset") {
            // 清空风格：完全清空偏好，让环境变量（QWEN3_TTS_*）作为真相源
            clearTtsPrefs(context.chatId);
            return { success: true, response: "已清空语音风格（恢复默认）" };
        }

        // /tts: 朗读指定文本（不走 LLM 工具调用，直接调用本地 TTS runner）
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
                const { runTts } = await import("./runners/tts.js");
                const tts = await runTts({
                    workspacePath: context.projectDir,
                    text: toSpeak,
                    voice: parsed.voice,
                    model: parsed.model,
                    instruct: parsed.instruct,
                    speed: parsed.speed,
                    temperature: parsed.temperature,
                });
                if (!tts.success || !tts.audioPath) {
                    return { success: false, error: tts.error || "TTS 失败" };
                }
                return { success: true, response: "已生成语音", file: { path: tts.audioPath } };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        }

        // /voice: 先回答，再把回答转为语音
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
                const personaContent = await getActivePersonaContent(context.projectDir);
                const answer = await runLmStudioChat({
                    prompt: question,
                    system: personaContent,
                    ...(useMcp && context.projectDir ? { workspace: context.projectDir } : {}),
                });
                const cleanAnswer = (answer || "").trim();
                if (!cleanAnswer) {
                    return { success: false, error: "LM Studio 未返回可展示的文本" };
                }
                const { runTts } = await import("./runners/tts.js");
                const tts = await runTts({ workspacePath: context.projectDir, text: cleanAnswer });
                if (!tts.success || !tts.audioPath) {
                    return { success: true, response: cleanAnswer }; // 降级：至少返回文本
                }
                return { success: true, response: cleanAnswer, file: { path: tts.audioPath } };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        }

        if (trimmed.startsWith("/")) {
            return {
                success: true,
                response: `LM Studio Bot 不支持命令: ${trimmed}
发送 help 查看帮助`,
            };
        }

        try {
            // P0: 只在 MCP 真正启用时才传递 workspace（避免注入 MCP 规则导致元叙事）
            const useMcp = process.env.LMSTUDIO_ENABLE_MCP === "1";
            const personaContent = await getActivePersonaContent(context.projectDir);
            const response = await runLmStudioChat({
                prompt: trimmed,
                system: personaContent,
                ...(useMcp && context.projectDir ? { workspace: context.projectDir } : {}),
            });
            const clean = (response || "").trim();
            if (!clean) {
                return {
                    success: false,
                    error: "LM Studio 未返回可展示的文本（可能模型只输出了 reasoning、发生截断，或模型已崩溃）",
                };
            }

            // 自动语音回复：不在 handler 内阻塞生成（避免“很久不回复”）
            if (voiceMode !== "text") {
                const maxChars = parseInt(process.env.TTS_AUTO_MAX_CHARS || "240", 10);
                const speakText = clean.length > maxChars ? clean.slice(0, maxChars) : clean;

                return {
                    success: true,
                    response: voiceMode === "audio" ? "正在生成语音..." : clean,
                    defer: {
                        kind: "tts",
                        text: speakText,
                        options: {
                            model: ttsPrefs.model,
                            voice: ttsPrefs.voice,
                            instruct: ttsPrefs.instruct,
                            speed: ttsPrefs.speed,
                            temperature: ttsPrefs.temperature,
                        },
                    },
                };
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
 * 参数：--skip-git-repo-check --sandbox read-only --color never --output-last-message <tmp>
 */
export class CodexHandler implements CommandHandler {
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // M5-4: 检查策略模式
        if (context.projectDir) {
            const { getPolicyMode, getDefaultRunner } = await import("./config/workspace.js");
            const currentMode = await getPolicyMode(context.projectDir);
            const currentRunner = await getDefaultRunner(context.projectDir);

            // local-only 时拒绝 codex 执行
            if (currentMode === "local-only" && currentRunner === "codex") {
                return {
                    success: false,
                    error: "当前策略模式为 local-only（禁止外网访问），无法使用 Codex 执行臂。\n\n请执行: /policy egress-allowed",
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
                    "- 默认沙箱模式: read-only（无副作用）",
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
            sandbox: "read-only",
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

    // 形式A：/tts Serena: 你好
    // 形式B：/tts 温柔女声：你好（作为 instruct → VoiceDesign）
    const m = s.match(/^([^：:]{1,20})[：:]\s*([\s\S]+)$/);
    if (!m) return { text: s };

    const head = (m[1] || "").trim();
    const text = (m[2] || "").trim();

    const voiceChoices = new Set([
        "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna", "Sohee",
    ]);

    // 直接指定音色名
    if (voiceChoices.has(head)) {
        return { text, model: "CustomVoice", voice: head };
    }

    // 否则把 head 当作风格描述（instruct）
    return { text, model: "VoiceDesign", voice: process.env.QWEN3_TTS_VOICE || "Serena", instruct: head };
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
            return new LMStudioHandler();
        default:
            return new DefaultHandler();
    }
}

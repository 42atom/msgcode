/**
 * msgcode: Agent Backend 提示词构建模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的提示词构建逻辑
 * 目标：分离提示词构建与执行逻辑
 *
 * 提示词分类：
 * - Dialog: 对话链路（允许 SOUL 注入）
 * - Exec: 执行链路（禁止 SOUL 注入，保持协议化）
 */

import * as path from "node:path";
import * as fsPromises from "node:fs/promises";
import { config } from "../config.js";
import { logger } from "../logger/index.js";
import { MODEL_ALIAS_SET } from "./config.js";

// ============================================
// 提示词常量
// ============================================

/**
 * MCP 防循环规则（硬约束）
 */
export const MCP_ANTI_LOOP_RULES = `
你是一个会使用工具的助手。你可以通过 MCP 插件 filesystem 访问被授权的目录与文件。

核心规则：
1. 涉及目录内容、文件读写时，必须调用 filesystem 工具获取真实结果，禁止猜测。
2. 工具返回已经包含所需信息时，立刻生成最终回答，不要重复调用同一个工具获取相同信息。
3. 同一路径的目录 listing 最多调用 1 次；整个问题最多调用工具 3 次。超过则停止并说明原因。
4. 最终输出只给用户需要的结果与结论，避免输出工具调用的中间文本或代码块。

输出格式要求：
- 列出文件时：每行一个文件名，用简单列表格式
- 不要添加额外的计数说明（如"共 X 个文件"）
- 不要重复相同的条目
- 区分文件和目录时用简洁标记（如 文件：/ 目录：）
`.trim();

/**
 * 快速回答规则（E17：默认启用，避免模型思考太长时间）
 */
export const QUICK_ANSWER_CONSTRAINT = `
直接回答用户的问题，用中文纯文本输出。
不要解释你在做什么，也不要复述用户消息或任何方括号块（如 [attachment]/[图片文字]/[语音转写]）。
如需引用证据，只摘录最关键的 1-3 句。
`.trim();

/**
 * Exec Kernel 工具协议硬约束
 *
 * 目标：
 * - 执行核只负责产出 tool_calls，不输出"我将执行/我可以"等自然语言。
 * - 降低模型在工具路由里回到闲聊文本的概率。
 */
export const EXEC_TOOL_PROTOCOL_CONSTRAINT = `
你是执行核（Exec Kernel），只负责调用工具完成任务。
必须遵守：
1. 第一轮必须优先产出 tool_calls，不要输出自然语言解释。
2. 如果任务涉及读取文件、执行命令、查询状态，必须调用工具获取真实结果。
3. 没有工具结果前，禁止给出"已执行/已完成/我不能"等结论文本。
4. 工具返回后，最终总结应简短、基于工具结果，不可编造。
`.trim();

/**
 * Agent Backend 文本默认模型（缺省配置时优先尝试）
 */
export const AGENT_BACKEND_DEFAULT_CHAT_MODEL = "huihui-glm-4.7-flash-abliterated-mlx";

/**
 * @deprecated 请使用 AGENT_BACKEND_DEFAULT_CHAT_MODEL
 */
export const LMSTUDIO_DEFAULT_CHAT_MODEL = AGENT_BACKEND_DEFAULT_CHAT_MODEL;

/**
 * 系统提示词文件默认路径（可热调试）
 */
export const DEFAULT_SYSTEM_PROMPT_FILE = path.resolve(
    process.cwd(),
    "prompts",
    "agents-prompt.md"
);

/**
 * @deprecated 请使用 DEFAULT_SYSTEM_PROMPT_FILE
 */
export const DEFAULT_LMSTUDIO_SYSTEM_PROMPT_FILE = DEFAULT_SYSTEM_PROMPT_FILE;

// ============================================
// 辅助函数
// ============================================

/**
 * 防止系统提示词文件加载失败日志刷屏
 */
const PROMPT_FILE_WARNED = new Set<string>();

/**
 * 归一化模型覆盖值：
 * - 空字符串/别名返回 undefined（触发自动模型解析）
 * - 其他值按真实模型 ID 透传
 */
export function normalizeModelOverride(model?: string): string | undefined {
    const normalized = (model || "").trim();
    if (!normalized) return undefined;
    if (MODEL_ALIAS_SET.has(normalized.toLowerCase())) return undefined;
    return normalized;
}

/**
 * 解析提示词文件路径
 */
export function resolvePromptFilePath(filePath?: string): string {
    const normalized = (filePath || "").trim();
    const candidate = normalized || DEFAULT_SYSTEM_PROMPT_FILE;
    return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}

/**
 * 从文件加载系统提示词
 */
export async function loadSystemPromptFromFile(filePath?: string): Promise<string> {
    const resolvedPath = resolvePromptFilePath(filePath);
    try {
        const content = await fsPromises.readFile(resolvedPath, "utf-8");
        return content.trim();
    } catch (error) {
        if (!PROMPT_FILE_WARNED.has(resolvedPath)) {
            logger.warn("Agent backend system prompt file load failed", {
                module: "agent-backend/prompt",
                promptFilePath: resolvedPath,
                error: error instanceof Error ? error.message : String(error),
            });
            PROMPT_FILE_WARNED.add(resolvedPath);
        }
        return "";
    }
}

/**
 * @deprecated 请使用 loadSystemPromptFromFile
 */
export const loadLmStudioSystemPromptFromFile = loadSystemPromptFromFile;

/**
 * 解析基础系统提示词
 *
 * 优先级：
 * 1. 传入的 systemOverride 参数
 * 2. 配置文件中的 lmstudioSystemPrompt
 * 3. 从文件加载（lmstudioSystemPromptFile）
 */
export async function resolveBaseSystemPrompt(systemOverride?: string): Promise<string> {
    const directPrompt = (systemOverride || "").trim();
    if (directPrompt) return directPrompt;

    const envPrompt = (config.lmstudioSystemPrompt || "").trim();
    if (envPrompt) return envPrompt;

    return await loadSystemPromptFromFile(config.lmstudioSystemPromptFile);
}

// ============================================
// System Prompt 构建函数
// ============================================

/**
 * Dialog Kernel 专用 system prompt 构建函数
 *
 * 用于对话链路（kernel=dialog），允许注入 SOUL 上下文。
 *
 * @param base 基础 system prompt（用户配置）
 * @param useMcp 是否启用 MCP
 * @param soulContext SOUL 上下文（可选）
 * @returns 完整的 system prompt
 */
export function buildDialogSystemPrompt(
    base: string,
    useMcp: boolean,
    soulContext?: { content: string; source: string }
): string {
    const parts: string[] = [];

    // 1. 基础 prompt
    if (base.trim()) {
        parts.push(base.trim());
    }

    // 2. 快速回答规则
    parts.push(QUICK_ANSWER_CONSTRAINT);

    // 3. MCP 规则（可选）
    if (useMcp) {
        parts.push(MCP_ANTI_LOOP_RULES);
    }

    // 4. SOUL 上下文（仅 dialog 链路允许注入）
    if (soulContext && soulContext.source !== "none") {
        parts.push(`\n\n[灵魂身份]\n${soulContext.content}\n[/灵魂身份]`);
        parts.push(`（SOUL 已内置到系统提示中，你不需要也不应该尝试读取"灵魂文件"或"灵魂脚本"）`);
    }

    return parts.join("\n\n");
}

/**
 * Exec Kernel 专用 system prompt 构建函数
 *
 * 用于执行链路（kernel=exec），禁止注入 SOUL 上下文。
 *
 * @param base 基础 system prompt（用户配置）
 * @param useMcp 是否启用 MCP
 * @returns 完整的 system prompt（不含 SOUL）
 */
export function buildExecSystemPrompt(base: string, useMcp: boolean): string {
    const parts: string[] = [];

    // 1. 基础 prompt
    if (base.trim()) {
        parts.push(base.trim());
    }

    // 2. 执行核协议（禁止自然语言直答）
    parts.push(EXEC_TOOL_PROTOCOL_CONSTRAINT);

    // 3. MCP 规则（可选）
    if (useMcp) {
        parts.push(MCP_ANTI_LOOP_RULES);
    }

    // 注意：exec 链路禁止注入 SOUL，保持提示词最小且协议化

    return parts.join("\n\n");
}

// ============================================
// 对话上下文构建
// ============================================

/**
 * 构造对话链路输入（把历史上下文拼接到当前问题）
 *
 * 说明：
 * - Agent backend 原生 API 在当前实现里使用 string input，
 *   因此这里将 summary/window 显式拼接进 prompt，保证 no-tool 链路也能使用记忆。
 */
export function buildDialogPromptWithContext(params: {
    prompt: string;
    summaryContext?: string;
    windowMessages?: Array<{ role: string; content?: string }>;
}): string {
    const sections: string[] = [];

    if (params.summaryContext && params.summaryContext.trim()) {
        sections.push(`[历史对话摘要]\n${params.summaryContext.trim()}`);
    }

    if (params.windowMessages && params.windowMessages.length > 0) {
        const MAX_WINDOW_MESSAGES = 12;
        const MAX_CONTEXT_CHARS = 6000;
        const lines: string[] = [];
        let totalChars = 0;

        const recentMessages = params.windowMessages.slice(-MAX_WINDOW_MESSAGES);
        for (const msg of recentMessages) {
            const content = (msg.content || "").trim();
            if (!content) continue;

            const role = msg.role === "assistant" ? "assistant" : "user";
            const line = `[${role}] ${content}`;
            if (totalChars + line.length > MAX_CONTEXT_CHARS) break;
            lines.push(line);
            totalChars += line.length;
        }

        if (lines.length > 0) {
            sections.push(`[最近对话窗口]\n${lines.join("\n")}`);
        }
    }

    sections.push(`[当前用户问题]\n${params.prompt}`);
    return sections.join("\n\n");
}

/**
 * msgcode: LM Studio API 适配器
 *
 * 目标：
 * - 只走本地 HTTP API（不使用 lms CLI）
 * - 不涉及 API key
 * - 只转发最终回答（忽略 reasoning_content），并做兜底清洗
 * - 使用 LM Studio 原生 /api/v1/chat with MCP integrations（工具由服务端执行）
 *
 * 优先级：
 * 1) LM Studio 原生 REST `/api/v1/chat`（支持 MCP integrations）
 * 2) OpenAI 兼容 `/v1/chat/completions`（后备）
 */

import { config } from "./config.js";
import * as path from "node:path";
import * as fsPromises from "node:fs/promises";
import * as crypto from "node:crypto";
import { logger } from "./logger/index.js";

// P5.6.2: 导入提取的 provider 层
import { normalizeBaseUrl as normalizeBaseUrlAdapter, fetchWithTimeout } from "./providers/openai-compat-adapter.js";
import { sanitizeLmStudioOutput as sanitizeCore, dropBeforeLastClosingTag } from "./providers/output-normalizer.js";
// P5.6.13-R1A-EXEC R3: Provider adapter 契约
import { buildChatCompletionRequest, parseChatCompletionResponse } from "./providers/openai-compat-adapter.js";
// P5.7-R3e: 路由分类器
import {
    getTemperatureForRoute,
    parseModelRouteClassification,
    type RouteClassification,
} from "./routing/classifier.js";
// P5.7-R3k: SLO 降级策略
import { selectModelByDegrade, isToolCallAllowed, getDegradeState } from "./slo-degrade.js";

// ============================================
// P5.7-R3l-2: System Prompt 构建函数拆分
// ============================================

/**
 * MCP 防循环规则（硬约束）
 */
const MCP_ANTI_LOOP_RULES = `
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
const QUICK_ANSWER_CONSTRAINT = `
直接回答用户的问题，用中文纯文本输出。
不要解释你在做什么，也不要复述用户消息或任何方括号块（如 [attachment]/[图片文字]/[语音转写]）。
如需引用证据，只摘录最关键的 1-3 句。
`.trim();

/**
 * Exec Kernel 工具协议硬约束
 *
 * 目标：
 * - 执行核只负责产出 tool_calls，不输出“我将执行/我可以”等自然语言。
 * - 降低模型在工具路由里回到闲聊文本的概率。
 */
const EXEC_TOOL_PROTOCOL_CONSTRAINT = `
你是执行核（Exec Kernel），只负责调用工具完成任务。
必须遵守：
1. 第一轮必须优先产出 tool_calls，不要输出自然语言解释。
2. 如果任务涉及读取文件、执行命令、查询状态，必须调用工具获取真实结果。
3. 没有工具结果前，禁止给出“已执行/已完成/我不能”等结论文本。
4. 工具返回后，最终总结应简短、基于工具结果，不可编造。
`.trim();

/**
 * LM Studio 文本默认模型（缺省配置时优先尝试）
 */
const LMSTUDIO_DEFAULT_CHAT_MODEL = "huihui-glm-4.7-flash-abliterated-mlx";

/**
 * Provider 别名（不是 LM Studio 真实模型 ID）
 */
const MODEL_ALIAS_SET = new Set([
    "lmstudio",
    "agent-backend",
    "local-openai",
    "openai",
    "minimax",
    "llama",
    "claude",
    "none",
    "default-executor",
    "default-responder",
]);

/**
 * LM Studio 系统提示词文件默认路径（可热调试）
 */
const DEFAULT_LMSTUDIO_SYSTEM_PROMPT_FILE = path.resolve(
    process.cwd(),
    "prompts",
    "lmstudio-system.md"
);

type AgentBackendId = "local-openai" | "openai" | "minimax";

interface AgentBackendRuntime {
    id: AgentBackendId;
    baseUrl: string;
    apiKey?: string;
    model?: string;
    timeoutMs: number;
    nativeApiEnabled: boolean;
}

function parseBackendTimeoutMs(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function normalizeAgentBackendId(raw?: string): AgentBackendId {
    const normalized = (raw || "").trim().toLowerCase();
    if (!normalized || normalized === "lmstudio" || normalized === "agent-backend" || normalized === "local-openai") {
        return "local-openai";
    }
    if (normalized === "openai") return "openai";
    if (normalized === "minimax") return "minimax";
    // 兼容遗留 provider 名称，先统一回本地后端
    if (normalized === "llama" || normalized === "claude" || normalized === "none") {
        return "local-openai";
    }
    return "local-openai";
}

function resolveAgentBackendRuntime(rawBackend?: string): AgentBackendRuntime {
    const id = normalizeAgentBackendId(rawBackend || process.env.AGENT_BACKEND);
    const defaultTimeout = typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 120_000;

    if (id === "minimax") {
        const baseUrl = (process.env.MINIMAX_BASE_URL || process.env.AGENT_BASE_URL || "").trim();
        if (!baseUrl) {
            throw new Error("MiniMax backend 未配置：请设置 MINIMAX_BASE_URL 或 AGENT_BASE_URL");
        }
        return {
            id,
            baseUrl,
            apiKey: (process.env.MINIMAX_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: (process.env.MINIMAX_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: parseBackendTimeoutMs(process.env.MINIMAX_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, defaultTimeout),
            nativeApiEnabled: false,
        };
    }

    if (id === "openai") {
        return {
            id,
            baseUrl: (process.env.OPENAI_BASE_URL || process.env.AGENT_BASE_URL || "https://api.openai.com").trim(),
            apiKey: (process.env.OPENAI_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: (process.env.OPENAI_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: parseBackendTimeoutMs(process.env.OPENAI_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, defaultTimeout),
            nativeApiEnabled: false,
        };
    }

    return {
        id: "local-openai",
        baseUrl: (process.env.LMSTUDIO_BASE_URL || process.env.AGENT_BASE_URL || config.lmstudioBaseUrl || "http://127.0.0.1:1234").trim(),
        apiKey: (process.env.LMSTUDIO_API_KEY || process.env.AGENT_API_KEY || config.lmstudioApiKey || "").trim() || undefined,
        model: (process.env.LMSTUDIO_MODEL || process.env.AGENT_MODEL || config.lmstudioModel || "").trim() || undefined,
        timeoutMs: parseBackendTimeoutMs(process.env.LMSTUDIO_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, defaultTimeout),
        nativeApiEnabled: true,
    };
}

/**
 * 防止系统提示词文件加载失败日志刷屏
 */
const PROMPT_FILE_WARNED = new Set<string>();

/**
 * 归一化模型覆盖值：
 * - 空字符串/别名返回 undefined（触发自动模型解析）
 * - 其他值按真实模型 ID 透传
 */
function normalizeModelOverride(model?: string): string | undefined {
    const normalized = (model || "").trim();
    if (!normalized) return undefined;
    if (MODEL_ALIAS_SET.has(normalized.toLowerCase())) return undefined;
    return normalized;
}

function resolvePromptFilePath(filePath?: string): string {
    const normalized = (filePath || "").trim();
    const candidate = normalized || DEFAULT_LMSTUDIO_SYSTEM_PROMPT_FILE;
    return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}

async function loadLmStudioSystemPromptFromFile(filePath?: string): Promise<string> {
    const resolvedPath = resolvePromptFilePath(filePath);
    try {
        const content = await fsPromises.readFile(resolvedPath, "utf-8");
        return content.trim();
    } catch (error) {
        if (!PROMPT_FILE_WARNED.has(resolvedPath)) {
            logger.warn("LM Studio system prompt file load failed", {
                module: "lmstudio",
                promptFilePath: resolvedPath,
                error: error instanceof Error ? error.message : String(error),
            });
            PROMPT_FILE_WARNED.add(resolvedPath);
        }
        return "";
    }
}

async function resolveBaseSystemPrompt(systemOverride?: string): Promise<string> {
    const directPrompt = (systemOverride || "").trim();
    if (directPrompt) return directPrompt;

    const envPrompt = (config.lmstudioSystemPrompt || "").trim();
    if (envPrompt) return envPrompt;

    return await loadLmStudioSystemPromptFromFile(config.lmstudioSystemPromptFile);
}

/**
 * P5.7-R3l-2: Dialog Kernel 专用 system prompt 构建函数
 *
 * 用于对话链路（kernel=dialog），允许注入 SOUL 上下文。
 *
 * @param base 基础 system prompt（用户配置）
 * @param useMcp 是否启用 MCP
 * @param soulContext SOUL 上下文（可选）
 * @returns 完整的 system prompt
 */
function buildDialogSystemPrompt(
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
 * P5.7-R3l-2: Exec Kernel 专用 system prompt 构建函数
 *
 * 用于执行链路（kernel=exec），禁止注入 SOUL 上下文。
 *
 * @param base 基础 system prompt（用户配置）
 * @param useMcp 是否启用 MCP
 * @returns 完整的 system prompt（不含 SOUL）
 */
function buildExecSystemPrompt(base: string, useMcp: boolean): string {
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

export interface LmStudioChatOptions {
    prompt: string;
    system?: string;
    workspace?: string;  // 可选：工作目录（启用 MCP integrations）
    model?: string;      // P5.7-R3e: 可选覆盖模型（用于 responder/executor 分流）
    temperature?: number; // P5.7-R3e: 可选覆盖温度（默认 0.7）
    backendRuntime?: AgentBackendRuntime; // P5.7-R8b: 后端运行时配置（baseUrl/apiKey/model）
    windowMessages?: Array<{ role: string; content?: string }>; // P5.7-R3l: 对话窗口上下文
    summaryContext?: string; // P5.7-R3l: 历史摘要上下文
    soulContext?: { content: string; source: string; path: string; chars: number }; // P5.7-R3l: SOUL 上下文
}

/**
 * 构造对话链路输入（把历史上下文拼接到当前问题）
 *
 * 说明：
 * - LM Studio 原生 /api/v1/chat 在当前实现里使用 string input，
 *   因此这里将 summary/window 显式拼接进 prompt，保证 no-tool 链路也能使用记忆。
 */
function buildDialogPromptWithContext(params: {
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

export async function runLmStudioChat(options: LmStudioChatOptions): Promise<string> {
    const backendRuntime = options.backendRuntime || resolveAgentBackendRuntime();
    const baseUrl = normalizeBaseUrl(backendRuntime.baseUrl);
    const modelOverride = normalizeModelOverride(options.model);
    const backendDefaultModel = normalizeModelOverride(backendRuntime.model);

    // P5.7-R8b: 非本地后端不探测 /api/v1/models，必须显式模型
    const model = modelOverride
        ?? backendDefaultModel
        ?? (backendRuntime.nativeApiEnabled
            ? await resolveLmStudioModelId({
                baseUrl,
                configuredModel: backendRuntime.model,
                apiKey: backendRuntime.apiKey,
                timeoutMs: backendRuntime.timeoutMs,
            })
            : undefined);

    if (!model) {
        throw new Error(`Agent backend(${backendRuntime.id}) 未配置模型。请设置 AGENT_MODEL 或对应后端模型变量。`);
    }
    const resolvedModel = model;

    // P5.7-R3e: 支持传入 temperature，否则默认 0.7（创造性回复）
    const temperature = options.temperature ?? 0.7;

    // 构建 system prompt：优先 options.system，其次环境变量，其次提示词文件
    const baseSystem = await resolveBaseSystemPrompt(options.system);

    const timeoutMs = backendRuntime.timeoutMs;

    const maxTokens = typeof config.lmstudioMaxTokens === "number" && Number.isFinite(config.lmstudioMaxTokens) && config.lmstudioMaxTokens > 0
        ? Math.floor(config.lmstudioMaxTokens)
        : 4000;

    // E17: 默认禁用 MCP（避免模型尝试读取文件，需要 LMSTUDIO_ENABLE_MCP=1 显式启用）
    const useMcp = backendRuntime.nativeApiEnabled && process.env.LMSTUDIO_ENABLE_MCP === "1" && !!options.workspace;

    // MCP 模式需要更大的 max_tokens，避免工具调用被截断
    // 工具调用块本身可能 100+ token，太小会导致缺少 [END_TOOL_REQUEST]
    const mcpMaxTokens = Math.max(maxTokens, 1024);

    // P5.7-R3l: 对话链路将 summary/window 注入到输入，避免 no-tool 丢失记忆
    const promptWithContext = buildDialogPromptWithContext({
        prompt: options.prompt,
        summaryContext: options.summaryContext,
        windowMessages: options.windowMessages,
    });

    // 构造 system prompt（包含快速回答规则）
    // P5.7-R3l-2: 使用 buildDialogSystemPrompt（dialog 链路允许 SOUL 注入）
    const systemPrompt = buildDialogSystemPrompt(
        baseSystem,
        useMcp,
        options.soulContext
            ? { content: options.soulContext.content, source: options.soulContext.source }
            : undefined
    );
    const compatSystemPrompt = buildDialogSystemPrompt(
        baseSystem,
        false,
        options.soulContext
            ? { content: options.soulContext.content, source: options.soulContext.source }
            : undefined
    );

    async function runNativeMcpOnce(maxOutputTokens: number): Promise<string> {
        const native = await runLmStudioChatNativeMcp({
            baseUrl,
            model: resolvedModel,
            prompt: promptWithContext,
            system: systemPrompt,  // 传递 system_prompt
            maxOutputTokens: Math.max(maxOutputTokens, mcpMaxTokens),
            timeoutMs,
            useMcp,
            apiKey: backendRuntime.apiKey,
            temperature, // P5.7-R3e-hotfix-2: 传递温度参数
        });
        return sanitizeLmStudioOutput(native);
    }

    async function runNativeOnce(maxOutputTokens: number): Promise<string> {
        const native = await runLmStudioChatNative({
            baseUrl,
            model: resolvedModel,
            prompt: promptWithContext,
            system: systemPrompt,  // 传递 system_prompt
            maxOutputTokens,
            timeoutMs,
            apiKey: backendRuntime.apiKey,
            temperature, // P5.7-R3e: 传递温度参数
        });
        return sanitizeLmStudioOutput(native);
    }

    async function runCompatOnce(maxOutputTokens: number): Promise<string> {
        const text = await runLmStudioChatOpenAICompat({
            baseUrl,
            model: resolvedModel,
            prompt: promptWithContext,
            system: compatSystemPrompt && compatSystemPrompt.trim() ? compatSystemPrompt.trim() : undefined,
            maxTokens: maxOutputTokens,
            timeoutMs,
            apiKey: backendRuntime.apiKey,
            temperature, // P5.7-R3e: 传递温度参数
        });
        return sanitizeLmStudioOutput(text);
    }

    // 1) 本地 LM Studio 后端优先走原生 REST；其他后端直接走 OpenAI 兼容
    if (backendRuntime.nativeApiEnabled) {
        try {
            if (useMcp) {
                return await runNativeMcpOnce(maxTokens);
            }
            return await runNativeOnce(maxTokens);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : "";

            // 止血：部分模型在长输出/长思考时会直接崩溃（500 model has crashed）
            // 这里不改变提示词，仅把 max tokens 降档重试一次，避免“无回复”。
            if (isModelCrashedMessage(msg) && maxTokens > 1600) {
                try {
                    return await runNativeOnce(1600);
                } catch {
                    // ignore and proceed to normal fallback/throw
                }
            }

            // /api/v1/chat 不存在时（老版本/未启用），走 OpenAI 兼容模式
            const shouldFallback = msg.includes("404") || msg.includes("未返回可展示的内容");
            if (!shouldFallback) {
                // 其他错误直接抛给上层（含超时/模型错误），避免吞掉根因
                throw error instanceof Error ? error : new Error("LM Studio 调用失败");
            }
        }
    }

    // 2) 后备：OpenAI 兼容
    try {
        return await runCompatOnce(maxTokens);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "";
        if (isModelCrashedMessage(msg) && maxTokens > 1600) {
            return await runCompatOnce(1600);
        }
        throw error instanceof Error ? error : new Error("LM Studio 调用失败");
    }
}

type ResolveModelParams = {
    baseUrl: string;
    configuredModel?: string;
    apiKey?: string;
    timeoutMs?: number;
};

let cachedModel: { baseUrl: string; id: string } | undefined;

/**
 * LM Studio 专用 URL 标准化
 * 在 adapter 基础上额外移除 /v1 后缀
 */
function normalizeBaseUrl(raw: string): string {
    let base = normalizeBaseUrlAdapter(raw);
    if (base.endsWith("/v1")) {
        base = base.slice(0, -3);
    }
    return base;
}

async function resolveLmStudioModelId(params: ResolveModelParams): Promise<string> {
    const configured = ((params.configuredModel ?? config.lmstudioModel) || "").trim();

    // 优先使用配置的模型名（直接使用，LM Studio 会自动处理）
    if (configured && configured !== "auto") {
        return configured;
    }

    // 缺省模式：优先使用稳定基座（只要模型在目录中存在，LM Studio 会按需自动加载）
    if (!configured) {
        const preferredAvailable = await isModelPresentInNativeCatalog({
            baseUrl: params.baseUrl,
            key: LMSTUDIO_DEFAULT_CHAT_MODEL,
            apiKey: params.apiKey,
            timeoutMs: params.timeoutMs,
        });
        if (preferredAvailable) {
            if (
                cachedModel &&
                cachedModel.baseUrl === params.baseUrl &&
                cachedModel.id === LMSTUDIO_DEFAULT_CHAT_MODEL
            ) {
                return cachedModel.id;
            }
            cachedModel = { baseUrl: params.baseUrl, id: LMSTUDIO_DEFAULT_CHAT_MODEL };
            return LMSTUDIO_DEFAULT_CHAT_MODEL;
        }
    }

    // auto 模式：只使用已加载的模型
    const loadedModel = await fetchFirstLoadedModelKeyNative({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
    });
    if (loadedModel) {
        if (cachedModel && cachedModel.baseUrl === params.baseUrl && cachedModel.id === loadedModel) {
            return cachedModel.id;
        }
        cachedModel = { baseUrl: params.baseUrl, id: loadedModel };
        return loadedModel;
    }

    // 没有已加载的模型，抛出错误
    throw new Error(
        "LM Studio 中没有已加载的模型。\n\n" +
        "请在 LM Studio 中加载至少一个模型后再试。"
    );
}

async function fetchFirstModelId(params: { baseUrl: string; apiKey?: string; timeoutMs?: number }): Promise<string | null> {
    // 优先：原生 REST
    try {
        const id = await fetchFirstLoadedModelKeyNative({
            baseUrl: params.baseUrl,
            apiKey: params.apiKey,
            timeoutMs: params.timeoutMs,
        });
        if (id) return id;
    } catch {
        // ignore and fallback
    }

    // 后备：OpenAI 兼容
    const url = `${params.baseUrl}/v1/models`;

    const timeoutMs = params.timeoutMs || (typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 60_000);

    // 使用 fetchTextWithTimeout，它会自动添加 API key
    const rawText = await fetchTextWithTimeout({
        url,
        method: "GET",
        timeoutMs,
        apiKey: params.apiKey,
    });

    let json: unknown;
    try {
        json = JSON.parse(rawText);
    } catch {
        return null;
    }

    const data = isModelsList(json) ? json.data : [];
    for (const item of data) {
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (id) return id;
    }

    throw new Error(
        "LM Studio 未返回可用模型：请在 LM Studio 中加载至少一个模型，或在 ~/.config/msgcode/.env 中设置 LMSTUDIO_MODEL=auto"
    );
}

function isAbortError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    if (!("name" in error)) return false;
    return (error as { name?: unknown }).name === "AbortError";
}

function isModelCrashedMessage(message: string): boolean {
    return /model has crashed/i.test(message) || message.includes("模型进程崩溃");
}

function isModelsList(value: unknown): value is { data: Array<{ id?: unknown }> } {
    if (!value || typeof value !== "object") return false;
    if (!("data" in value)) return false;
    return Array.isArray((value as { data?: unknown }).data);
}

type LmStudioNativeChatParams = {
    baseUrl: string;
    model: string;
    prompt: string;
    system?: string;
    maxOutputTokens: number;
    timeoutMs: number;
    apiKey?: string;
    temperature?: number; // P5.7-R3e: 可选温度参数
};

/**
 * LM Studio 原生 /api/v1/chat with MCP integrations
 *
 * 使用 MCP 插件让 LM Studio 服务端执行工具调用
 */
type LmStudioNativeMcpParams = {
    baseUrl: string;
    model: string;
    prompt: string;
    system?: string;
    maxOutputTokens: number;
    timeoutMs: number;
    useMcp: boolean;
    apiKey?: string;
    temperature?: number; // P5.7-R3e-hotfix-2: 可选温度参数
};

async function runLmStudioChatNativeMcp(params: LmStudioNativeMcpParams): Promise<string> {
    const url = `${params.baseUrl}/api/v1/chat`;

    const bodyBase: Record<string, unknown> = {
        model: params.model,
        input: params.prompt,
        stream: false,
        max_output_tokens: params.maxOutputTokens,
        temperature: params.temperature ?? 0,  // P5.7-R3e-hotfix-2: 支持传入温度，默认 0（降低随机性）
    };

    // 添加 system_prompt（如果提供）
    if (params.system && params.system.trim()) {
        bodyBase.system_prompt = params.system.trim();
    }

    // 不设置 system_prompt，保持空

    // 启用 MCP filesystem integrations
    // 注意：根据 LM Studio 官方文档，integrations 只需要 type 和 id
    // 服务端会自动处理 mcp.json 里配置的所有工具
    if (params.useMcp) {
        bodyBase.integrations = [
            {
                type: "plugin",
                id: "mcp/filesystem"
            }
        ];
    }

    // 重试逻辑：处理 "Model unloaded" 错误
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const rawText = await fetchTextWithTimeout({
                url,
                method: "POST",
                timeoutMs: params.timeoutMs,
                headers: { "content-type": "application/json" },
                body: JSON.stringify(bodyBase),
                apiKey: params.apiKey,
            });

            let json: unknown;
            try {
                json = JSON.parse(rawText);
            } catch {
                throw new Error(`LM Studio API 返回非 JSON：${sanitizeLmStudioOutput(rawText).slice(0, 400)}`);
            }

            const message = extractMessageFromApiV1Chat(json);
            if (!message || !message.trim()) {
                throw new Error("LM Studio 未返回可展示的内容");
            }
            return message;
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error("LM Studio 调用失败");
            const msg = lastError.message;

            // 如果是 "Model unloaded" 错误且不是最后一次尝试，等待后重试
            if (msg.includes("Model unloaded") && attempt < 1) {
                // 等待 3 秒让 LM Studio 重新加载模型
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }
            break;
        }
    }

    throw new Error(`LM Studio(${params.model}) ${lastError?.message || "调用失败"}`);
}

/**
 * 从 /api/v1/chat 响应中提取最终 message
 *
 * output 数组混合包含：
 * - type:"tool_call"：工具调用（包含 tool/arguments/output）
 * - type:"message"：最终文本
 *
 * 我们只需要拼接所有 type:"message" 的 content
 */
function extractMessageFromApiV1Chat(value: unknown): string {
    const output = isNativeChatResponse(value) ? value.output : [];
    const messages: string[] = [];

    for (const item of output) {
        if (item.type !== "message") continue;
        const extracted = extractTextFromUnknown(item.content);
        if (extracted) messages.push(extracted);
    }

    return messages.join("\n");
}

async function runLmStudioChatNative(params: LmStudioNativeChatParams): Promise<string> {
    const url = `${params.baseUrl}/api/v1/chat`;

    const bodyBase: Record<string, unknown> = {
        model: params.model,
        input: params.prompt,
        stream: false,
        max_output_tokens: params.maxOutputTokens,
        temperature: params.temperature ?? 0, // P5.7-R3e: 支持传入温度，默认 0（稳定优先）
    };

    // 添加 system_prompt（如果提供）
    if (params.system && params.system.trim()) {
        bodyBase.system_prompt = params.system.trim();
    }

    // 重试逻辑：处理 "Model unloaded" 错误
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const rawText = await fetchTextWithTimeout({
                url,
                method: "POST",
                timeoutMs: params.timeoutMs,
                headers: { "content-type": "application/json" },
                body: JSON.stringify(bodyBase),
                apiKey: params.apiKey,
            });

            let json: unknown;
            try {
                json = JSON.parse(rawText);
            } catch {
                throw new Error(`LM Studio API 返回非 JSON：${sanitizeLmStudioOutput(rawText).slice(0, 400)}`);
            }

            const message = extractLmStudioNativeMessage(json);
            if (!message || !message.trim()) {
                throw new Error("LM Studio 未返回可展示的内容");
            }
            return message;
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error("LM Studio 调用失败");
            const msg = lastError.message;

            // 如果是 "Model unloaded" 错误且不是最后一次尝试，等待后重试
            if (msg.includes("Model unloaded") && attempt < 1) {
                // 等待 3 秒让 LM Studio 重新加载模型
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }
            break;
        }
    }

    throw new Error(`LM Studio(${params.model}) ${lastError?.message || "调用失败"}`);
}

type LmStudioOpenAIChatParams = {
    baseUrl: string;
    model: string;
    prompt: string;
    system?: string;
    maxTokens: number;
    timeoutMs: number;
    apiKey?: string;
    temperature?: number; // P5.7-R3e: 可选温度参数
};

async function runLmStudioChatOpenAICompat(params: LmStudioOpenAIChatParams): Promise<string> {
    const url = `${params.baseUrl}/v1/chat/completions`;

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (params.system && params.system.trim()) {
        // 默认不注入（除非用户显式配置），避免绑定角色/行为
        messages.push({ role: "system", content: params.system.trim() });
    }
    messages.push({ role: "user", content: params.prompt });

    const rawText = await fetchTextWithTimeout({
        url,
        method: "POST",
        timeoutMs: params.timeoutMs,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            model: params.model,
            messages,
            stream: false,
            max_tokens: params.maxTokens,
            temperature: params.temperature ?? 0.7, // P5.7-R3e: 支持传入温度，默认 0.7
        }),
        apiKey: params.apiKey,
    });

    let json: unknown;
    try {
        json = JSON.parse(rawText);
    } catch {
        throw new Error(`LM Studio API 返回非 JSON：${sanitizeLmStudioOutput(rawText).slice(0, 400)}`);
    }

    const content = isChatCompletion(json) ? json.choices[0]?.message?.content : undefined;
    const text = typeof content === "string" ? content : (content ? String(content) : "");
    if (!text || !text.trim()) {
        throw new Error(`LM Studio(${params.model}) 未返回可展示的内容`);
    }
    return text;
}

/**
 * 检查指定模型是否已加载
 */
async function fetchLoadedModelByKey(params: { baseUrl: string; key: string; apiKey?: string; timeoutMs?: number }): Promise<string | null> {
    try {
        const url = `${params.baseUrl}/api/v1/models`;
        const rawText = await fetchTextWithTimeout({
            url,
            method: "GET",
            timeoutMs: params.timeoutMs || (typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs) ? config.lmstudioTimeoutMs : 60_000),
            apiKey: params.apiKey,
        });

        let json: unknown;
        try {
            json = JSON.parse(rawText);
        } catch {
            return null;
        }

        // LM Studio /api/v1/models 目前返回 "models"；
        // 兼容旧形态 "data"，避免模型选择链路失效。
        const models = extractNativeModels(json);
        for (const m of models) {
            if (m.type !== "llm") continue;
            if (typeof m.key !== "string" || m.key !== params.key) continue;
            if (!Array.isArray(m.loaded_instances) || m.loaded_instances.length === 0) continue;
            return m.key;
        }
    } catch {
        // 忽略错误，返回 null
    }
    return null;
}

/**
 * 检查模型是否存在于 LM Studio 目录（已下载即可）
 */
async function isModelPresentInNativeCatalog(params: { baseUrl: string; key: string; apiKey?: string; timeoutMs?: number }): Promise<boolean> {
    try {
        const url = `${params.baseUrl}/api/v1/models`;
        const rawText = await fetchTextWithTimeout({
            url,
            method: "GET",
            timeoutMs: params.timeoutMs || (typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs) ? config.lmstudioTimeoutMs : 60_000),
            apiKey: params.apiKey,
        });

        let json: unknown;
        try {
            json = JSON.parse(rawText);
        } catch {
            return false;
        }

        const models = extractNativeModels(json);
        return models.some((m) => m.type === "llm" && typeof m.key === "string" && m.key === params.key);
    } catch {
        return false;
    }
}

async function fetchFirstLoadedModelKeyNative(params: { baseUrl: string; apiKey?: string; timeoutMs?: number }): Promise<string | null> {
    const url = `${params.baseUrl}/api/v1/models`;
    const rawText = await fetchTextWithTimeout({
        url,
        method: "GET",
        timeoutMs: params.timeoutMs || (typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs) ? config.lmstudioTimeoutMs : 60_000),
        apiKey: params.apiKey,
    });

    let json: unknown;
    try {
        json = JSON.parse(rawText);
    } catch {
        return null;
    }

    // LM Studio 的 /api/v1/models 返回的是 "models" 字段，不是 "data"
    const models = (json as { models?: unknown[] }).models ?? [];
    for (const m of models) {
        if (!m || typeof m !== "object") continue;
        const model = m as { type?: unknown; key?: string; loaded_instances?: unknown[] };
        if (model.type !== "llm") continue;
        if (!Array.isArray(model.loaded_instances) || model.loaded_instances.length === 0) continue;
        const key = model.key;
        if (typeof key !== "string") continue;
        if (key) return key;
    }
    return null;
}

async function fetchTextWithTimeout(params: {
    url: string;
    method: "GET" | "POST";
    timeoutMs: number;
    headers?: Record<string, string>;
    body?: string;
    apiKey?: string;
}): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

    const headers: Record<string, string> = { ...params.headers };
    const apiKey = params.apiKey?.trim() || config.lmstudioApiKey?.trim();
    if (apiKey) {
        headers["authorization"] = `Bearer ${apiKey}`;
    }

    let resp: Response;
    try {
        resp = await fetch(params.url, {
            method: params.method,
            headers,
            body: params.body,
            signal: controller.signal,
        });
    } catch (error: unknown) {
        if (isAbortError(error)) {
            throw new Error(`LM Studio API 请求超时`);
        }
        throw new Error(`LM Studio API 连接失败：请确认已在 LM Studio 中启动本地 Server（${params.url}）`);
    } finally {
        clearTimeout(timeoutId);
    }

    const rawText = await resp.text();
    if (!resp.ok) {
        const snippet = sanitizeLmStudioOutput(rawText).slice(0, 400);
        if (resp.status >= 500 && /model has crashed/i.test(rawText)) {
            throw new Error(
                `LM Studio API 错误 (${resp.status})：模型进程崩溃。请在 LM Studio 中重新加载/重启该模型，或切换到更小/更稳定的模型。\n${snippet}`
            );
        }
        throw new Error(`LM Studio API 错误 (${resp.status})：${snippet}`);
    }
    return rawText;
}

function extractLmStudioNativeMessage(value: unknown): string {
    const output = isNativeChatResponse(value) ? value.output : [];
    let lastReasoning = "";

    for (const item of output) {
        // 优先返回 message（最终答案）
        if (item.type === "message") {
            const extracted = extractTextFromUnknown(item.content);
            if (extracted) return extracted;
        }
        // 记录最后一次 reasoning（作为 fallback）
        if (item.type === "reasoning") {
            const extracted = extractTextFromUnknown(item.content);
            if (extracted) lastReasoning = extracted;
        }
    }

    // 如果没有 message，说明模型只输出了 reasoning（被截断/未完成）
    // 不应该把 reasoning 发给用户，返回空字符串或错误提示
    if (lastReasoning) {
        // 兜底：尝试从 reasoning 中提取最后一部分作为答案（可能是未完成的答案）
        const lines = lastReasoning.split("\n");
        const lastLines = lines.slice(-3).join("\n").trim();
        if (lastLines && lastLines.length > 10) {
            return lastLines;
        }
    }

    return "";
}

function extractTextFromUnknown(value: unknown): string {
    if (typeof value === "string") return value;
    if (!value) return "";

    if (Array.isArray(value)) {
        const parts: string[] = [];
        for (const v of value) {
            const t = extractTextFromUnknown(v);
            if (t) parts.push(t);
        }
        return parts.join("");
    }

    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        // 常见形态：{ text: "..." }
        if (typeof obj.text === "string") return obj.text;
        // 或者：{ content: "..." }
        if (typeof obj.content === "string") return obj.content;
        // 或者：{ value: "..." }
        if (typeof obj.value === "string") return obj.value;
    }

    return "";
}

function isNativeChatResponse(value: unknown): value is { output: Array<{ type?: unknown; content?: unknown }> } {
    if (!value || typeof value !== "object") return false;
    if (!("output" in value)) return false;
    return Array.isArray((value as { output?: unknown }).output);
}

function isNativeModelsList(value: unknown): value is { data: Array<{ type?: unknown; key?: unknown; loaded_instances?: unknown }> } {
    if (!value || typeof value !== "object") return false;
    if (!("data" in value)) return false;
    return Array.isArray((value as { data?: unknown }).data);
}

function extractNativeModels(value: unknown): Array<{ type?: unknown; key?: unknown; loaded_instances?: unknown }> {
    if (!value || typeof value !== "object") return [];

    const obj = value as { data?: unknown; models?: unknown };
    if (Array.isArray(obj.models)) {
        return obj.models as Array<{ type?: unknown; key?: unknown; loaded_instances?: unknown }>;
    }
    if (Array.isArray(obj.data)) {
        return obj.data as Array<{ type?: unknown; key?: unknown; loaded_instances?: unknown }>;
    }
    return [];
}

function isChatCompletion(value: unknown): value is { choices: Array<{ message?: any }> } {
    if (!value || typeof value !== "object") return false;
    if (!("choices" in value)) return false;
    return Array.isArray((value as { choices?: unknown }).choices);
}

/**
 * 清洗 LM Studio 输出：
 *
 * wire-hygiene（默认开启）：
 * - 去 ANSI 转义
 * - 去除 JSON 包裹（reasoning_content/content/role）
 * - 去除 </think>...<think>...</think>
 */
/**
 * 清洗 LM Studio 输出
 *
 * 额外逻辑（不走 provider）：
 * - think 标签过滤
 * - tool_calls/tool_call XML 块过滤
 * - 末尾多余空行压缩
 */
export function sanitizeLmStudioOutput(text: string): string {
    let out = text ?? "";

    // P5.6.2: 调用 provider 层
    out = sanitizeCore(out);

    // 额外逻辑：think 标签过滤
    out = dropBeforeLastClosingTag(out, "think");
    out = out.replace(/<think[\s\S]*?<\/think>/gi, "");
    // E17: 过滤 tool_calls 等内部信息
    out = out.replace(/tool_calls[参数:\s\S]*?(?=\n\n|$)/gi, "");
    // E17: 过滤 XML-ish 工具调用块（含 namespaced 标签，如 <minimax:tool_call>）
    out = out.replace(/<[\w:-]*tool_call[\w:-]*>[\s\S]*?<\/[\w:-]*tool_call>/gi, "");
    // E17: 过滤 invoke/parameter 协议块
    out = out.replace(/<invoke\b[\s\S]*?<\/invoke>/gi, "");
    out = out.replace(/<parameter\b[\s\S]*?<\/parameter>/gi, "");

    // 末尾多余空行压缩
    return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 判断文本是否仍包含工具协议片段（不可直接展示给用户）
 */
function hasToolProtocolArtifacts(text: string): boolean {
    const input = (text || "").trim();
    if (!input) return false;

    return (
        /<[\w:-]*tool_call[\w:-]*>/i.test(input) ||
        /<\/[\w:-]*tool_call>/i.test(input) ||
        /<invoke\b/i.test(input) ||
        /<\/invoke>/i.test(input) ||
        /<parameter\b/i.test(input) ||
        /<\/parameter>/i.test(input) ||
        /\[\/?TOOL_CALL\]/i.test(input)
    );
}


// ============================================
// Tool Calling 支持
// ============================================

/**
 * 工具路径白名单根目录
 */
const AIDOCS_ROOT = process.env.AIDOCS_ROOT || "AIDOCS";

/**
 * P5.6.8-R3: PI 四基础工具定义（OpenAI function calling schema）
 *
 * pi.on 模式：向 LLM 暴露四基础工具
 * pi.off 模式：不暴露任何工具（普通 direct 聊天 + 记忆注入）
 */
const PI_ON_TOOLS = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: "读取文件内容",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "文件路径（相对或绝对）" }
                },
                required: ["path"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "写入文件（整文件覆盖）",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "文件路径（相对或绝对）" },
                    content: { type: "string", description: "要写入的内容" }
                },
                required: ["path", "content"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "edit_file",
            description: "补丁式编辑文件（禁止整文件覆盖）",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "文件路径（相对或绝对）" },
                    edits: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                oldText: { type: "string", description: "要替换的旧文本" },
                                newText: { type: "string", description: "替换后的新文本" }
                            },
                            required: ["oldText", "newText"]
                        },
                        description: "补丁数组（每个补丁包含 oldText 和 newText）"
                    }
                },
                required: ["path", "edits"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "bash",
            description: "执行命令",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "要执行的命令" }
                },
                required: ["command"],
                additionalProperties: false
            }
        }
    }
] as const;

export type AidocsToolDef = (typeof PI_ON_TOOLS)[number];

/**
 * 获取 LLM 可用工具列表（基于 workspace 配置）
 *
 * P5.6.8-R3b: PI 模式分叉
 * - pi.on: 返回四基础工具（read_file/write_file/edit_file/bash）
 * - pi.off: 返回空数组（普通 direct 聊天 + 记忆注入）
 *
 * @param workspacePath 工作区路径
 * @returns 工具定义数组（pi.on 为四工具，pi.off 为空）
 */
export async function getToolsForLlm(workspacePath?: string): Promise<readonly AidocsToolDef[]> {
    // 如果没有提供工作区路径，返回空数组（保守默认）
    if (!workspacePath) {
        return [];
    }

    try {
        const { loadWorkspaceConfig, DEFAULT_WORKSPACE_CONFIG } = await import("./config/workspace.js");
        const cfg = await loadWorkspaceConfig(workspacePath);

        // P5.6.8-R3b: PI 模式分叉
        // 口径修复：缺省时必须与 workspace 默认配置一致，避免 tools 被意外清空
        const piEnabled = cfg["pi.enabled"] ?? DEFAULT_WORKSPACE_CONFIG["pi.enabled"];

        if (piEnabled) {
            // pi.on: 四基础工具
            return PI_ON_TOOLS;
        } else {
            // pi.off: 空数组（普通 direct 聊天 + 记忆注入）
            return [];
        }
    } catch {
        // 读取配置失败时，保守返回空数组
        return [];
    }
}

const DEFAULT_ALLOWED_TOOL_NAMES = new Set(
    PI_ON_TOOLS.map(t => t.function.name)
);

export type ParsedToolCall = { name: string; args: Record<string, unknown> };

/**
 * Best-effort 工具调用解析（用于兼容部分模型的“非标准 tool call”输出）
 *
 * 目标：
 * - 永不抛异常（解析失败返回 null）
 * - 仅允许白名单工具名
 * - 兼容多种常见格式（JSON / name {json} / name(key=value) / <tool_call> XML）
 *
 * 背景：部分 GLM 模型会以不稳定格式输出工具调用，不能依赖单一格式解析。
 */
export function parseToolCallBestEffortFromText(params: {
    text: string;
    allowedToolNames?: Iterable<string>;
}): ParsedToolCall | null {
    try {
        const allowed = new Set(params.allowedToolNames ?? DEFAULT_ALLOWED_TOOL_NAMES);
        const raw = (params.text ?? "").trim();
        if (!raw) return null;

        // 1) XML-ish: <tool_call>name <arg_key>k</arg_key><arg_value>v</arg_value>...</tool_call>
        if (raw.includes("<tool_call>") || raw.includes("陈列")) {
            const parsed = parseXmlToolCall(raw, allowed);
            if (parsed) return parsed;
        }

        // 2) JSON-ish: [{"name":"x","arguments":{...}}] 或 {"function":{...}}
        {
            const jsonSnippet = extractFirstBalancedJsonSnippet(raw);
            if (jsonSnippet) {
                const parsed = parseJsonToolCall(jsonSnippet, allowed);
                if (parsed) return parsed;
            }
        }

        // 3) Inline: name { ...json... } 或 name\n{...}
        {
            const parsed = parseInlineNameAndJson(raw, allowed);
            if (parsed) return parsed;
        }

        // 4) Call-like: name(path="...", limit=5)
        {
            const parsed = parseParenStyleCall(raw, allowed);
            if (parsed) return parsed;
        }

        return null;
    } catch {
        return null;
    }
}

function parseXmlToolCall(text: string, allowed: Set<string>): ParsedToolCall | null {
    // 兼容历史“陈列...陈列/xxx”格式（旧模型输出）
    if (text.includes("陈列")) {
        const tokens = text.split("陈列").map(item => item.trim()).filter(Boolean);
        const name = tokens[0];
        if (!name || !allowed.has(name)) return null;

        const args: Record<string, unknown> = {};
        for (let i = 1; i < tokens.length; i += 2) {
            const key = tokens[i];
            const value = tokens[i + 1];
            if (!key || !value) break;
            if (key.startsWith("/")) break;
            if (value.startsWith("/")) break;
            args[key] = parseLooseValue(value);
        }
        return { name, args };
    }

    const idx = text.indexOf("<tool_call>");
    if (idx < 0) return null;
    const after = text.slice(idx + "<tool_call>".length).trimStart();
    const nameMatch = after.match(/^([a-zA-Z_][\w-]*)/);
    const name = nameMatch?.[1];
    if (!name || !allowed.has(name)) return null;

    const args: Record<string, unknown> = {};
    const re = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
    for (const m of after.matchAll(re)) {
        const key = (m[1] ?? "").trim();
        const valueRaw = (m[2] ?? "").trim();
        if (!key) continue;
        args[key] = parseLooseValue(valueRaw);
    }

    return { name, args };
}

function parseJsonToolCall(jsonSnippet: string, allowed: Set<string>): ParsedToolCall | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonSnippet);
    } catch {
        return null;
    }

    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!first || typeof first !== "object") return null;

    const obj = first as any;

    const name: string | undefined =
        (typeof obj.name === "string" ? obj.name : undefined) ??
        (typeof obj.tool === "string" ? obj.tool : undefined) ??
        (typeof obj.function?.name === "string" ? obj.function.name : undefined);

    if (!name || !allowed.has(name)) return null;

    const argsUnknown =
        obj.arguments ??
        obj.args ??
        obj.function?.arguments;

    const args = coerceArgs(argsUnknown);
    return { name, args };
}

function parseInlineNameAndJson(text: string, allowed: Set<string>): ParsedToolCall | null {
    const names = [...allowed].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
    if (!names) return null;
    const re = new RegExp(`\\b(${names})\\b[\\s\\r\\n]*([\\[{])`, "m");
    const m = text.match(re);
    const name = m?.[1];
    if (!name || !allowed.has(name)) return null;

    const start = m.index !== undefined ? m.index + m[0].lastIndexOf(m[2]!) : -1;
    if (start < 0) return null;
    const snippet = extractBalancedFromIndex(text, start);
    if (!snippet) return null;

    try {
        const obj = JSON.parse(snippet);
        const args = coerceArgs(obj);
        return { name, args };
    } catch {
        return null;
    }
}

function parseParenStyleCall(text: string, allowed: Set<string>): ParsedToolCall | null {
    const names = [...allowed].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
    if (!names) return null;
    const re = new RegExp(`\\b(${names})\\b\\s*\\(([^)]*)\\)`, "m");
    const m = text.match(re);
    const name = m?.[1];
    if (!name || !allowed.has(name)) return null;
    const inside = (m?.[2] ?? "").trim();
    const args: Record<string, unknown> = {};
    if (!inside) return { name, args };

    for (const partRaw of inside.split(",")) {
        const part = partRaw.trim();
        if (!part) continue;
        const kv = part.match(/^([a-zA-Z_][\w-]*)\s*=\s*(.+)$/);
        if (!kv) continue;
        const key = kv[1];
        const valueRaw = kv[2].trim();
        args[key] = parseLooseValue(valueRaw);
    }
    return { name, args };
}

function coerceArgs(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : {};
        } catch {
            return {};
        }
    }
    if (typeof value === "object") {
        return value as Record<string, unknown>;
    }
    return {};
}

function parseLooseValue(raw: string): unknown {
    const v = raw.trim();
    if (!v) return "";
    // JSON object/array
    if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) {
        try { return JSON.parse(v); } catch { /* ignore */ }
    }
    // quoted
    const dq = v.match(/^"([\s\S]*)"$/);
    if (dq) return dq[1];
    const sq = v.match(/^'([\s\S]*)'$/);
    if (sq) return sq[1];
    // number/bool/null
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "null") return null;
    const num = Number(v);
    if (!Number.isNaN(num) && Number.isFinite(num)) return num;
    return v;
}

function extractFirstBalancedJsonSnippet(text: string): string | null {
    const idxArr = text.indexOf("[");
    const idxObj = text.indexOf("{");
    const idx = idxArr < 0 ? idxObj : (idxObj < 0 ? idxArr : Math.min(idxArr, idxObj));
    if (idx < 0) return null;
    return extractBalancedFromIndex(text, idx);
}

function extractBalancedFromIndex(text: string, start: number): string | null {
    const open = text[start];
    const close = open === "[" ? "]" : (open === "{" ? "}" : null);
    if (!close) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === "\"") {
                inString = false;
                continue;
            }
            continue;
        }

        if (ch === "\"") {
            inString = true;
            continue;
        }
        if (ch === open) depth++;
        if (ch === close) depth--;
        if (depth === 0) {
            return text.slice(start, i + 1);
        }
    }
    return null;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tool Loop 配置选项
 */
export interface LmStudioToolLoopOptions {
    prompt: string;
    system?: string;
    tools?: readonly unknown[];
    allowRoot?: string;
    workspacePath?: string; // P0: 用于读取 workspace 配置以确定工具策略
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
    backendRuntime?: AgentBackendRuntime; // P5.7-R8b: 后端运行时配置
    // P5.6.8-R4b: 短期记忆上下文
    windowMessages?: Array<{ role: string; content?: string }>; // 历史窗口消息
    summaryContext?: string; // summary 格式化后的上下文
    // P5.6.8-R4e: SOUL 上下文（direct only）
    soulContext?: { content: string; source: string; path: string; chars: number };
    // P5.7-R3l-4: 追踪字段
    traceId?: string;  // 用于 journal 追踪
    route?: "tool" | "complex-tool";  // 用于 journal 路由标记
}

// ============================================
// P5.7-R3l-4: Action Journal 契约
// ============================================

/**
 * P5.7-R3l-4: Action Journal 条目类型
 *
 * 作为 report 阶段事实源，记录工具执行的完整诊断信息。
 */
export interface ActionJournalEntry {
    // 追踪字段
    traceId: string;           // 请求追踪 ID
    stepId: number;            // 步骤序号（单调递增）

    // 阶段字段
    phase: "plan" | "act" | "report";  // 所属阶段
    timestamp: number;         // 时间戳（Date.now()）

    // 路由字段
    route: "tool" | "complex-tool";  // 所属路由
    model?: string;            // 使用的模型

    // 工具字段
    tool: string;              // 工具名称
    ok: boolean;               // 成功与否
    exitCode?: number | null;  // 退出码（bash 工具）
    errorCode?: string;        // 错误码
    stdoutTail?: string;       // stdout 尾部
    fullOutputPath?: string;   // 完整输出文件路径

    // 诊断字段
    durationMs: number;        // 执行耗时
}

/**
 * Tool Loop 结果
 * P5.7-R3l-4: 必有 actionJournal（无工具时为空数组）
 */
export interface ToolLoopResult {
    answer: string;
    toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
    actionJournal: ActionJournalEntry[];  // 必有，无工具时为空数组
}

/**
 * 检测“伪工具执行”文本（模型未发起 tool_calls，却在正文伪造执行过程/结果）
 */
export function isLikelyFakeToolExecutionText(text: string): boolean {
    const input = (text || "").trim();
    if (!input) return false;

    // 显式工具标记：模型在正文伪造工具调用协议
    const hasExplicitToolMarker =
        /\[\/?TOOL_CALL\]/i.test(input) ||
        /<\/?tool_call>/i.test(input) ||
        /\btool\s*=>\s*["']?[a-z_][\w-]*/i.test(input) ||
        /\b(read_file|write_file|edit_file|bash)\s*\(/i.test(input);

    const hasShellFence = /```(?:bash|sh|zsh|shell)\b[\s\S]*?```/i.test(input);
    const hasExecutionCue =
        /(执行中|正在执行|命令输出|命令结果|已执行)/i.test(input) ||
        /(?:^|\n)\s*(?:pwd|ls|cat)\b/im.test(input) ||
        /\/home\/[^\s]*/.test(input);

    return hasExplicitToolMarker || (hasShellFence && hasExecutionCue);
}

/**
 * Tool 调用类型
 */
type ToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

type ToolChoice = "auto" | "none" | "required" | {
    type: "function";
    function: { name: string };
};

type ExecutedToolCall = {
    tc: ToolCall;
    args: Record<string, unknown>;
    result: unknown;
};

function clipText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}...`;
}

function buildToolLoopFallbackAnswer(
    executedToolCalls: ExecutedToolCall[],
    prompt: string
): string {
    if (executedToolCalls.length === 0) return "";
    const lastCall = executedToolCalls[executedToolCalls.length - 1];
    const toolName = lastCall.tc.function.name;
    const result = lastCall.result;

    if (toolName === "read_file") {
        const content = result
            && typeof result === "object"
            && typeof (result as Record<string, unknown>).content === "string"
            ? String((result as Record<string, unknown>).content)
            : "";

        if (!content.trim()) {
            return "文件读取成功，但内容为空。";
        }

        const wantsTop3 = /前\s*(3|三)\s*行/.test(prompt);
        const maxLines = wantsTop3 ? 3 : 20;
        const lines = content.replace(/\r\n/g, "\n").split("\n").slice(0, maxLines);
        const preview = clipText(lines.join("\n"), 2000).trim();

        if (wantsTop3) {
            return `读取成功，前3行如下：\n${preview}`;
        }
        return `读取成功，内容预览如下：\n${preview}`;
    }

    if (toolName === "bash") {
        const obj = (result && typeof result === "object")
            ? (result as Record<string, unknown>)
            : {};
        const stdout = typeof obj.stdout === "string" ? obj.stdout.trim() : "";
        const stderr = typeof obj.stderr === "string" ? obj.stderr.trim() : "";
        const exitCode = typeof obj.exitCode === "number" ? obj.exitCode : null;

        if (stdout) return clipText(stdout, 2000);
        if (stderr) return `命令执行完成（exitCode=${exitCode ?? "unknown"}），stderr：${clipText(stderr, 500)}`;
        if (exitCode !== null) return `命令执行完成（exitCode=${exitCode}）。`;
        return "命令执行完成。";
    }

    if (toolName === "write_file" || toolName === "edit_file") {
        return `${toolName} 执行成功。`;
    }

    return `工具执行成功：${toolName}`;
}

function detectPreferredToolName(
    prompt: string,
    tools: readonly unknown[]
): string | undefined {
    const input = (prompt || "").toLowerCase();
    if (!input) return undefined;

    const available = new Set<string>();
    for (const tool of tools) {
        if (!tool || typeof tool !== "object") continue;
        const fn = (tool as { function?: { name?: unknown } }).function;
        if (!fn || typeof fn.name !== "string") continue;
        available.add(fn.name);
    }
    const candidates = ["read_file", "write_file", "edit_file", "bash"] as const;
    for (const name of candidates) {
        if (!available.has(name)) continue;

        // 英文显式指名
        if (new RegExp(`\\b${name}\\b`, "i").test(input)) {
            return name;
        }

        // 中文常见表达：使用/用 xxx 工具
        if (new RegExp(`(?:使用|用)\\s*${name}\\s*工具`, "i").test(input)) {
            return name;
        }
    }
    return undefined;
}

function selectToolsByName(
    tools: readonly unknown[],
    toolName: string
): readonly unknown[] {
    return tools.filter((tool) => {
        if (!tool || typeof tool !== "object") return false;
        const fn = (tool as { function?: { name?: unknown } }).function;
        return !!fn && typeof fn.name === "string" && fn.name === toolName;
    });
}

/**
 * Chat 响应类型
 */
type ChatResponse = {
    choices: Array<{
        message?: {
            role?: string;
            content?: string;
            tool_calls?: ToolCall[];
        };
    }>;
};

/**
 * 解析路径并确保在 root 下（支持相对路径）
 */
function resolveUnderRoot(inputPath: string, root: string): string {
    const rootAbs = path.resolve(root);
    const candidate = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(rootAbs, inputPath);

    if (!(candidate === rootAbs || candidate.startsWith(rootAbs + path.sep))) {
        throw new Error(`路径越界: ${inputPath} 不在 ${rootAbs} 下`);
    }
    return candidate;
}

/**
 * 执行工具（P5.6.8-R3a: 统一走 Tool Bus）
 *
 * P5.6.8-R4h: 返回完整错误信息（包含 errorCode）
 * P5.7-R3h: 透传诊断字段（exitCode/stderrTail/fullOutputPath）
 */
type ToolRunResult = {
    data?: unknown;
    error?: string;
    errorCode?: string;
    exitCode?: number | null;
    stderrTail?: string;
    stdoutTail?: string;
    fullOutputPath?: string;
    durationMs: number;
};

/**
 * read_file 参数纠偏：
 * - 用户常说“读取 SOUL 文件”，模型可能生成 <workspace>/SOUL.md（缺少 .msgcode）
 * - 若目标不存在且命中 SOUL.md，则自动改写为 <workspace>/.msgcode/SOUL.md
 */
async function normalizeReadFilePathArgs(
    toolName: string,
    args: Record<string, unknown>,
    workspacePath: string
): Promise<Record<string, unknown>> {
    if (toolName !== "read_file") return args;

    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    if (!rawPath) return args;
    if (!/(^|\/)soul\.md$/i.test(rawPath)) return args;

    const requestedAbs = path.isAbsolute(rawPath)
        ? path.resolve(rawPath)
        : path.resolve(workspacePath, rawPath);

    try {
        await fsPromises.access(requestedAbs);
        return args;
    } catch {
        // 继续尝试 .msgcode/SOUL.md 兜底
    }

    const fallbackAbs = path.resolve(workspacePath, ".msgcode", "SOUL.md");
    try {
        await fsPromises.access(fallbackAbs);
    } catch {
        return args;
    }

    logger.info("read_file path normalized for SOUL.md", {
        module: "lmstudio",
        inputPath: rawPath,
        normalizedPath: fallbackAbs,
    });

    return {
        ...args,
        path: fallbackAbs,
    };
}

async function runTool(name: string, args: Record<string, unknown>, root: string): Promise<ToolRunResult> {
    const { executeTool } = await import("./tools/bus.js");
    const { randomUUID } = await import("node:crypto");
    const normalizedArgs = await normalizeReadFilePathArgs(name, args, root);

    const result = await executeTool(name as any, normalizedArgs, {
        workspacePath: root,
        source: "llm-tool-call",
        requestId: `lmstudio-${randomUUID()}`,
    });

    if (!result.ok) {
        // P5.7-R3h: 透传诊断字段（exitCode/stderrTail/fullOutputPath）
        return {
            error: result.error?.message || "tool execution failed",
            errorCode: result.error?.code || "TOOL_EXEC_FAILED",
            exitCode: result.exitCode ?? null,
            stderrTail: result.stderrTail ?? "",
            stdoutTail: result.stdoutTail ?? "",
            fullOutputPath: result.fullOutputPath,
            durationMs: result.durationMs,
        };
    }

    return {
        data: result.data || { success: true },
        durationMs: result.durationMs,
    };
}

/**
 * Tool Loop 主函数
 *
 * 流程：
 * 1. 第一次请求带 tools + tool_choice:"auto"
 * 2. 若返回 tool_calls：顺序执行并回灌 role:"tool"
 * 3. 若模型继续返回 tool_calls：持续进入下一轮（多轮闭环）
 * 4. 当模型不再返回 tool_calls：输出最终回答并走清洗链
 */
export async function runLmStudioToolLoop(options: LmStudioToolLoopOptions): Promise<ToolLoopResult> {
    // P5.7-R3g: 每轮工具步数上限
    const MAX_TOOL_CALLS_PER_TURN = 8;
    const MAX_TOOL_STEPS_TOTAL = 24;

    const backendRuntime = options.backendRuntime || resolveAgentBackendRuntime();
    const baseUrl = options.baseUrl || normalizeBaseUrl(backendRuntime.baseUrl);
    const modelOverride = normalizeModelOverride(options.model);
    const backendDefaultModel = normalizeModelOverride(backendRuntime.model);
    const model = modelOverride
        ?? backendDefaultModel
        ?? (backendRuntime.nativeApiEnabled
            ? await resolveLmStudioModelId({
                baseUrl,
                configuredModel: backendRuntime.model,
                apiKey: backendRuntime.apiKey,
                timeoutMs: backendRuntime.timeoutMs,
            })
            : undefined);
    if (!model) {
        throw new Error(`Agent backend(${backendRuntime.id}) 未配置模型。请设置 AGENT_MODEL 或对应后端模型变量。`);
    }
    const timeoutMs = options.timeoutMs || backendRuntime.timeoutMs;
    const root = options.allowRoot || config.workspaceRoot || AIDOCS_ROOT;

    // P5.7-R3l-4: 初始化 actionJournal
    const actionJournal: ActionJournalEntry[] = [];
    let stepId = 0;
    const traceId = options.traceId || crypto.randomUUID().slice(0, 8);
    const route = options.route || "tool";

    // P5.7-R3l-2: 使用 buildExecSystemPrompt（exec 链路禁止 SOUL 注入）
    const baseSystem = await resolveBaseSystemPrompt(options.system);
    const workspacePath = options.workspacePath || root;
    const useMcp = backendRuntime.nativeApiEnabled && process.env.LMSTUDIO_ENABLE_MCP === "1" && !!workspacePath;
    let system = buildExecSystemPrompt(baseSystem, useMcp);

    try {
        const { existsSync } = await import("node:fs");
        const { join } = await import("node:path");
        const os = await import("node:os");

        const globalSkillIndexPath = join(os.homedir(), ".config", "msgcode", "skills", "index.json");
        const workspaceSkillIndexPath = join(workspacePath, ".msgcode", "skills", "index.json");

        let skillHint = "\n\n[技能系统]\n";

        if (existsSync(globalSkillIndexPath)) {
            try {
                const indexContent = await fsPromises.readFile(globalSkillIndexPath, "utf-8");
                const index = JSON.parse(indexContent);
                if (index.skills && Array.isArray(index.skills) && index.skills.length > 0) {
                    skillHint += `全局技能：${index.skills.map((s: any) => s.id).join(", ")}\n`;
                }
            } catch {
                // 忽略读取错误
            }
        }

        if (existsSync(workspaceSkillIndexPath)) {
            try {
                const indexContent = await fsPromises.readFile(workspaceSkillIndexPath, "utf-8");
                const index = JSON.parse(indexContent);
                if (index.skills && Array.isArray(index.skills) && index.skills.length > 0) {
                    skillHint += `工作区技能：${index.skills.map((s: any) => s.id).join(", ")}\n`;
                }
            } catch {
                // 忽略读取错误
            }
        }

        skillHint += "调用方式：read_file 读取技能文件（~/.config/msgcode/skills/<id>/main.sh 或 <workspace>/.msgcode/skills/<id>/main.sh），bash 执行";

        system += skillHint;
    } catch {
        // 忽略 skill 索引注入错误
    }

    // P5.7-R3l-2: exec 链路禁止注入 SOUL（已移除 SOUL 注入逻辑）

    const messages: Array<{ role: string; content?: string; tool_call_id?: string; tool_calls?: ToolCall[] }> = [];

    if (system && system.trim()) {
        messages.push({ role: "system", content: system.trim() });
    }

    // P5.6.8-R4b: 注入短期记忆上下文
    // 1. 如果有 summary，作为历史上下文注入
    if (options.summaryContext && options.summaryContext.trim()) {
        // 将 summary 作为 assistant 的历史总结注入
        messages.push({
            role: "assistant",
            content: `[历史对话摘要]\n${options.summaryContext}`
        });
    }

    // 2. 注入最近的窗口消息（有预算限制）
    const MAX_WINDOW_MESSAGES = 20; // 最多保留 20 条历史消息
    const MAX_CONTEXT_CHARS = 8000; // 历史上下文最大字符数

    if (options.windowMessages && options.windowMessages.length > 0) {
        let totalChars = 0;
        const recentMessages = options.windowMessages.slice(-MAX_WINDOW_MESSAGES);

        for (const msg of recentMessages) {
            const msgChars = msg.content?.length || 0;
            if (totalChars + msgChars > MAX_CONTEXT_CHARS) {
                // 超预算，停止注入
                break;
            }
            messages.push({
                role: msg.role,
                content: msg.content
            });
            totalChars += msgChars;
        }
    }

    // 3. 注入当前用户输入
    messages.push({ role: "user", content: options.prompt });

    // P0: 获取基于 workspace 配置的工具列表（explicit 模式下为空）
    const workspaceRootForTools = options.workspacePath || root;
    const tools = options.tools ?? await getToolsForLlm(workspaceRootForTools);
    const preferredToolName = detectPreferredToolName(options.prompt, tools);
    const preferredToolChoice: ToolChoice | undefined = preferredToolName
        ? { type: "function", function: { name: preferredToolName } }
        : undefined;
    const constrainedTools = preferredToolName
        ? selectToolsByName(tools, preferredToolName)
        : tools;
    const activeTools = constrainedTools.length > 0 ? constrainedTools : tools;
    if (preferredToolName) {
        logger.info("Tool preference detected from prompt", {
            module: "lmstudio",
            preferredToolName,
            constrainedToolCount: activeTools.length,
        });
    }

    // 1) 第一次：允许工具调用
    const r1 = await callChatCompletionsRaw({
        baseUrl,
        model,
        messages,
        tools: activeTools,
        toolChoice: preferredToolChoice ?? "auto",
        temperature: 0,
        maxTokens: 800,
        timeoutMs,
        apiKey: backendRuntime.apiKey,
    });

    let msg1 = r1.choices[0]?.message;
    let toolCalls = msg1?.tool_calls ?? [];

    // 首轮无 tool_calls：强制协议重试一次（toolChoice=required）
    // 目标：降低部分后端/模型在 auto 模式下漏发 tool_calls 的概率。
    if (toolCalls.length === 0 && activeTools.length > 0) {
        logger.warn("Tool protocol retry started", {
            module: "lmstudio",
            stage: "required-retry",
            toolCallCount: 0,
        });

        try {
            const retryMessages = [
                ...messages,
                {
                    role: "user" as const,
                    content: "工具调用重试：请严格返回一次 tool_calls；不要输出自然语言。",
                },
            ];

            const retry = await callChatCompletionsRaw({
                baseUrl,
                model,
                messages: retryMessages,
                tools: activeTools,
                toolChoice: preferredToolChoice ?? "required",
                temperature: 0,
                maxTokens: 800,
                timeoutMs,
                apiKey: backendRuntime.apiKey,
            });

            msg1 = retry.choices[0]?.message;
            toolCalls = msg1?.tool_calls ?? [];

            if (toolCalls.length > 0) {
                logger.info("Tool protocol retry succeeded", {
                    module: "lmstudio",
                    stage: "required-retry",
                    toolCallCount: toolCalls.length,
                });
            } else {
                logger.warn("Tool protocol retry returned no tool_calls", {
                    module: "lmstudio",
                    stage: "required-retry",
                    toolCallCount: 0,
                });
            }
        } catch (error) {
            logger.warn("Tool protocol retry failed", {
                module: "lmstudio",
                stage: "required-retry",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // 第二次仍无 tool_calls：降上下文做一次严格协议兜底
    // 目标：减少长上下文/历史对工具调用协议的干扰。
    if (toolCalls.length === 0 && activeTools.length > 0) {
        try {
            const strictSystem = `${system}\n\n[工具协议兜底]\n只返回 tool_calls；禁止自然语言。`;
            const strictMessages: Array<{ role: string; content?: string }> = [];
            if (strictSystem.trim()) {
                strictMessages.push({ role: "system", content: strictSystem.trim() });
            }
            strictMessages.push({ role: "user", content: options.prompt });

            const strictRetry = await callChatCompletionsRaw({
                baseUrl,
                model,
                messages: strictMessages,
                tools: activeTools,
                toolChoice: preferredToolChoice ?? "required",
                temperature: 0,
                maxTokens: 400,
                timeoutMs,
                apiKey: backendRuntime.apiKey,
            });

            msg1 = strictRetry.choices[0]?.message;
            toolCalls = msg1?.tool_calls ?? [];

            if (toolCalls.length > 0) {
                logger.info("Tool protocol strict fallback succeeded", {
                    module: "lmstudio",
                    stage: "strict-fallback",
                    toolCallCount: toolCalls.length,
                });
            } else {
                logger.warn("Tool protocol strict fallback returned no tool_calls", {
                    module: "lmstudio",
                    stage: "strict-fallback",
                    toolCallCount: 0,
                });
            }
        } catch (error) {
            logger.warn("Tool protocol strict fallback failed", {
                module: "lmstudio",
                stage: "strict-fallback",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // 2) P5.7-R1: 只认标准 tool_calls，移除文本兜底解析
    const executedToolCalls: ExecutedToolCall[] = [];
    let currentAssistantRole = msg1?.role || "assistant";
    let currentAssistantContent = msg1?.content;

    const isPreferredToolMismatch = (
        preferredToolName
        && toolCalls.length > 0
        && toolCalls.some((tc) => tc.function.name !== preferredToolName)
    );

    // 显式工具名不匹配：先做一次纠偏重试
    if (isPreferredToolMismatch) {
        logger.warn("Preferred tool mismatch detected", {
            module: "lmstudio",
            preferredToolName,
            returnedToolNames: toolCalls.map((tc) => tc.function.name),
        });

        try {
            const correctionMessages: Array<{ role: string; content?: string }> = [];
            if (system && system.trim()) {
                correctionMessages.push({ role: "system", content: system.trim() });
            }
            correctionMessages.push({
                role: "user",
                content: `你必须且只能调用 ${preferredToolName} 工具。任务：${options.prompt}`,
            });

            const correction = await callChatCompletionsRaw({
                baseUrl,
                model,
                messages: correctionMessages,
                tools: activeTools,
                toolChoice: preferredToolChoice ?? "required",
                temperature: 0,
                maxTokens: 400,
                timeoutMs,
                apiKey: backendRuntime.apiKey,
            });

            msg1 = correction.choices[0]?.message;
            toolCalls = msg1?.tool_calls ?? [];
        } catch (error) {
            logger.warn("Preferred tool mismatch correction failed", {
                module: "lmstudio",
                preferredToolName,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // 纠偏后仍不匹配：拒绝执行错误工具，避免“假成功”
    if (
        preferredToolName
        && toolCalls.length > 0
        && toolCalls.some((tc) => tc.function.name !== preferredToolName)
    ) {
        logger.warn("Preferred tool mismatch persisted", {
            module: "lmstudio",
            preferredToolName,
            returnedToolNames: toolCalls.map((tc) => tc.function.name),
        });
        return {
            answer: `工具协议失败：期望调用 ${preferredToolName}，但模型返回了其他工具。请重试。`,
            actionJournal: [],
        };
    }

    // 无工具调用：硬失败（P5.7-R3l-1: tool 协议硬门）
    // P5.7-R3h: 区分模型协议失败（无 tool_calls）与工具执行失败
    if (toolCalls.length === 0) {
        // P5.7-R3l-1: tool 路由下 toolCallCount=0 一律硬失败，禁止 cleanedAnswer 透传
        logger.info("Tool protocol hard-gate triggered (MODEL_PROTOCOL_FAILED)", {
            module: "lmstudio",
            toolCallCount: 0,
            errorCode: "MODEL_PROTOCOL_FAILED",  // 协议层未返回工具调用
            assistantContentLength: currentAssistantContent?.length ?? 0,
        });

        // P5.7-R3l-1: 硬失败回执（详细版，含错误码和解释）
        return {
            answer: `协议失败：未收到工具调用指令\n- 错误码：MODEL_PROTOCOL_FAILED\n\n这通常意味着模型无法调用工具。请重试或切换到对话模式。`,
            actionJournal: [],  // P5.7-R3l-4: 硬失败场景返回空数组
        };
    }

    let currentToolCalls = toolCalls;
    let conversationMessages = [...messages];
    let finalAssistantContent = "";

    while (true) {
        // P5.7-R3g: 上限保护 - 单轮超过步数直接拒绝
        if (currentToolCalls.length > MAX_TOOL_CALLS_PER_TURN) {
            logger.warn("Tool loop limit exceeded", {
                module: "lmstudio",
                requestedToolCalls: currentToolCalls.length,
                maxToolCallsPerTurn: MAX_TOOL_CALLS_PER_TURN,
                toolNames: currentToolCalls.map(tc => tc.function.name),
                errorCode: "TOOL_LOOP_LIMIT_EXCEEDED",
            });

            return {
                answer: `工具调用次数超过上限\n- 请求数：${currentToolCalls.length}\n- 上限：${MAX_TOOL_CALLS_PER_TURN}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n请简化任务或分步执行。`,
                actionJournal: [],
            };
        }

        const roundExecutedToolCalls: ExecutedToolCall[] = [];

        // P5.7-R3g: 顺序执行本轮所有工具调用
        for (const tc of currentToolCalls) {
            let args: Record<string, unknown> = {};
            try {
                args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
                args = {};
            }

            let toolResult: ToolRunResult;
            try {
                toolResult = await runTool(tc.function.name, args, workspacePath);
            } catch (e) {
                toolResult = {
                    error: e instanceof Error ? e.message : String(e),
                    errorCode: "TOOL_EXEC_FAILED",
                    durationMs: 0,
                };
            }

            // 失败短路
            if (toolResult.error) {
                const toolErrorCode = toolResult.errorCode || "TOOL_EXEC_FAILED";
                const toolErrorMessage = toolResult.error || "工具执行失败";

                logger.info("Tool loop failed (short-circuit)", {
                    module: "lmstudio",
                    toolCallCount: executedToolCalls.length + 1,
                    toolName: tc.function.name,
                    toolErrorCode: toolErrorCode,
                    toolErrorMessage: toolErrorMessage,
                    toolExitCode: toolResult.exitCode ?? null,
                    toolHasStderr: !!toolResult.stderrTail,
                    toolFullOutputPath: toolResult.fullOutputPath,
                });

                let answerText = `工具执行失败\n- 工具: ${tc.function.name}\n- 错误码: ${toolErrorCode}\n- 错误: ${toolErrorMessage}`;
                if (toolResult.exitCode !== undefined && toolResult.exitCode !== null) {
                    answerText += `\n- 退出码: ${toolResult.exitCode}`;
                }
                if (toolResult.stderrTail) {
                    const stderrPreview = toolResult.stderrTail.length > 200 ? toolResult.stderrTail.slice(-200) : toolResult.stderrTail;
                    answerText += `\n- stderr 尾部: ${stderrPreview}`;
                }
                if (toolResult.fullOutputPath) {
                    answerText += `\n- 完整日志: ${toolResult.fullOutputPath}`;
                }

                stepId++;
                actionJournal.push({
                    traceId,
                    stepId,
                    phase: "act",
                    timestamp: Date.now(),
                    route,
                    model,
                    tool: tc.function.name,
                    ok: false,
                    exitCode: toolResult.exitCode ?? undefined,
                    errorCode: toolErrorCode,
                    stdoutTail: toolResult.stdoutTail ?? undefined,
                    fullOutputPath: toolResult.fullOutputPath ?? undefined,
                    durationMs: toolResult.durationMs,
                });

                return {
                    answer: answerText,
                    toolCall: { name: tc.function.name, args, result: toolResult },
                    actionJournal,
                };
            }

            const successResult = toolResult.data;
            const executed: ExecutedToolCall = { tc, args, result: successResult };
            executedToolCalls.push(executed);
            roundExecutedToolCalls.push(executed);

            // P5.7-R3l-4: 收集 actionJournal
            stepId++;
            actionJournal.push({
                traceId,
                stepId,
                phase: "act",
                timestamp: Date.now(),
                route,
                model,
                tool: tc.function.name,
                ok: true,
                exitCode: undefined,
                errorCode: undefined,
                stdoutTail: undefined,
                fullOutputPath: undefined,
                durationMs: toolResult.durationMs,
            });

            if (executedToolCalls.length > MAX_TOOL_STEPS_TOTAL) {
                logger.warn("Tool loop total step limit exceeded", {
                    module: "lmstudio",
                    totalToolCalls: executedToolCalls.length,
                    maxToolCallsTotal: MAX_TOOL_STEPS_TOTAL,
                    errorCode: "TOOL_LOOP_LIMIT_EXCEEDED",
                });

                return {
                    answer: `工具调用总次数超过上限\n- 总请求数：${executedToolCalls.length}\n- 上限：${MAX_TOOL_STEPS_TOTAL}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n请简化任务或分步执行。`,
                    actionJournal,
                };
            }
        }

        // 构建本轮 assistant + tool_result 回灌消息
        const assistantMsg: { role: string; content?: string; tool_calls?: ToolCall[] } = {
            role: currentAssistantRole,
            tool_calls: currentToolCalls,
        };
        if (currentAssistantContent !== undefined) {
            assistantMsg.content = currentAssistantContent;
        }

        const toolResultMessages = roundExecutedToolCalls.map(({ tc, result }) => ({
            role: "tool" as const,
            tool_call_id: tc.id,
            content: typeof result === "string" ? result : JSON.stringify(result)
        }));

        conversationMessages = [
            ...conversationMessages,
            assistantMsg,
            ...toolResultMessages,
        ];

        const nextRound = await callChatCompletionsRaw({
            baseUrl,
            model,
            messages: conversationMessages,
            tools: activeTools,
            toolChoice: preferredToolChoice ?? "auto",
            temperature: 0,
            maxTokens: 800,
            timeoutMs,
            apiKey: backendRuntime.apiKey,
        });

        const nextMsg = nextRound.choices[0]?.message;
        currentAssistantRole = nextMsg?.role || "assistant";
        currentAssistantContent = nextMsg?.content;
        currentToolCalls = nextMsg?.tool_calls ?? [];

        if (currentToolCalls.length === 0) {
            finalAssistantContent = currentAssistantContent ?? "";
            break;
        }

        logger.info("Tool loop continues with follow-up tool calls", {
            module: "lmstudio",
            nextToolCallCount: currentToolCalls.length,
            nextToolNames: currentToolCalls.map((tc) => tc.function.name),
        });
    }

    const cleanedAnswer = sanitizeLmStudioOutput(finalAssistantContent);
    let finalAnswer = cleanedAnswer;

    if (!cleanedAnswer || hasToolProtocolArtifacts(cleanedAnswer)) {
        const fallbackAnswer = buildToolLoopFallbackAnswer(executedToolCalls, options.prompt);
        if (fallbackAnswer) {
            logger.warn("Tool loop summary fallback activated", {
                module: "lmstudio",
                reason: !cleanedAnswer ? "empty-summary" : "protocol-artifact",
                toolCallCount: executedToolCalls.length,
                toolNames: executedToolCalls.map(({ tc }) => tc.function.name),
            });
            finalAnswer = fallbackAnswer;
        } else {
            // 兜底：在无可展示摘要且无法通过工具结果构建答案时，强制一次总结收口
            try {
                const summaryMessages = [
                    ...conversationMessages,
                    { role: currentAssistantRole, content: currentAssistantContent ?? "" },
                ];
                const summaryRetry = await callChatCompletionsRaw({
                    baseUrl,
                    model,
                    messages: summaryMessages,
                    tools: [],
                    toolChoice: "none",
                    temperature: 0,
                    maxTokens: 800,
                    timeoutMs,
                    apiKey: backendRuntime.apiKey,
                });
                const retryAnswer = sanitizeLmStudioOutput(summaryRetry.choices[0]?.message?.content ?? "");
                if (retryAnswer && !hasToolProtocolArtifacts(retryAnswer)) {
                    finalAnswer = retryAnswer;
                }
            } catch (error) {
                logger.warn("Tool loop summary retry failed", {
                    module: "lmstudio",
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    // P5.7-R3g: 日志增加 toolCallCount 与每个 toolName 列表
    const toolCallCount = executedToolCalls.length;
    const toolNames = executedToolCalls.map(({ tc }) => tc.function.name);
    // P5.7-R3h: 增加 toolCallIds 列表
    const toolCallIds = executedToolCalls.map(({ tc }) => tc.id);

    // 提取最后一个工具的 exitCode（如果存在）
    let exitCode: number | null = null;
    const lastResult = executedToolCalls[executedToolCalls.length - 1]?.result;
    if (lastResult && typeof lastResult === "object") {
        const result = lastResult as Record<string, unknown>;
        if ("exitCode" in result) {
            exitCode = typeof result.exitCode === "number" ? result.exitCode : null;
        }
    }

    // P5.7-R3h: 日志增加 toolCallIds 和每个工具的 exitCode 列表
    const toolExitCodes = executedToolCalls.map(({ result }) => {
        if (result && typeof result === "object") {
            const r = result as Record<string, unknown>;
            return r.exitCode ?? null;
        }
        return null;
    });

    logger.info("Tool loop completed", {
        module: "lmstudio",
        toolCallCount,
        toolNames,
        toolCallIds,  // P5.7-R3h: 增加 toolCallIds
        toolExitCodes,  // P5.7-R3h: 增加每个工具的 exitCode
        exitCode,  // 最后一个工具的 exitCode（兼容旧字段）
    });

    // P5.7-R3g: 返回第一个工具调用信息（兼容旧接口）
    // P5.7-R3l-4: 返回 actionJournal
    const firstCall = executedToolCalls[0];
    return {
        answer: finalAnswer,
        toolCall: firstCall
            ? { name: firstCall.tc.function.name, args: firstCall.args, result: firstCall.result }
            : undefined,
        actionJournal,  // P5.7-R3l-4: 必有，无工具时为空数组
    };
}

/**
 * 调用 OpenAI 兼容 /v1/chat/completions（返回原始 JSON）
 * P5.6.13-R1A-EXEC R3: 使用 provider adapter 契约
 */
async function callChatCompletionsRaw(params: {
    baseUrl: string;
    model: string;
    messages: Array<{ role: string; content?: string; tool_call_id?: string; tool_calls?: ToolCall[] }>;
    tools: readonly unknown[];
    toolChoice: ToolChoice;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    apiKey?: string;
}): Promise<ChatResponse> {
    const url = `${params.baseUrl}/v1/chat/completions`;

    // 添加 stop 参数，防止工具调用标签后继续输出
    // 只在工具调用模式时添加，最终回答模式不需要
    const stop = params.toolChoice === "none" ? undefined : ["[END_TOOL_REQUEST]"];

    // P5.6.13-R1A-EXEC R3: 使用 adapter 契约构建请求体
    const body = buildChatCompletionRequest({
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        toolChoice: params.toolChoice,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
        stop,
    });

    const rawText = await fetchTextWithTimeout({
        url,
        method: "POST",
        timeoutMs: params.timeoutMs,
        headers: { "content-type": "application/json" },
        body,
        apiKey: params.apiKey,
    });

    // P5.6.13-R1A-EXEC R3: 使用 adapter 契约解析响应
    const parsed = parseChatCompletionResponse(rawText);

    if (parsed.error) {
        throw new Error(`LM Studio API 错误：${parsed.error}`);
    }

    // 重建 ChatResponse 格式（兼容现有调用方）
    const json: ChatResponse = {
        choices: [{
            message: {
                role: "assistant",
                content: parsed.content ?? undefined,
                tool_calls: parsed.toolCalls.length > 0
                    ? parsed.toolCalls.map((tc, idx) => ({
                        id: tc.id || `tool_call_${idx}`,
                        type: "function",
                        function: {
                            name: tc.name,
                            arguments: tc.arguments,
                        },
                    }))
                    : undefined,
            },
        }],
    };

    return json;
}

/**
 * 路由分类系统提示（Phase-0）
 *
 * 约束：只允许输出 JSON，避免分类阶段污染主回答。
 */
const ROUTE_CLASSIFIER_SYSTEM_PROMPT = [
    "你是消息路由分类器，只输出 JSON，不要输出任何额外文本。",
    "返回格式：{\"route\":\"no-tool|tool|complex-tool\",\"confidence\":\"high|medium|low\",\"reason\":\"简短原因\"}",
    "判定规则：",
    "- 纯问答/闲聊/解释 = no-tool",
    "- 需要读取文件、查看目录、执行命令、统计文件、调用工具 = tool",
    "- 只要请求涉及真实环境读取/执行（即使是疑问句，如“你能读取xxx吗”）= tool",
    "- 多步骤且需要工具（先A再B、分析+执行+总结） = complex-tool",
].join("\n");

function looksLikeShellCommand(prompt: string): boolean {
    const text = (prompt || "").trim().toLowerCase();
    if (!text) return false;

    // 常见 shell 管道/连接符
    if (/[;&|]{1,2}|[<>]/.test(text)) return true;

    // 常见命令前缀（支持“Q 用 bash 执行 ...”这类描述）
    const commandRegex = /\b(bash|sh|zsh|pwd|ls|cat|echo|grep|find|sed|awk|curl|wget|sleep|cd|mkdir|rm|cp|mv|git|npm|pnpm|yarn|bun|node|python|uv|ps|kill|pkill|chmod|chown|tail|head)\b/;
    if (commandRegex.test(text)) return true;

    return false;
}

/**
 * Phase-0: 模型先做意图分类（失败回退规则分类）
 */
async function classifyRouteModelFirst(params: {
    prompt: string;
    toolsAllowed: boolean;
    workspacePath?: string;
    model?: string;
    backendRuntime?: AgentBackendRuntime;
    windowMessages?: Array<{ role: string; content?: string }>;
    summaryContext?: string;
}): Promise<{ classification: RouteClassification; source: "model" | "model-fallback" }> {
    // 无工具可用时直接 no-tool（非规则分类，属于能力边界）
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

    // 命令形态请求优先走 tool，避免模型分类抖动导致误分流
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
            // 分类器不注入 SOUL，避免人格影响路由判定
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
// P5.7-R3e: 双模型路由分发
// ============================================

/**
 * P5.7-R3e: 路由聊天选项
 */
export interface LmStudioRoutedChatOptions {
    prompt: string;
    system?: string;
    workspacePath?: string;
    agentProvider?: string; // P5.7-R8b: 当前工作区后端（lmstudio/openai/minimax/agent-backend）
    windowMessages?: Array<{ role: string; content?: string }>;
    summaryContext?: string;
    soulContext?: { content: string; source: string; path: string; chars: number };
    hasToolsAvailable?: boolean;
    temperature?: number; // 可选覆盖温度
}

/**
 * P5.7-R3e: 路由聊天结果
 * P5.7-R3l-4: 必有 actionJournal（结构一致锁）
 */
export interface RoutedChatResult {
    answer: string;
    route: "no-tool" | "tool" | "complex-tool";
    temperature: number;
    toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
    actionJournal: ActionJournalEntry[];  // P5.7-R3l-4: 必有，无工具时为空数组
}

/**
 * P5.7-R3e: 路由分发聊天
 * P5.7-R3l-3: 显式 plan -> act -> report 管道与阶段顺序日志锁
 *
 * 根据请求类型选择不同的处理路径：
 * - no-tool: 直接聊天（temperature=0.2，允许更多创造性，使用 responder 模型）
 * - tool: 工具循环（temperature=0，稳定触发，使用 executor 模型）
 * - complex-tool: 先计划再执行再收口（串行，使用 executor 模型）
 *
 * @param options 聊天选项
 * @returns 聊天结果（包含路由信息和温度）
 */
export async function runLmStudioRoutedChat(options: LmStudioRoutedChatOptions): Promise<RoutedChatResult> {
    // P5.7-R3l-3: 生成 traceId 用于阶段顺序追踪
    const traceId = crypto.randomUUID().slice(0, 8);
    const backendRuntime = resolveAgentBackendRuntime(options.agentProvider);

    // P5.7-R3k: 检查降级状态
    const degradeState = getDegradeState();
    const isDegrading = degradeState.level !== "LEVEL_0";

    // 1. 解析链路模型
    // 单源化规则：
    // - 若后端模型已显式配置（AGENT_MODEL/MINIMAX_MODEL/OPENAI_MODEL/LMSTUDIO_MODEL），
    //   则分类器 + no-tool + tool + complex-tool 全链路统一该模型。
    // - 否则回退到 workspace 的 executor/responder 配置（双模型模式）。
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
            const { getExecutorModel, getResponderModel } = await import("./config/workspace.js");
            executorModel = normalizeModelOverride(await getExecutorModel(workspacePath));
            responderModel = normalizeModelOverride(await getResponderModel(workspacePath));
        } catch {
            // 读取失败，使用 undefined（会 fallback 到默认模型）
        }
    }

    // 2. 分类请求路由（Phase-0: 模型先判定，失败回退规则）
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

    // 3. 获取温度（允许覆盖）
    const temperature = options.temperature ?? getTemperatureForRoute(route);

    // P5.7-R3k: 根据降级状态选择模型
    const { model: selectedModel, level: selectedLevel } = selectModelByDegrade(
        executorModel || "default-executor",
        responderModel || "default-responder"
    );

    // soul 注入观测：
    // - dialog 链路允许注入
    // - exec/tool 链路禁止注入
    const dialogSoulInjected = !!(options.soulContext && options.soulContext.content);
    const execSoulInjected = false;

    // P5.7-R3l-3: 入口日志（phase=init，kernel=router）
    // P5.7-R3l-5: 观测字段锁 - 包含 soulInjected
    logger.info("routed chat started", {
        module: "lmstudio",
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

    // 3. 根据路由分发
    // P5.7-R3j-1: 路由约束固化 - no-tool 只走 responder，tool/complex-tool 只走 executor
    // P5.7-R3k: 降级策略 - LEVEL_2 时强制降级为 no-tool

    if (route === "no-tool" || selectedLevel === "LEVEL_2") {
        // no-tool: 简单聊天（不触发工具循环，使用 responder 模型 + temperature=0.2）
        // P5.7-R3j-1: 显式绑定 responder 模型
        // P5.7-R3k: LEVEL_2 降级时，所有请求都走这里（纯文本模式）
        const usedModel = selectedLevel === "LEVEL_2"
            ? selectedModel  // 降级时使用选中的模型
            : responderModel;
        const usedTemperature = selectedLevel === "LEVEL_2"
            ? 0.2  // 纯文本模式使用创造性温度
            : 0.2;  // P5.7-R3j-2: 硬锁温度

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

        // no-tool 回答中出现伪工具调用标记时，自动回切真实 tool loop，避免把伪协议文本回给用户
        const leakedToolIntent =
            toolsAllowed &&
            selectedLevel === "LEVEL_0" &&
            isLikelyFakeToolExecutionText(answer);

        if (leakedToolIntent) {
            logger.warn("no-tool response contained fake tool-call marker, rerouting to tool loop", {
                module: "lmstudio",
                traceId,
                route: "no-tool",
                phase: "recover",
                kernel: "router",
                soulInjected: execSoulInjected,
                agentBackend: backendRuntime.id,
            });

            const recoveredToolLoop = await runLmStudioToolLoop({
                prompt: options.prompt,
                system: options.system,
                workspacePath: options.workspacePath,
                // 工具链路使用最小上下文，避免历史/人格污染协议
                windowMessages: undefined,
                summaryContext: undefined,
                soulContext: undefined,
                model: executorModel,
                backendRuntime,
                traceId,
                route: "tool",
            });

            logger.info("routed chat completed", {
                module: "lmstudio",
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

        // P5.7-R3l-3: no-tool 完成日志（phase=complete，kernel=dialog）
        // P5.7-R3l-5: 观测字段锁 - 包含 soulInjected
        logger.info("routed chat completed", {
            module: "lmstudio",
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
            actionJournal: [],  // P5.7-R3l-4: no-tool 路由返回空数组
        };
    }

    // P5.7-R3e-hotfix: complex-tool 先计划再执行再收口
    // P5.7-R3l-3: 显式 plan -> act -> report 管道
    // P5.7-R3j-1: 显式绑定 executor 模型
    // P5.7-R3k: 降级时，跳过工具执行，直接返回
    if (route === "complex-tool") {
        // P5.7-R3k: 降级时跳过工具执行
        if (selectedLevel !== "LEVEL_0") {
            logger.warn("complex-tool request but in degrade mode, skipping tool execution", {
                module: "lmstudio",
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
                actionJournal: [],  // P5.7-R3l-4: 降级场景返回空数组
            };
        }

        // P5.7-R3j-1: 显式绑定 executor 模型
        const usedModel = executorModel;
        const usedTemperature = 0;  // P5.7-R3j-2: 硬锁温度

        // P5.7-R3l-3: 第一阶段 - plan（使用 executor 模型，temperature=0，kernel=dialog）
        // P5.7-R3l-5: TTFT 短回执 - plan 阶段入口立即发送处理中回执
        logger.info("pipeline phase started", {
            module: "lmstudio",
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
            module: "lmstudio",
            traceId,
            route: "complex-tool",
            phase: "plan",
            kernel: "dialog",
            soulInjected: dialogSoulInjected,
            temperature: usedTemperature,
            model: usedModel,
            planLength: planResult.length,
        });

        // P5.7-R3l-3: 第二阶段 - act（走工具循环，使用 executor 模型 + 计划上下文，kernel=exec）
        // P5.7-R3l-5: TTFT 短回执 - act 阶段入口立即发送处理中回执
        logger.info("pipeline phase started", {
            module: "lmstudio",
            traceId,
            route: "complex-tool",
            phase: "act",
            kernel: "exec",
            soulInjected: execSoulInjected,
            status: "processing",
        });

        const execPrompt = `${options.prompt}\n\n执行计划：${planResult}`;
        // P5.7-R3l-4: 传入 traceId 和 route 用于 journal 追踪
        const toolLoopResult = await runLmStudioToolLoop({
            prompt: execPrompt,
            system: options.system,
            workspacePath: options.workspacePath,
            // act 阶段仅消费 plan 结果，不注入历史/人格
            windowMessages: undefined,
            summaryContext: undefined,
            soulContext: undefined,
            model: usedModel,
            backendRuntime,
            traceId,  // P5.7-R3l-4: 追踪 ID
            route: "complex-tool",  // P5.7-R3l-4: 路由标记
        });

        logger.info("pipeline phase completed", {
            module: "lmstudio",
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

        // P5.7-R3l-3: 第三阶段 - report（使用 executor 模型总结结果，kernel=dialog）
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
            module: "lmstudio",
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
            actionJournal: toolLoopResult.actionJournal,  // P5.7-R3l-4: 从 toolLoop 传递
        };
    }

    // tool: 走工具循环（temperature=0，稳定触发，使用 executor 模型）
    // P5.7-R3l-3: 显式 plan -> act -> report 日志（不新增 LLM 轮次）
    // P5.7-R3j-1: 显式绑定 executor 模型
    // P5.7-R3j-2: 硬锁温度为 0
    // P5.7-R3k: 降级策略 - 降级时跳过工具执行

    if (selectedLevel !== "LEVEL_0") {
        logger.warn("tool request but in degrade mode, skipping tool execution", {
            module: "lmstudio",
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
            actionJournal: [],  // P5.7-R3l-4: 降级场景返回空数组
        };
    }

    const usedModel = executorModel;
    const usedTemperature = 0;

    // P5.7-R3l-3: plan 预备日志（tool 路由不新增 LLM 轮次，只加日志）
    // P5.7-R3l-5: TTFT 短回执 - plan 阶段入口立即发送处理中回执
    logger.info("pipeline phase started", {
        module: "lmstudio",
        traceId,
        route: "tool",
        phase: "plan",
        kernel: "router",
        soulInjected: execSoulInjected,
        temperature: usedTemperature,
        model: usedModel,
        status: "processing",
    });

    // P5.7-R3l-3: act 执行（走工具循环，kernel=exec）
    // P5.7-R3l-5: TTFT 短回执 - act 阶段入口立即发送处理中回执
    logger.info("pipeline phase started", {
        module: "lmstudio",
        traceId,
        route: "tool",
        phase: "act",
        kernel: "exec",
        soulInjected: execSoulInjected,
        status: "processing",
    });
    // P5.7-R3l-4: 传入 traceId 和 route 用于 journal 追踪
    const toolLoopResult = await runLmStudioToolLoop({
        prompt: options.prompt,
        system: options.system,
        workspacePath: options.workspacePath,
        // 工具链路使用最小上下文，避免历史/人格污染协议
        windowMessages: undefined,
        summaryContext: undefined,
        soulContext: undefined,
        model: usedModel,
        backendRuntime,
        traceId,  // P5.7-R3l-4: 追踪 ID
        route: "tool",  // P5.7-R3l-4: 路由标记
    });

    // P5.7-R3l-3: act 完成日志（kernel=exec）
    // P5.7-R3l-5: 观测字段锁 - 包含 soulInjected
    logger.info("pipeline phase completed", {
        module: "lmstudio",
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

    // P5.7-R3l-3: report 收口日志（kernel=dialog，tool 路由不新增 LLM 轮次）
    // P5.7-R3l-5: 观测字段锁 - 包含 soulInjected
    logger.info("pipeline phase completed", {
        module: "lmstudio",
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
        actionJournal: toolLoopResult.actionJournal,  // P5.7-R3l-4: 从 toolLoop 传递
    };
}

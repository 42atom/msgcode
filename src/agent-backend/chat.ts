/**
 * msgcode: Agent Backend Chat 模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的聊天逻辑
 * 主实现已迁出到本文件。
 *
 * 目标：分离底层聊天原语与路由编排
 */

import { config } from "../config.js";
import { logger } from "../logger/index.js";
import type {
    AgentChatOptions,
    AgentBackendRuntime,
} from "./types.js";
import {
    resolveAgentBackendRuntime,
    normalizeModelOverride,
} from "./config.js";
import {
    resolveBaseSystemPrompt,
    buildDialogSystemPrompt,
    buildDialogPromptWithContext,
    LMSTUDIO_DEFAULT_CHAT_MODEL,
} from "./prompt.js";
import { normalizeBaseUrl as normalizeBaseUrlAdapter, fetchWithTimeout } from "../providers/openai-compat-adapter.js";
import { sanitizeLmStudioOutput as sanitizeCore, dropBeforeLastClosingTag } from "../providers/output-normalizer.js";
import {
    type MiniMaxAnthropicMessage,
    buildMiniMaxAnthropicHeaders,
    buildMiniMaxAnthropicRequest,
    normalizeMiniMaxAnthropicBaseUrl,
    parseMiniMaxAnthropicResponse,
} from "../providers/minimax-anthropic.js";
import {
    LOCAL_MODEL_LOAD_MAX_RETRIES,
    maybeReloadLocalModelAndRetry,
} from "../runtime/model-service-lease.js";

// ============================================
// 类型定义
// ============================================

type ResolveModelParams = {
    baseUrl: string;
    configuredModel?: string;
    apiKey?: string;
    timeoutMs?: number;
    nativeApiEnabled?: boolean;
    modelsListPath?: string;
};

type LmStudioNativeChatParams = {
    baseUrl: string;
    model: string;
    prompt: string;
    system?: string;
    maxOutputTokens: number;
    timeoutMs: number;
    apiKey?: string;
    temperature?: number;
    allowLocalModelReload?: boolean;
};

type LmStudioNativeMcpParams = {
    baseUrl: string;
    model: string;
    prompt: string;
    system?: string;
    maxOutputTokens: number;
    timeoutMs: number;
    useMcp: boolean;
    apiKey?: string;
    temperature?: number;
    allowLocalModelReload?: boolean;
};

type LmStudioOpenAIChatParams = {
    baseUrl: string;
    model: string;
    prompt: string;
    system?: string;
    maxTokens: number;
    timeoutMs: number;
    apiKey?: string;
    temperature?: number;
    allowLocalModelReload?: boolean;
};

// ============================================
// 模块级缓存
// ============================================

let cachedModel: { baseUrl: string; id: string } | undefined;

// ============================================
// 辅助函数
// ============================================

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
        if (typeof obj.text === "string") return obj.text;
        if (typeof obj.content === "string") return obj.content;
        if (typeof obj.value === "string") return obj.value;
    }

    return "";
}

/**
 * 清洗 LM Studio 输出
 */
export function sanitizeLmStudioOutput(text: string): string {
    let out = text ?? "";

    out = sanitizeCore(out);

    out = dropBeforeLastClosingTag(out, "think");
    out = out.replace(/<think[\s\S]*?<\/think>/gi, "");
    out = out.replace(/tool_calls[参数:\s\S]*?(?=\n\n|$)/gi, "");
    out = out.replace(/<[\w:-]*tool_call[\w:-]*>[\s\S]*?<\/[\w:-]*tool_call>/gi, "");
    out = out.replace(/<invoke\b[\s\S]*?<\/invoke>/gi, "");
    out = out.replace(/<parameter\b[\s\S]*?<\/parameter>/gi, "");

    return out.replace(/\n{3,}/g, "\n\n").trim();
}

// ============================================
// 网络请求函数
// ============================================

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
    const apiKey = params.apiKey?.trim();
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

// ============================================
// 模型解析函数
// ============================================

async function resolveLmStudioModelId(params: ResolveModelParams): Promise<string> {
    const configured = (params.configuredModel || "").trim();

    if (configured && configured !== "auto") {
        return configured;
    }

    if ((params.nativeApiEnabled ?? true) && !configured) {
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

    if (params.nativeApiEnabled ?? true) {
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
    }

    const firstCatalogModel = await fetchFirstModelId({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
        modelsListPath: params.modelsListPath,
        preferNative: params.nativeApiEnabled,
    });
    if (firstCatalogModel) {
        cachedModel = { baseUrl: params.baseUrl, id: firstCatalogModel };
        return firstCatalogModel;
    }

    throw new Error(
        "LM Studio 中没有已加载或可发现的模型。\n\n" +
        "请在 LM Studio 中加载至少一个模型后再试。"
    );
}

async function fetchFirstModelId(params: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
    modelsListPath?: string;
    preferNative?: boolean;
}): Promise<string | null> {
    if (params.preferNative !== false) {
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
    }

    const url = `${params.baseUrl}${params.modelsListPath || "/v1/models"}`;

    const timeoutMs = params.timeoutMs || (typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 60_000);

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

// ============================================
// 聊天 API 函数
// ============================================

/**
 * 从 /api/v1/chat 响应中提取最终 message
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

function extractLmStudioNativeMessage(value: unknown): string {
    const output = isNativeChatResponse(value) ? value.output : [];
    let lastReasoning = "";

    for (const item of output) {
        if (item.type === "message") {
            const extracted = extractTextFromUnknown(item.content);
            if (extracted) return extracted;
        }
        if (item.type === "reasoning") {
            const extracted = extractTextFromUnknown(item.content);
            if (extracted) lastReasoning = extracted;
        }
    }

    if (lastReasoning) {
        const lines = lastReasoning.split("\n");
        const lastLines = lines.slice(-3).join("\n").trim();
        if (lastLines && lastLines.length > 10) {
            return lastLines;
        }
    }

    return "";
}

async function runLmStudioChatNativeMcp(params: LmStudioNativeMcpParams): Promise<string> {
    const url = `${params.baseUrl}/api/v1/chat`;

    const bodyBase: Record<string, unknown> = {
        model: params.model,
        input: params.prompt,
        stream: false,
        max_output_tokens: params.maxOutputTokens,
        temperature: params.temperature ?? 0,
    };

    if (params.system && params.system.trim()) {
        bodyBase.system_prompt = params.system.trim();
    }

    if (params.useMcp) {
        bodyBase.integrations = [
            {
                type: "plugin",
                id: "mcp/filesystem"
            }
        ];
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= LOCAL_MODEL_LOAD_MAX_RETRIES; attempt++) {
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
            if (params.allowLocalModelReload !== false && await maybeReloadLocalModelAndRetry({
                module: "agent-backend/chat",
                baseUrl: params.baseUrl,
                model: params.model,
                errorMessage: lastError.message,
                attempt,
                apiKey: params.apiKey,
                timeoutMs: params.timeoutMs,
            })) {
                continue;
            }
            break;
        }
    }

    throw new Error(`LM Studio(${params.model}) ${lastError?.message || "调用失败"}`);
}

async function runLmStudioChatNative(params: LmStudioNativeChatParams): Promise<string> {
    const url = `${params.baseUrl}/api/v1/chat`;

    const bodyBase: Record<string, unknown> = {
        model: params.model,
        input: params.prompt,
        stream: false,
        max_output_tokens: params.maxOutputTokens,
        temperature: params.temperature ?? 0,
    };

    if (params.system && params.system.trim()) {
        bodyBase.system_prompt = params.system.trim();
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= LOCAL_MODEL_LOAD_MAX_RETRIES; attempt++) {
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
            if (params.allowLocalModelReload !== false && await maybeReloadLocalModelAndRetry({
                module: "agent-backend/chat",
                baseUrl: params.baseUrl,
                model: params.model,
                errorMessage: lastError.message,
                attempt,
                apiKey: params.apiKey,
                timeoutMs: params.timeoutMs,
            })) {
                continue;
            }
            break;
        }
    }

    throw new Error(`LM Studio(${params.model}) ${lastError?.message || "调用失败"}`);
}

async function runLmStudioChatOpenAICompat(params: LmStudioOpenAIChatParams): Promise<string> {
    const url = `${params.baseUrl}/v1/chat/completions`;

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (params.system && params.system.trim()) {
        messages.push({ role: "system", content: params.system.trim() });
    }
    messages.push({ role: "user", content: params.prompt });

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= LOCAL_MODEL_LOAD_MAX_RETRIES; attempt++) {
        try {
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
                    temperature: params.temperature ?? 0.7,
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
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error("LM Studio 调用失败");
            if (params.allowLocalModelReload !== false && await maybeReloadLocalModelAndRetry({
                module: "agent-backend/chat",
                baseUrl: params.baseUrl,
                model: params.model,
                errorMessage: lastError.message,
                attempt,
                apiKey: params.apiKey,
                timeoutMs: params.timeoutMs,
            })) {
                continue;
            }
            break;
        }
    }

    throw new Error(`LM Studio(${params.model}) ${lastError?.message || "调用失败"}`);
}

async function runMiniMaxChatAnthropic(params: LmStudioOpenAIChatParams): Promise<string> {
    const url = `${normalizeMiniMaxAnthropicBaseUrl(params.baseUrl)}/v1/messages`;

    const messages: MiniMaxAnthropicMessage[] = [
        { role: "user", content: params.prompt },
    ];

    const rawText = await fetchTextWithTimeout({
        url,
        method: "POST",
        timeoutMs: params.timeoutMs,
        headers: buildMiniMaxAnthropicHeaders(params.apiKey),
        body: buildMiniMaxAnthropicRequest({
            model: params.model,
            messages,
            system: params.system,
            maxTokens: params.maxTokens,
            temperature: params.temperature ?? 0.7,
        }),
    });

    const parsed = parseMiniMaxAnthropicResponse(rawText);
    if (parsed.error) {
        throw new Error(`MiniMax API 错误：${parsed.error}`);
    }
    if (!parsed.textContent || !parsed.textContent.trim()) {
        throw new Error(`MiniMax(${params.model}) 未返回可展示的内容`);
    }
    return parsed.textContent;
}

// ============================================
// 主函数：runAgentChat
// ============================================

export async function runAgentChat(options: AgentChatOptions): Promise<string> {
    const backendRuntime = options.backendRuntime || resolveAgentBackendRuntime();
    const baseUrl = normalizeBaseUrl(backendRuntime.baseUrl);
    const modelOverride = normalizeModelOverride(options.model);
    const backendDefaultModel = normalizeModelOverride(backendRuntime.model);

    const model = modelOverride
        ?? backendDefaultModel
        ?? (backendRuntime.id === "local-openai"
            ? await resolveLmStudioModelId({
                baseUrl,
                configuredModel: backendRuntime.model,
                apiKey: backendRuntime.apiKey,
                timeoutMs: backendRuntime.timeoutMs,
                nativeApiEnabled: backendRuntime.nativeApiEnabled,
                modelsListPath: backendRuntime.modelsListPath,
            })
            : undefined);

    if (!model) {
        throw new Error(`Agent backend(${backendRuntime.id}) 未配置模型。请设置 AGENT_MODEL 或对应后端模型变量。`);
    }
    const resolvedModel = model;

    const temperature = options.temperature ?? 0.7;

    const baseSystem = await resolveBaseSystemPrompt(options.system);

    const timeoutMs = backendRuntime.timeoutMs;

    const maxTokens = typeof config.lmstudioMaxTokens === "number" && Number.isFinite(config.lmstudioMaxTokens) && config.lmstudioMaxTokens > 0
        ? Math.floor(config.lmstudioMaxTokens)
        : 4000;

    const useMcp = backendRuntime.nativeApiEnabled && process.env.LMSTUDIO_ENABLE_MCP === "1" && !!options.workspace;
    const allowLocalModelReload = backendRuntime.supportsModelLifecycle !== false;

    const mcpMaxTokens = Math.max(maxTokens, 1024);

    const promptWithContext = buildDialogPromptWithContext({
        prompt: options.prompt,
        summaryContext: options.summaryContext,
        windowMessages: options.windowMessages,
    });

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
            system: systemPrompt,
            maxOutputTokens: Math.max(maxOutputTokens, mcpMaxTokens),
            timeoutMs,
            useMcp,
            apiKey: backendRuntime.apiKey,
            temperature,
            allowLocalModelReload,
        });
        return sanitizeLmStudioOutput(native);
    }

    async function runNativeOnce(maxOutputTokens: number): Promise<string> {
        const native = await runLmStudioChatNative({
            baseUrl,
            model: resolvedModel,
            prompt: promptWithContext,
            system: systemPrompt,
            maxOutputTokens,
            timeoutMs,
            apiKey: backendRuntime.apiKey,
            temperature,
            allowLocalModelReload,
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
            temperature,
            allowLocalModelReload,
        });
        return sanitizeLmStudioOutput(text);
    }

    async function runMiniMaxOnce(maxOutputTokens: number): Promise<string> {
        const text = await runMiniMaxChatAnthropic({
            baseUrl,
            model: resolvedModel,
            prompt: promptWithContext,
            system: compatSystemPrompt && compatSystemPrompt.trim() ? compatSystemPrompt.trim() : undefined,
            maxTokens: maxOutputTokens,
            timeoutMs,
            apiKey: backendRuntime.apiKey,
            temperature,
        });
        return sanitizeLmStudioOutput(text);
    }

    if (backendRuntime.id === "minimax") {
        return await runMiniMaxOnce(maxTokens);
    }

    if (backendRuntime.nativeApiEnabled) {
        try {
            if (useMcp) {
                return await runNativeMcpOnce(maxTokens);
            }
            return await runNativeOnce(maxTokens);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : "";

            if (isModelCrashedMessage(msg) && maxTokens > 1600) {
                try {
                    return await runNativeOnce(1600);
                } catch {
                    // ignore and proceed to normal fallback/throw
                }
            }

            const shouldFallback = msg.includes("404") || msg.includes("未返回可展示的内容");
            if (!shouldFallback) {
                throw error instanceof Error ? error : new Error("LM Studio 调用失败");
            }
        }
    }

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

// ============================================
// 兼容别名
// ============================================

/**
 * @deprecated 请使用 runAgentChat
 */
export const runLmStudioChat = runAgentChat;

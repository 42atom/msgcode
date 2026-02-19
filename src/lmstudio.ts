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
import { logger } from "./logger/index.js";

// P5.6.2: 导入提取的 provider 层
import { normalizeBaseUrl as normalizeBaseUrlAdapter, fetchWithTimeout } from "./providers/openai-compat-adapter.js";
import { sanitizeLmStudioOutput as sanitizeCore, dropBeforeLastClosingTag } from "./providers/output-normalizer.js";
import { runToolLoop } from "./providers/tool-loop.js";

export interface LmStudioChatOptions {
    prompt: string;
    system?: string;
    workspace?: string;  // 可选：工作目录（启用 MCP integrations）
}

export async function runLmStudioChat(options: LmStudioChatOptions): Promise<string> {
    const baseUrl = normalizeBaseUrl(config.lmstudioBaseUrl || "http://127.0.0.1:1234");

    const model = await resolveLmStudioModelId({ baseUrl });

    // 构建 system prompt：基础（用户配置）+ 快速回答规则 +（可选）MCP 防循环规则
    // 注意：当 options.system 未提供时，必须回退到 LMSTUDIO_SYSTEM_PROMPT（用户配置）。
    const baseSystem = options.system ?? config.lmstudioSystemPrompt ?? "";

    const timeoutMs = typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 120_000;

    const maxTokens = typeof config.lmstudioMaxTokens === "number" && Number.isFinite(config.lmstudioMaxTokens) && config.lmstudioMaxTokens > 0
        ? Math.floor(config.lmstudioMaxTokens)
        : 4000;

    // E17: 默认禁用 MCP（避免模型尝试读取文件，需要 LMSTUDIO_ENABLE_MCP=1 显式启用）
    const useMcp = process.env.LMSTUDIO_ENABLE_MCP === "1" && !!options.workspace;

    // MCP 模式需要更大的 max_tokens，避免工具调用被截断
    // 工具调用块本身可能 100+ token，太小会导致缺少 [END_TOOL_REQUEST]
    const mcpMaxTokens = Math.max(maxTokens, 1024);

    // 构造 system prompt（包含快速回答规则）
    const systemPrompt = buildSystemPrompt(baseSystem, useMcp);
    const compatSystemPrompt = buildSystemPrompt(baseSystem, false);

    async function runNativeMcpOnce(maxOutputTokens: number): Promise<string> {
        const native = await runLmStudioChatNativeMcp({
            baseUrl,
            model,
            prompt: options.prompt,
            system: systemPrompt,  // 传递 system_prompt
            maxOutputTokens: Math.max(maxOutputTokens, mcpMaxTokens),
            timeoutMs,
            useMcp,
        });
        return sanitizeLmStudioOutput(native);
    }

    async function runNativeOnce(maxOutputTokens: number): Promise<string> {
        const native = await runLmStudioChatNative({
            baseUrl,
            model,
            prompt: options.prompt,
            system: systemPrompt,  // 传递 system_prompt
            maxOutputTokens,
            timeoutMs,
        });
        return sanitizeLmStudioOutput(native);
    }

    async function runCompatOnce(maxOutputTokens: number): Promise<string> {
        const text = await runLmStudioChatOpenAICompat({
            baseUrl,
            model,
            prompt: options.prompt,
            system: compatSystemPrompt && compatSystemPrompt.trim() ? compatSystemPrompt.trim() : undefined,
            maxTokens: maxOutputTokens,
            timeoutMs,
        });
        return sanitizeLmStudioOutput(text);
    }

    // 1) 优先走原生 REST with MCP（当启用时）或普通原生
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

// ============================================
// System Prompt 构建（含 MCP 防循环规则）
// ============================================

/**
 * 构建完整的 system prompt
 * - 基础 prompt（用户配置）
 * - E17: 快速回答规则（默认启用，避免模型思考太长时间）
 * - MCP 防循环规则（当启用 workspace 时）
 */
function buildSystemPrompt(base: string, useMcp?: boolean): string {
    const parts: string[] = [];
    if (base.trim()) {
        parts.push(base.trim());
    }

    // E17: 快速回答约束（保持极短，避免触发“复述说明书/元叙事”）
    // 注意：这里不要写“规则/约束/分析/计划/两段式/第1段...”等说明书式语句，
    // 否则部分模型会把它当作需要复述的内容。
    const quickAnswerConstraint = `
直接回答用户的问题，用中文纯文本输出。
不要解释你在做什么，也不要复述用户消息或任何方括号块（如 [attachment]/[图片文字]/[语音转写]）。
如需引用证据，只摘录最关键的1-3句。
`.trim();
    parts.push(quickAnswerConstraint);

    // 只在 MCP 真正启用时才追加 MCP 规则（避免 4.7 误以为自己有工具）
    if (useMcp) {
        parts.push(MCP_ANTI_LOOP_RULES);
    }

    return parts.join("\n\n");
}

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
- 不要添加额外的计数说明（如"共X个文件"）
- 不要重复相同的条目
- 区分文件和目录时用简洁标记（如 文件: / 目录:）
`.trim();

// ============================================

type ResolveModelParams = {
    baseUrl: string;
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
    const configured = (config.lmstudioModel || "").trim();

    // 优先使用配置的模型名（直接使用，LM Studio 会自动处理）
    if (configured && configured !== "auto") {
        return configured;
    }

    // auto 模式：只使用已加载的模型
    const loadedModel = await fetchFirstLoadedModelKeyNative({ baseUrl: params.baseUrl });
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

async function fetchFirstModelId(params: { baseUrl: string }): Promise<string | null> {
    // 优先：原生 REST
    try {
        const id = await fetchFirstLoadedModelKeyNative({ baseUrl: params.baseUrl });
        if (id) return id;
    } catch {
        // ignore and fallback
    }

    // 后备：OpenAI 兼容
    const url = `${params.baseUrl}/v1/models`;

    const timeoutMs = typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 60_000;

    // 使用 fetchTextWithTimeout，它会自动添加 API key
    const rawText = await fetchTextWithTimeout({
        url,
        method: "GET",
        timeoutMs,
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
};

async function runLmStudioChatNativeMcp(params: LmStudioNativeMcpParams): Promise<string> {
    const url = `${params.baseUrl}/api/v1/chat`;

    const bodyBase: Record<string, unknown> = {
        model: params.model,
        input: params.prompt,
        stream: false,
        max_output_tokens: params.maxOutputTokens,
        temperature: 0,  // 降低随机性，减少循环
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
        temperature: 0, // 稳定优先：避免发散/乱码/循环
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
        }),
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
async function fetchLoadedModelByKey(params: { baseUrl: string; key: string }): Promise<string | null> {
    try {
        const url = `${params.baseUrl}/api/v1/models`;
        const rawText = await fetchTextWithTimeout({
            url,
            method: "GET",
            timeoutMs: typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs) ? config.lmstudioTimeoutMs : 60_000,
        });

        let json: unknown;
        try {
            json = JSON.parse(rawText);
        } catch {
            return null;
        }

        const models = isNativeModelsList(json) ? json.data : [];
        for (const m of models) {
            if (m.type !== "llm") continue;
            if (m.key !== params.key) continue;
            if (!Array.isArray(m.loaded_instances) || m.loaded_instances.length === 0) continue;
            return m.key;
        }
    } catch {
        // 忽略错误，返回 null
    }
    return null;
}

async function fetchFirstLoadedModelKeyNative(params: { baseUrl: string }): Promise<string | null> {
    const url = `${params.baseUrl}/api/v1/models`;
    const rawText = await fetchTextWithTimeout({
        url,
        method: "GET",
        timeoutMs: typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs) ? config.lmstudioTimeoutMs : 60_000,
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
}): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

    const headers: Record<string, string> = { ...params.headers };
    const apiKey = config.lmstudioApiKey?.trim();
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
    // E17: 过滤 XML-ish 工具调用块
    out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");

    // 末尾多余空行压缩
    return out.replace(/\n{3,}/g, "\n\n").trim();
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
            description: "执行 shell 命令",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "要执行的 shell 命令" }
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
        const { loadWorkspaceConfig } = await import("./config/workspace.js");
        const cfg = await loadWorkspaceConfig(workspacePath);

        // P5.6.8-R3b: PI 模式分叉
        const piEnabled = cfg["pi.enabled"] ?? false;

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
        if (raw.includes("<tool_call>")) {
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
}

/**
 * Tool Loop 结果
 */
export interface ToolLoopResult {
    answer: string;
    toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
}

/**
 * Tool 调用类型
 */
type ToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

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
 */
async function runTool(name: string, args: Record<string, unknown>, root: string): Promise<unknown> {
    const { executeTool } = await import("./tools/bus.js");
    const { randomUUID } = await import("node:crypto");

    const result = await executeTool(name as any, args, {
        workspacePath: root,
        source: "llm-tool-call",
        requestId: `lmstudio-${randomUUID()}`,
    });

    if (!result.ok) {
        return { error: result.error?.message || "tool execution failed" };
    }

    // 返回 data 字段（兼容旧格式）
    return result.data || { success: true };
}

/**
 * Tool Loop 主函数
 *
 * 流程：
 * 1. 第一次请求带 tools + tool_choice:"auto"
 * 2. 若返回 tool_calls：执行第一个，回灌 role:"tool"
 * 3. 第二次请求强制 tool_choice:"none" 生成最终回答
 * 4. 只对最终 answer 走清洗链
 */
export async function runLmStudioToolLoop(options: LmStudioToolLoopOptions): Promise<ToolLoopResult> {
    const baseUrl = options.baseUrl || normalizeBaseUrl(config.lmstudioBaseUrl || "http://127.0.0.1:1234");
    const model = options.model || await resolveLmStudioModelId({ baseUrl });
    const timeoutMs = options.timeoutMs || (typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 120_000);
    const root = options.allowRoot || config.workspaceRoot || AIDOCS_ROOT;

    // P5.6.8-R3c: 注入 skill 索引到 system prompt
    let system = options.system ?? config.lmstudioSystemPrompt ?? "";
    const workspacePath = options.workspacePath || root;

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

    const messages: Array<{ role: string; content?: string; tool_call_id?: string; tool_calls?: ToolCall[] }> = [];

    if (system && system.trim()) {
        messages.push({ role: "system", content: system.trim() });
    }
    messages.push({ role: "user", content: options.prompt });

    // P0: 获取基于 workspace 配置的工具列表（explicit 模式下为空）
    const workspaceRootForTools = options.workspacePath || root;
    const tools = options.tools ?? await getToolsForLlm(workspaceRootForTools);

    // 1) 第一次：允许工具调用
    const r1 = await callChatCompletionsRaw({
        baseUrl,
        model,
        messages,
        tools,
        toolChoice: "auto",
        temperature: 0,
        maxTokens: 800,
        timeoutMs,
    });

    const msg1 = r1.choices[0]?.message;
    const toolCalls = msg1?.tool_calls ?? [];

    // 2) P5.5-R1: 只认标准 tool_calls，移除文本兜底解析
    let tc: ToolCall | null = toolCalls.length > 0 ? toolCalls[0] : null;
    let args: Record<string, unknown> = {};
    let assistantRole = msg1?.role || "assistant";
    const assistantContent = msg1?.content;

    if (tc) {
        try {
            args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
            args = {};
        }
    }

    // 3) 无工具调用（含兜底解析失败）：直接清洗返回
    if (!tc) {
        return { answer: sanitizeLmStudioOutput(assistantContent ?? "") };
    }

    let toolResult: unknown;
    try {
        toolResult = await runTool(tc.function.name, args, root);
    } catch (e) {
        toolResult = { error: e instanceof Error ? e.message : String(e) };
    }

    // 构造第二轮消息（将工具调用回灌给模型）
    const assistantMsg: { role: string; content?: string; tool_calls?: ToolCall[] } = {
        role: assistantRole,
        tool_calls: [tc],
    };
    if (assistantContent !== undefined) {
        assistantMsg.content = assistantContent;
    }

    const messages2 = [
        ...messages,
        assistantMsg,
        {
            role: "tool",
            tool_call_id: tc.id,
            content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult)
        }
    ];

    // 4) 第二次：强制不再调用工具，只总结
    const r2 = await callChatCompletionsRaw({
        baseUrl,
        model,
        messages: messages2,
        tools: [], // 第二次不传 tools，避免干扰
        toolChoice: "none",
        temperature: 0,
        maxTokens: 800,
        timeoutMs,
    });

    const answer = r2.choices[0]?.message?.content ?? "";

    // P5.6.8-R3c: 统一日志（不再特殊处理 run_skill）
    const toolCallCount = tc ? 1 : 0;
    logger.info("Tool loop completed", {
        module: "lmstudio",
        toolCallCount,
        toolName: tc?.function.name || null,
    });

    return {
        answer: sanitizeLmStudioOutput(answer),
        toolCall: { name: tc.function.name, args, result: toolResult }
    };
}

/**
 * 调用 OpenAI 兼容 /v1/chat/completions（返回原始 JSON）
 */
async function callChatCompletionsRaw(params: {
    baseUrl: string;
    model: string;
    messages: Array<{ role: string; content?: string; tool_call_id?: string; tool_calls?: ToolCall[] }>;
    tools: readonly unknown[];
    toolChoice: "auto" | "none" | "required";
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
}): Promise<ChatResponse> {
    const url = `${params.baseUrl}/v1/chat/completions`;

    // 添加 stop 参数，防止工具调用标签后继续输出
    // 只在工具调用模式时添加，最终回答模式不需要
    const stop = params.toolChoice === "none" ? undefined : ["[END_TOOL_REQUEST]"];

    const rawText = await fetchTextWithTimeout({
        url,
        method: "POST",
        timeoutMs: params.timeoutMs,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            model: params.model,
            messages: params.messages,
            tools: params.tools,
            tool_choice: params.toolChoice,
            stream: false,
            max_tokens: params.maxTokens,
            temperature: params.temperature,
            stop,
        }),
    });

    let json: unknown;
    try {
        json = JSON.parse(rawText);
    } catch {
        throw new Error(`LM Studio API 返回非 JSON：${sanitizeLmStudioOutput(rawText).slice(0, 400)}`);
    }

    if (!isChatCompletion(json)) {
        throw new Error(`LM Studio API 返回格式错误`);
    }

    return json as ChatResponse;
}

// ============================================

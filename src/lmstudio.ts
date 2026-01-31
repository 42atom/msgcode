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

export interface LmStudioChatOptions {
    prompt: string;
    system?: string;
    workspace?: string;  // 可选：工作目录（启用 MCP integrations）
}

export async function runLmStudioChat(options: LmStudioChatOptions): Promise<string> {
    const baseUrl = normalizeBaseUrl(config.lmstudioBaseUrl || "http://127.0.0.1:1234");

    const model = await resolveLmStudioModelId({ baseUrl });

    // 构建 system prompt：基础 + MCP 防循环规则
    const baseSystem = options.system ?? config.lmstudioSystemPrompt ?? "";
    const system = buildSystemPrompt(baseSystem, options.workspace);

    const timeoutMs = typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 120_000;

    const maxTokens = typeof config.lmstudioMaxTokens === "number" && Number.isFinite(config.lmstudioMaxTokens) && config.lmstudioMaxTokens > 0
        ? Math.floor(config.lmstudioMaxTokens)
        : 4000;

    // 优先使用 /api/v1/chat with MCP integrations（当提供 workspace 时）
    const useMcp = !!options.workspace;

    // MCP 模式需要更大的 max_tokens，避免工具调用被截断
    // 工具调用块本身可能 100+ token，太小会导致缺少 [END_TOOL_REQUEST]
    const mcpMaxTokens = Math.max(maxTokens, 1024);

    async function runNativeMcpOnce(maxOutputTokens: number): Promise<string> {
        const native = await runLmStudioChatNativeMcp({
            baseUrl,
            model,
            prompt: options.prompt,
            system: undefined,  // 不传递 system_prompt
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
            system: undefined,  // 不传递 system_prompt
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
            system: system && system.trim() ? system.trim() : undefined,
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
 * - MCP 防循环规则（当启用 workspace 时）
 */
function buildSystemPrompt(base: string, workspace?: string): string {
    const parts: string[] = [];
    if (base.trim()) {
        parts.push(base.trim());
    }

    if (workspace) {
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

function normalizeBaseUrl(raw: string): string {
    let base = raw.replace(/\/+$/, "");
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

async function fetchFirstModelId(params: { baseUrl: string }): Promise<string> {
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
    };

    // 不设置 system_prompt，保持空

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
    for (const item of output) {
        if (item.type !== "message") continue;
        const extracted = extractTextFromUnknown(item.content);
        if (extracted) return extracted;
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
export function sanitizeLmStudioOutput(text: string): string {
    let out = text ?? "";

    out = stripAnsi(out);
    out = normalizeJsonishEnvelope(out);
    out = dropBeforeLastClosingTag(out, "think");
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");


    return out
        .split("\n")
        .map(line => line.trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function stripAnsi(input: string): string {
    return input
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\][^\u0007]*\u0007/g, "")
        .replace(/\u001b[\(\)][0-9A-Za-z]/g, "");
}

function dropBeforeLastClosingTag(input: string, tagName: string): string {
    const lower = input.toLowerCase();
    const needle = `</${tagName.toLowerCase()}>`;
    const idx = lower.lastIndexOf(needle);
    if (idx < 0) return input;
    return input.slice(idx + needle.length);
}

function normalizeJsonishEnvelope(input: string): string {
    let out = input;

    // 有些模型会把换行以 "\\n" 的形式塞进字符串里（尤其是输出 JSON 片段时）
    if (out.includes("\\n")) {
        // 兼容双重转义（"\\\\n" -> 实际内容里的 "\\n"）
        out = out.replace(/\\\\n/g, "\n");
        out = out.replace(/\\n/g, "\n");
    }

    const lines = out.split("\n");
    const normalized: string[] = [];

    for (let rawLine of lines) {
        const trimmed = rawLine.trim();

        // 直接丢弃 reasoning_content 行（无论是 JSON key 还是类 key:value）
        if (/^"?reasoning_content"?\s*:/.test(trimmed)) {
            continue;
        }
        if (/^reasoning_content\s*=/i.test(trimmed)) {
            continue;
        }

        // 丢弃 role 行（有些模型会输出 role/content/reasoning_content 的 JSON 片段）
        if (/^"?role"?\s*:/.test(trimmed)) {
            continue;
        }

        // 若是 "content": "..." 这种包裹，把前缀剥掉，让后续规则能识别 Action/Expression/Dialogue
        rawLine = rawLine.replace(/^\s*"?content"?\s*:\s*"/, "");
        // 去掉行尾可能出现的引号/逗号
        rawLine = rawLine.replace(/"\s*,?\s*$/, "");

        normalized.push(rawLine);
    }

    return normalized.join("\n");
}

// ============================================
// Tool Calling 支持
// ============================================

/**
 * 工具路径白名单根目录
 */
const AIDOCS_ROOT = "/Users/admin/GitProjects/AIDOCS";

/**
 * Tool 定义（OpenAI function calling schema）
 */
export const AIDOCS_TOOLS = [
    {
        type: "function",
        function: {
            name: "list_directory",
            description: "列出目录下的文件和子目录",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "目录路径（相对或绝对）" },
                    limit: { type: "integer", default: 20 }
                },
                required: ["path"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_text_file",
            description: "读取 UTF-8 文本文件内容",
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
            name: "append_text_file",
            description: "向文本文件追加内容（文件不存在则创建）",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "文件路径（相对或绝对）" },
                    content: { type: "string", description: "要追加的内容" }
                },
                required: ["path", "content"],
                additionalProperties: false
            }
        }
    }
] as const;

/**
 * Tool Loop 配置选项
 */
export interface LmStudioToolLoopOptions {
    prompt: string;
    system?: string;
    tools?: readonly unknown[];
    allowRoot?: string;
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
 * 执行工具
 */
async function runTool(name: string, args: Record<string, unknown>, root: string): Promise<unknown> {
    switch (name) {
        case "list_directory": {
            const dir = resolveUnderRoot(String(args.path || ""), root);
            const limitRaw = args.limit;
            const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw)
                ? Math.max(1, Math.floor(limitRaw))
                : 20;
            const entries = await fsPromises.readdir(dir, { withFileTypes: true });
            return entries.slice(0, limit).map(e => ({
                name: e.name,
                type: e.isDirectory() ? "directory" : "file"
            }));
        }
        case "read_text_file": {
            const filePath = resolveUnderRoot(String(args.path || ""), root);
            return await fsPromises.readFile(filePath, "utf-8");
        }
        case "append_text_file": {
            const filePath = resolveUnderRoot(String(args.path || ""), root);
            await fsPromises.appendFile(filePath, String(args.content ?? ""), "utf-8");
            return { success: true, path: args.path };
        }
        default:
            return { error: `未知工具: ${name}` };
    }
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
    const system = options.system ?? config.lmstudioSystemPrompt;
    const timeoutMs = options.timeoutMs || (typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 120_000);
    const root = options.allowRoot || config.workspaceRoot || AIDOCS_ROOT;

    const messages: Array<{ role: string; content?: string; tool_call_id?: string; tool_calls?: ToolCall[] }> = [];

    if (system && system.trim()) {
        messages.push({ role: "system", content: system.trim() });
    }
    messages.push({ role: "user", content: options.prompt });

    const tools = options.tools || AIDOCS_TOOLS;

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

    const toolCalls = r1.choices[0]?.message?.tool_calls ?? [];

    // 2) 无工具调用：直接清洗返回
    if (toolCalls.length === 0) {
        const content = r1.choices[0]?.message?.content ?? "";
        return { answer: sanitizeLmStudioOutput(content) };
    }

    // 3) 只执行第一个工具调用（防循环）
    const tc = toolCalls[0];
    let args: Record<string, unknown> = {};
    try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
        args = {};
    }

    let toolResult: unknown;
    try {
        toolResult = await runTool(tc.function.name, args, root);
    } catch (e) {
        toolResult = { error: e instanceof Error ? e.message : String(e) };
    }

    // 构造第二轮消息
    const msg1 = r1.choices[0].message;
    if (!msg1?.role || !msg1?.tool_calls) {
        const content = msg1?.content ?? "";
        return { answer: sanitizeLmStudioOutput(content) };
    }

    // 确保 role 存在（TypeScript 类型安全）
    const assistantMsg: { role: string; content?: string; tool_calls?: ToolCall[] } = {
        role: msg1.role,
        tool_calls: msg1.tool_calls,
    };
    if (msg1.content !== undefined) {
        assistantMsg.content = msg1.content;
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

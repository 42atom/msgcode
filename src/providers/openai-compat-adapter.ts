/**
 * msgcode: OpenAI 兼容协议适配器
 *
 * 职责：
 * - HTTP 请求封装（fetch + 超时）
 * - 请求/响应映射
 * - HTTP 错误标准化
 */

import { config } from "../config.js";

// ============================================
// 类型定义
// ============================================

export interface RequestOptions {
    url: string;
    method: "GET" | "POST";
    timeoutMs: number;
    headers?: Record<string, string>;
    body?: string;
}

export interface HttpResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
}

export interface HttpError {
    code: "TIMEOUT" | "CONNECTION_FAILED" | "HTTP_ERROR";
    message: string;
    status?: number;
}

// ============================================
// HTTP 客户端
// ============================================

/**
 * 判断是否为 abort 错误
 */
export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

/**
 * 带超时的 HTTP 请求
 *
 * @param params 请求参数
 * @returns 响应文本
 * @throws HttpError 超时/连接失败/HTTP 错误
 */
export async function fetchWithTimeout(params: RequestOptions): Promise<string> {
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
        clearTimeout(timeoutId);
        if (isAbortError(error)) {
            throw { code: "TIMEOUT", message: "请求超时" } as HttpError;
        }
        throw {
            code: "CONNECTION_FAILED",
            message: `连接失败：请确认服务已启动（${params.url}）`
        } as HttpError;
    } finally {
        clearTimeout(timeoutId);
    }

    const rawText = await resp.text();
    if (!resp.ok) {
        throw {
            code: "HTTP_ERROR",
            message: `HTTP ${resp.status}`,
            status: resp.status
        };
    }
    return rawText;
}

/**
 * 标准化的 base URL
 *
 * @param raw 原始 URL
 * @returns 标准化后的 URL
 */
export function normalizeBaseUrl(raw: string): string {
    let url = raw.trim();
    if (!url.startsWith("http")) {
        url = `http://${url}`;
    }
    if (url.endsWith("/")) {
        url = url.slice(0, -1);
    }
    return url;
}

// ============================================
// 请求构建器
// ============================================

/**
 * Chat Completions 请求体
 */
export interface ChatCompletionRequest {
    model: string;
    messages: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string }>;
    tools?: readonly unknown[];
    tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
    stream?: boolean;
    max_tokens?: number;
    temperature?: number;
    stop?: string[];
}

/**
 * 构建 Chat Completions 请求
 */
export function buildChatCompletionRequest(params: {
    model: string;
    messages: ChatCompletionRequest["messages"];
    tools?: readonly unknown[];
    toolChoice?: ChatCompletionRequest["tool_choice"];
    maxTokens?: number;
    temperature?: number;
    stop?: string[];
}): string {
    const body: ChatCompletionRequest = {
        model: params.model,
        messages: params.messages,
    };

    if (params.tools && params.tools.length > 0) {
        body.tools = params.tools;
        body.tool_choice = params.toolChoice ?? "auto";
    }

    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.stop) body.stop = params.stop;

    return JSON.stringify(body);
}

/**
 * 解析 Chat Completions 响应
 */
export interface ChatCompletionResponse {
    choices: Array<{
        message?: {
            role?: string;
            content?: string;
            tool_calls?: Array<{
                id: string;
                type: string;
                function: { name: string; arguments: string };
            }>;
        };
        finish_reason?: string;
    }>;
    error?: { message: string };
}

/**
 * 检查是否为 Chat Completions 响应
 */
export function isChatCompletionResponse(value: unknown): value is ChatCompletionResponse {
    return (
        typeof value === "object" &&
        value !== null &&
        "choices" in value &&
        Array.isArray((value as ChatCompletionResponse).choices)
    );
}

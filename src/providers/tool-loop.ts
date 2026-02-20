/**
 * msgcode: Tool Loop 执行器
 *
 * @deprecated P5.6.13-R1A-EXEC: 此文件已退役，主链迁移到 runLmStudioToolLoop
 *
 * 职责：
 * - 两段式与多轮 tool_calls 执行
 * - maxToolCalls 守卫
 * - 工具调用解析（XML/JSON/内联）
 * - 统一回执封装
 *
 * 注意：保留此文件仅用于导出纯解析辅助函数。
 * 运行时入口 runToolLoop 已废弃，禁止外部调用。
 */

import { logger } from "../logger/index.js";
import type { AidocsToolDef } from "../lmstudio.js";

// ============================================
// 类型定义
// ============================================

export interface ToolLoopOptions {
    prompt: string;
    system?: string;
    tools?: readonly AidocsToolDef[];
    model: string;
    baseUrl: string;
    timeoutMs: number;
    maxToolCalls?: number;
    temperature?: number;
    maxTokens?: number;
}

export interface ToolCallResult {
    name: string;
    args: Record<string, unknown>;
    result: unknown;
}

export interface ToolLoopResult {
    answer: string;
    toolCall?: ToolCallResult;
}

// ============================================
// 工具调用解析
// ============================================

export interface ParsedToolCall {
    name: string;
    args: Record<string, unknown>;
}

/**
 * 从 XML 格式中解析工具调用
 */
export function parseXmlToolCall(text: string, allowed: Set<string>): ParsedToolCall | null {
    const match = text.match(/<invoke name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/);
    if (!match) return null;

    const name = match[1];
    if (!allowed.has(name)) return null;

    return { name, args: {} };
}

/**
 * 从 JSON 格式中解析工具调用
 */
export function parseJsonToolCall(jsonSnippet: string, allowed: Set<string>): ParsedToolCall | null {
    try {
        const parsed = JSON.parse(jsonSnippet);
        if (parsed.name && typeof parsed.name === "string" && allowed.has(parsed.name)) {
            return { name: parsed.name, args: parsed.arguments ?? {} };
        }
    } catch {
        // ignore parse error
    }
    return null;
}

/**
 * 从内联格式中解析工具调用
 */
export function parseInlineNameAndJson(text: string, allowed: Set<string>): ParsedToolCall | null {
    // 格式: tool_name({...})
    const match = text.match(/^(\w+)\s*\(\s*(\{[\s\S]*?\})\s*\)/);
    if (!match) return null;

    const name = match[1];
    if (!allowed.has(name)) return null;

    try {
        const args = JSON.parse(match[2]);
        return { name, args };
    } catch {
        return null;
    }
}

/**
 * 从文本中最佳努力解析工具调用
 */
export function parseToolCallBestEffort(text: string, allowed: Set<string>): ParsedToolCall | null {
    // 1. 尝试 XML 格式
    let parsed = parseXmlToolCall(text, allowed);
    if (parsed) return parsed;

    // 2. 尝试 JSON 对象
    parsed = parseJsonToolCall(text, allowed);
    if (parsed) return parsed;

    // 3. 尝试内联格式
    parsed = parseInlineNameAndJson(text, allowed);
    if (parsed) return parsed;

    return null;
}

// ============================================
// Tool Loop 主逻辑
// ============================================

/**
 * 运行 Tool Loop
 *
 * @deprecated P5.6.13-R1A-EXEC: 禁止外部调用，主链已迁移到 runLmStudioToolLoop
 * @internal 仅保留用于历史兼容，新代码必须使用 runLmStudioToolLoop
 *
 * @param _options Tool Loop 选项（已忽略）
 * @returns 永远不会返回，总是抛出错误
 */
async function runToolLoop(_options: ToolLoopOptions): Promise<ToolLoopResult> {
    // P5.6.13-R1A-EXEC: 此函数已废弃，禁止执行
    throw new Error("runToolLoop is deprecated - use runLmStudioToolLoop instead");
}

// ============================================
// 内部函数
// ============================================

/**
 * 调用 Chat Completions API
 */
async function callChatCompletions(params: {
    baseUrl: string;
    model: string;
    messages: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string }>;
    tools: readonly unknown[];
    toolChoice: "auto" | "none" | "required";
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
}): Promise<ChatCompletionResponse> {
    const { fetchWithTimeout } = await import("./openai-compat-adapter.js");

    const url = `${params.baseUrl}/v1/chat/completions`;
    const stop = params.toolChoice === "none" ? undefined : ["[END_TOOL_REQUEST]"];

    const body = JSON.stringify({
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.toolChoice,
        stream: false,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        stop,
    });

    const text = await fetchWithTimeout({
        url,
        method: "POST",
        timeoutMs: params.timeoutMs,
        headers: { "content-type": "application/json" },
        body,
    });

    return JSON.parse(text) as ChatCompletionResponse;
}

/**
 * 清洗输出（临时占位，实际逻辑在 output-normalizer.ts）
 */
function sanitizeOutput(text: string): string {
    // 移除空白
    let cleaned = text.trim();
    // 移除 ANSI 转义码
    cleaned = cleaned.replace(/\x1b\[[0-9;]*m/g, "");
    return cleaned;
}

// 类型别名（供内部使用）
interface ChatCompletionResponse {
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

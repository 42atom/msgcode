/**
 * msgcode: Tool Loop 执行器
 *
 * 职责：
 * - 两段式与多轮 tool_calls 执行
 * - maxToolCalls 守卫
 * - 工具调用解析（XML/JSON/内联）
 * - 统一回执封装
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
 * 流程：
 * 1. 第一次请求带 tools + tool_choice:"auto"
 * 2. 若返回 tool_calls：执行第一个，回灌 role:"tool"
 * 3. 第二次请求强制 tool_choice:"none" 生成最终回答
 * 4. 只对最终 answer 走清洗链
 *
 * @param options Tool Loop 选项
 * @returns 最终回答与工具调用信息
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
    const {
        prompt,
        system,
        tools = [],
        model,
        baseUrl,
        timeoutMs,
        maxToolCalls = 1,
        temperature = 0,
        maxTokens = 800,
    } = options;

    const messages: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string }> = [];

    if (system && system.trim()) {
        messages.push({ role: "system", content: system.trim() });
    }
    messages.push({ role: "user", content: prompt });

    // 1) 第一次：允许工具调用
    const allowedToolNames = new Set(tools.map(t => (t as { function: { name: string } }).function.name));

    const r1 = await callChatCompletions({
        baseUrl,
        model,
        messages,
        tools,
        toolChoice: "auto",
        temperature,
        maxTokens,
        timeoutMs,
    });

    const msg1 = r1.choices[0]?.message;
    const toolCalls = msg1?.tool_calls ?? [];

    // 2) 选择第一个工具调用
    let tc = toolCalls.length > 0 ? toolCalls[0] : null;
    let args: Record<string, unknown> = {};

    if (tc) {
        try {
            args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
            args = {};
        }
    }

    // 3) 无工具调用：直接返回清洗后的回答
    if (!tc) {
        const answer = msg1?.content ?? "";
        return { answer: sanitizeOutput(answer) };
    }

    // 4) 执行工具调用
    let toolResult: unknown;
    try {
        const { executeTool: busExecuteTool } = await import("../tools/bus.js");
        const result = await busExecuteTool(
            tc.function.name as any,
            args,
            {
                workspacePath: process.cwd(),
                requestId: `tl-${Date.now()}`,
                source: "llm-tool-call",
            }
        );

        if (!result.ok) {
            throw new Error(result.error?.message ?? "tool execution failed");
        }

        toolResult = result.data;
    } catch (e) {
        toolResult = { error: e instanceof Error ? e.message : String(e) };
    }

    // 5) 构造第二轮消息（将工具调用回灌给模型）
    const assistantMsg = {
        role: msg1?.role || "assistant",
        tool_calls: [tc],
    };
    if (msg1?.content) {
        (assistantMsg as Record<string, unknown>).content = msg1.content;
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

    // 6) 第二次：强制不再调用工具，只总结
    const r2 = await callChatCompletions({
        baseUrl,
        model,
        messages: messages2,
        tools: [],
        toolChoice: "none",
        temperature,
        maxTokens,
        timeoutMs,
    });

    const answer = r2.choices[0]?.message?.content ?? "";

    // P5.5 观测字段
    logger.info("Tool loop completed", {
        module: "tool-loop",
        toolCallCount: 1,
        toolName: tc.function.name,
    });

    return {
        answer: sanitizeOutput(answer),
        toolCall: { name: tc.function.name, args, result: toolResult }
    };
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

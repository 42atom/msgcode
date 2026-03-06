/**
 * msgcode: MiniMax Anthropic-compatible 协议适配器
 *
 * 职责：
 * - MiniMax Anthropic base URL 归一化
 * - Messages 请求构造
 * - Anthropic content blocks 解析
 *
 * 设计约束：
 * - 只做协议映射，不做业务决策
 * - 不在此处做 fake recover
 */

import { normalizeBaseUrl as normalizeBaseUrlAdapter } from "./openai-compat-adapter.js";

export type MiniMaxAnthropicTextBlock = {
    type: "text";
    text: string;
};

export type MiniMaxAnthropicThinkingBlock = {
    type: "thinking";
    thinking: string;
    signature?: string;
};

export type MiniMaxAnthropicToolUseBlock = {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
};

export type MiniMaxAnthropicToolResultBlock = {
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
};

export type MiniMaxAnthropicContentBlock =
    | MiniMaxAnthropicTextBlock
    | MiniMaxAnthropicThinkingBlock
    | MiniMaxAnthropicToolUseBlock
    | MiniMaxAnthropicToolResultBlock;

export interface MiniMaxAnthropicMessage {
    role: "user" | "assistant";
    content: string | MiniMaxAnthropicContentBlock[];
}

export interface MiniMaxAnthropicToolChoice {
    type: "auto" | "any" | "tool";
    name?: string;
}

export interface MiniMaxAnthropicNormalizedToolCall {
    id: string;
    name: string;
    arguments: string;
}

export interface MiniMaxAnthropicParsedResponse {
    role: "assistant";
    contentBlocks: MiniMaxAnthropicContentBlock[];
    textContent: string;
    toolCalls: MiniMaxAnthropicNormalizedToolCall[];
    stopReason: string | null;
    error?: string;
}

type MiniMaxAnthropicResponseShape = {
    role?: string;
    content?: unknown;
    stop_reason?: string;
    error?: { message?: string };
};

type MiniMaxAnthropicRequestShape = {
    model: string;
    messages: MiniMaxAnthropicMessage[];
    max_tokens: number;
    system?: string;
    tools?: readonly unknown[];
    tool_choice?: MiniMaxAnthropicToolChoice;
    temperature?: number;
};

export function normalizeMiniMaxAnthropicBaseUrl(raw: string): string {
    let base = normalizeBaseUrlAdapter(raw);

    if (base.endsWith("/anthropic/v1")) {
        base = base.slice(0, -3);
    }
    if (base.endsWith("/v1")) {
        base = base.slice(0, -3);
    }
    if (base.endsWith("/anthropic")) {
        return base;
    }
    return `${base}/anthropic`;
}

export function buildMiniMaxAnthropicHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
    };
    if (apiKey && apiKey.trim()) {
        headers["x-api-key"] = apiKey.trim();
    }
    return headers;
}

export function buildMiniMaxAnthropicRequest(params: {
    model: string;
    messages: MiniMaxAnthropicMessage[];
    maxTokens: number;
    system?: string;
    tools?: readonly unknown[];
    toolChoice?: MiniMaxAnthropicToolChoice;
    temperature?: number;
}): string {
    const body: MiniMaxAnthropicRequestShape = {
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens,
    };

    if (params.system && params.system.trim()) {
        body.system = params.system.trim();
    }
    if (params.tools && params.tools.length > 0) {
        body.tools = params.tools;
    }
    if (params.toolChoice) {
        body.tool_choice = params.toolChoice;
    }
    if (params.temperature !== undefined) {
        body.temperature = params.temperature;
    }

    return JSON.stringify(body);
}

function asContentBlocks(value: unknown): MiniMaxAnthropicContentBlock[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is MiniMaxAnthropicContentBlock => {
        if (!item || typeof item !== "object") return false;
        const block = item as { type?: unknown };
        return typeof block.type === "string";
    });
}

export function extractTextFromMiniMaxAnthropicContent(
    blocks: MiniMaxAnthropicContentBlock[]
): string {
    const parts: string[] = [];
    for (const block of blocks) {
        if (block.type === "text" && typeof block.text === "string") {
            parts.push(block.text);
        }
    }
    return parts.join("\n").trim();
}

export function extractToolCallsFromMiniMaxAnthropicContent(
    blocks: MiniMaxAnthropicContentBlock[]
): MiniMaxAnthropicNormalizedToolCall[] {
    const calls: MiniMaxAnthropicNormalizedToolCall[] = [];
    for (const block of blocks) {
        if (block.type !== "tool_use") continue;
        calls.push({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
        });
    }
    return calls;
}

export function parseMiniMaxAnthropicResponse(raw: string): MiniMaxAnthropicParsedResponse {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return {
            role: "assistant",
            contentBlocks: [],
            textContent: "",
            toolCalls: [],
            stopReason: null,
            error: "Invalid JSON response",
        };
    }

    const record = (data && typeof data === "object") ? (data as MiniMaxAnthropicResponseShape) : null;
    if (!record) {
        return {
            role: "assistant",
            contentBlocks: [],
            textContent: "",
            toolCalls: [],
            stopReason: null,
            error: "Invalid response format",
        };
    }

    if (record.error?.message) {
        return {
            role: "assistant",
            contentBlocks: [],
            textContent: "",
            toolCalls: [],
            stopReason: null,
            error: record.error.message,
        };
    }

    const contentBlocks = asContentBlocks(record.content);
    return {
        role: "assistant",
        contentBlocks,
        textContent: extractTextFromMiniMaxAnthropicContent(contentBlocks),
        toolCalls: extractToolCallsFromMiniMaxAnthropicContent(contentBlocks),
        stopReason: typeof record.stop_reason === "string" ? record.stop_reason : null,
    };
}

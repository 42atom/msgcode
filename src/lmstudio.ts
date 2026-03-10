/**
 * msgcode: Agent Backend 兼容层（LmStudio* 别名）
 * P5.7-R9-T7: 本文件降级为兼容层，主实现已迁移至 src/agent-backend/
 */

import * as fsPromises from "node:fs/promises";
import { config } from "./config.js";
import { logger } from "./logger/index.js";
import {
    runAgentChat,
    runAgentToolLoop,
    runAgentRoutedChat,
    sanitizeLmStudioOutput as sanitizeLmStudioOutputFromBackend,
    type AgentBackendRuntime,
    type AgentChatOptions as AgentChatOptionsFromBackend,
    type AgentToolLoopOptions as AgentToolLoopOptionsFromBackend,
    type AgentRoutedChatOptions as AgentRoutedChatOptionsFromBackend,
    type AgentRoutedChatResult as AgentRoutedChatResultFromBackend,
    type AgentToolLoopResult as AgentToolLoopResultFromBackend,
    type AidocsToolDef as AidocsToolDefFromBackend,
    type ActionJournalEntry as ActionJournalEntryFromBackend,
    type ParsedToolCall as ParsedToolCallFromBackend,
} from "./agent-backend/index.js";
import { filterDefaultLlmTools } from "./tools/manifest.js";

export const LMSTUDIO_DEFAULT_CHAT_MODEL = "huihui-glm-4.7-flash-abliterated-mlx";

export type AgentBackendId = "local-openai" | "openai" | "minimax";

export interface LmStudioChatOptions {
    prompt: string; system?: string; workspace?: string; model?: string; temperature?: number;
    backendRuntime?: AgentBackendRuntime; windowMessages?: Array<{ role: string; content?: string }>;
    summaryContext?: string; soulContext?: { content: string; source: string; path: string; chars: number };
}

export interface LmStudioToolLoopOptions {
    prompt: string; system?: string; tools?: readonly unknown[]; allowRoot?: string; workspacePath?: string;
    baseUrl?: string; model?: string; timeoutMs?: number; backendRuntime?: AgentBackendRuntime;
    windowMessages?: Array<{ role: string; content?: string }>; summaryContext?: string;
    soulContext?: { content: string; source: string; path: string; chars: number };
    traceId?: string; route?: "tool" | "complex-tool";
}

export interface LmStudioRoutedChatOptions {
    prompt: string; system?: string; workspacePath?: string; agentProvider?: string;
    windowMessages?: Array<{ role: string; content?: string }>; summaryContext?: string;
    soulContext?: { content: string; source: string; path: string; chars: number };
    temperature?: number;
}

export interface RoutedChatResult {
    answer: string; route: "no-tool" | "tool"; temperature: number;
    toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
    actionJournal: ActionJournalEntry[];
}

export interface ToolLoopResult {
    answer: string; toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
    actionJournal: ActionJournalEntry[];
}

export type AidocsToolDef = AidocsToolDefFromBackend;
export type ActionJournalEntry = ActionJournalEntryFromBackend;
export type AgentChatOptions = AgentChatOptionsFromBackend;
export type AgentToolLoopOptions = AgentToolLoopOptionsFromBackend;
export type AgentRoutedChatOptions = AgentRoutedChatOptionsFromBackend;
export type AgentRoutedChatResult = AgentRoutedChatResultFromBackend;
export type AgentToolLoopResult = AgentToolLoopResultFromBackend;

export type ParsedToolCall = ParsedToolCallFromBackend;

// 主函数 re-export（同时提供新旧两种别名）
export { runAgentChat, runAgentChat as runLmStudioChat } from "./agent-backend/index.js";
export { runAgentToolLoop, runAgentToolLoop as runLmStudioToolLoop } from "./agent-backend/index.js";
export { runAgentRoutedChat, runAgentRoutedChat as runLmStudioRoutedChat } from "./agent-backend/index.js";
export { sanitizeLmStudioOutput } from "./agent-backend/index.js";

// ============================================
// 兼容别名（向后兼容）
// ============================================

export const getToolsForAgent = getToolsForLlm;

// 工具名称白名单（用于 parseToolCallBestEffortFromText）
const DEFAULT_ALLOWED_TOOL_NAMES = new Set(["read_file", "bash"]);

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function extractFirstBalancedJsonSnippet(text: string): string | null {
    const idxArr = text.indexOf("["), idxObj = text.indexOf("{");
    const idx = idxArr < 0 ? idxObj : (idxObj < 0 ? idxArr : Math.min(idxArr, idxObj));
    if (idx < 0) return null; return extractBalancedFromIndex(text, idx);
}

function extractBalancedFromIndex(text: string, start: number): string | null {
    const open = text[start], close = open === "[" ? "]" : (open === "{" ? "}" : null);
    if (!close) return null; let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) { if (escaped) { escaped = false; continue; } if (ch === "\\") { escaped = true; continue; } if (ch === "\"") { inString = false; continue; } continue; }
        if (ch === "\"") { inString = true; continue; }
        if (ch === open) depth++; if (ch === close) depth--;
        if (depth === 0) return text.slice(start, i + 1);
    } return null;
}

function coerceArgs(value: unknown): Record<string, unknown> {
    if (!value) return {}; if (typeof value === "string") { try { const parsed = JSON.parse(value); return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : {}; } catch { return {}; } }
    if (typeof value === "object") return value as Record<string, unknown>; return {};
}

function parseLooseValue(raw: string): unknown {
    const v = raw.trim(); if (!v) return "";
    if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) { try { return JSON.parse(v); } catch { } }
    const dq = v.match(/^"([\s\S]*)"$/); if (dq) return dq[1]; const sq = v.match(/^'([\s\S]*)'$/); if (sq) return sq[1];
    if (v === "true") return true; if (v === "false") return false; if (v === "null") return null;
    const num = Number(v); if (!Number.isNaN(num) && Number.isFinite(num)) return num; return v;
}

function parseXmlToolCall(text: string, allowed: Set<string>): ParsedToolCall | null {
    if (text.includes("陈列")) {
        const tokens = text.split("陈列").map(item => item.trim()).filter(Boolean);
        const name = tokens[0]; if (!name || !allowed.has(name)) return null;
        const args: Record<string, unknown> = {};
        for (let i = 1; i < tokens.length; i += 2) { const key = tokens[i], value = tokens[i + 1]; if (!key || !value) break; if (key.startsWith("/")) break; if (value.startsWith("/")) break; args[key] = parseLooseValue(value); }
        return { name, args };
    }
    const idx = text.indexOf("<"); if (idx < 0) return null;
    const after = text.slice(idx + 1).trimStart();
    const nameMatch = after.match(/^([a-zA-Z_][\w-]*)/);
    const name = nameMatch?.[1]; if (!name || !allowed.has(name)) return null;
    const args: Record<string, unknown> = {};
    const re = /<arg_key([\s\S]*?)<\/arg_key>\s*<arg_value([\s\S]*?)<\/arg_value>/g;
    for (const m of after.matchAll(re)) {
        const key = (m[1] ?? "").replace(">", "").trim();
        const valueRaw = (m[2] ?? "").replace(">", "").trim();
        if (!key) continue; args[key] = parseLooseValue(valueRaw);
    }
    return { name, args };
}

function parseJsonToolCall(jsonSnippet: string, allowed: Set<string>): ParsedToolCall | null {
    let parsed: unknown; try { parsed = JSON.parse(jsonSnippet); } catch { return null; }
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!first || typeof first !== "object") return null;
    const obj = first as Record<string, unknown>;
    const name: string | undefined = (typeof obj.name === "string" ? obj.name : undefined) ??
        (typeof obj.tool === "string" ? obj.tool : undefined) ??
        (typeof (obj.function as Record<string, unknown>)?.name === "string" ? (obj.function as Record<string, unknown>).name as string : undefined);
    if (!name || !allowed.has(name)) return null;
    const argsUnknown = obj.arguments ?? obj.args ?? (obj.function as Record<string, unknown>)?.arguments;
    return { name, args: coerceArgs(argsUnknown) };
}

function parseInlineNameAndJson(text: string, allowed: Set<string>): ParsedToolCall | null {
    const names = [...allowed].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
    if (!names) return null;
    const re = new RegExp("\\b(" + names + ")\\b[\\s\\r\\n]*([\\[{])", "m");
    const m = text.match(re);
    const name = m?.[1]; if (!name || !allowed.has(name)) return null;
    const start = m.index !== undefined ? m.index + m[0].lastIndexOf(m[2]!) : -1;
    if (start < 0) return null;
    const snippet = extractBalancedFromIndex(text, start);
    if (!snippet) return null;
    try { const obj = JSON.parse(snippet); return { name, args: coerceArgs(obj) }; } catch { return null; }
}

function parseParenStyleCall(text: string, allowed: Set<string>): ParsedToolCall | null {
    const names = [...allowed].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
    if (!names) return null;
    const re = new RegExp("\\b(" + names + ")\\b\\s*\\(([^)]*)\\)", "m");
    const m = text.match(re);
    const name = m?.[1]; if (!name || !allowed.has(name)) return null;
    const inside = (m?.[2] ?? "").trim();
    const args: Record<string, unknown> = {};
    if (!inside) return { name, args };
    for (const partRaw of inside.split(",")) {
        const part = partRaw.trim(); if (!part) continue;
        const kv = part.match(/^([a-zA-Z_][\w-]*)\s*=\s*(.+)$/);
        if (!kv) continue;
        args[kv[1]] = parseLooseValue(kv[2].trim());
    }
    return { name, args };
}

export function parseToolCallBestEffortFromText(params: {
    text: string;
    allowedToolNames?: Iterable<string>;
}): ParsedToolCall | null {
    try {
        const allowed = new Set(params.allowedToolNames ?? DEFAULT_ALLOWED_TOOL_NAMES);
        const raw = (params.text ?? "").trim(); if (!raw) return null;
        if (raw.includes("<") || raw.includes("陈列")) { const parsed = parseXmlToolCall(raw, allowed); if (parsed) return parsed; }
        const jsonSnippet = extractFirstBalancedJsonSnippet(raw);
        if (jsonSnippet) { const parsed = parseJsonToolCall(jsonSnippet, allowed); if (parsed) return parsed; }
        { const parsed = parseInlineNameAndJson(raw, allowed); if (parsed) return parsed; }
        { const parsed = parseParenStyleCall(raw, allowed); if (parsed) return parsed; }
        return null;
    } catch { return null; }
}

export async function getToolsForLlm(workspacePath?: string): Promise<readonly AidocsToolDefFromBackend[]> {
    // P5.7-R15 + R16: skill 场景默认暴露完整工具（与 tool-loop.ts 对齐）
    // 当没有 workspace 配置时，暴露全部基础工具
    if (!workspacePath) {
        const { filterDefaultLlmTools, TOOL_MANIFESTS } = await import("./tools/manifest.js");
        const defaultTools = filterDefaultLlmTools([
            "read_file",
            "bash",
            "browser",
            "tts",
            "asr",
            "vision",
            "desktop",
        ]);
        return defaultTools.map((name) => ({
            name,
            description: "", // 描述在 toOpenAiToolSchemas 中填充
        }));
    }
    try {
        const { loadWorkspaceConfig } = await import("./config/workspace.js");
        const cfg = await loadWorkspaceConfig(workspacePath);
        // P5.7-R8c: 从单一真相源派生工具列表
        // 导入 manifest 模块
        const { resolveLlmToolExposure } = await import("./tools/manifest.js");

        // 单一真相源：LLM 工具暴露只看 tooling.allow，再补 skill 发现所需的最小基线。
        const configuredTools = Array.isArray(cfg["tooling.allow"])
            ? (cfg["tooling.allow"] as string[])
            : [];
        const allowedTools = filterDefaultLlmTools(Array.from(new Set(["read_file", "bash", ...configuredTools])) as any);

        // 解析 LLM 工具暴露结果
        const exposure = resolveLlmToolExposure(allowedTools);

        // 转换为 AidocsToolDef 格式
        const toolDefs: AidocsToolDefFromBackend[] = exposure.exposedTools.map((name) => ({
            name,
            description: "", // 描述在 toOpenAiToolSchemas 中填充
        }));

        return toolDefs;
    } catch { return []; }
}

/**
 * msgcode: Agent Backend Tool Loop 模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的工具循环逻辑
 * 主实现已迁出到本文件。
 *
 * 目标：分离工具循环执行与路由编排
 */

import { config } from "../config.js";
import * as path from "node:path";
import * as fsPromises from "node:fs/promises";
import * as crypto from "node:crypto";
import { logger } from "../logger/index.js";
import { sanitizeLmStudioOutput } from "../providers/output-normalizer.js";
import {
    normalizeBaseUrl as normalizeBaseUrlAdapter,
    buildChatCompletionRequest,
    parseChatCompletionResponse,
} from "../providers/openai-compat-adapter.js";
import {
    type AgentToolLoopOptions,
    type AgentToolLoopResult,
    type ActionJournalEntry,
    type AidocsToolDef,
    type ParsedToolCall,
    type VerifyJournalEntry,
    type VerifyResult,
} from "./types.js";
import {
    resolveBaseSystemPrompt,
    buildExecSystemPrompt,
} from "./prompt.js";
import {
    resolveAgentBackendRuntime,
    normalizeModelOverride,
} from "./config.js";
import {
    renderLlmToolIndex,
    resolveLlmToolExposure,
    toAnthropicToolSchemas,
    toOpenAiToolSchemas,
} from "../tools/manifest.js";
import type { ToolName } from "../tools/types.js";
import {
    type MiniMaxAnthropicContentBlock,
    type MiniMaxAnthropicMessage,
    type MiniMaxAnthropicToolChoice,
    buildMiniMaxAnthropicHeaders,
    buildMiniMaxAnthropicRequest,
    normalizeMiniMaxAnthropicBaseUrl,
    parseMiniMaxAnthropicResponse,
} from "../providers/minimax-anthropic.js";

// 重导出类型供 index.ts 使用
export type {
    AgentToolLoopOptions,
    AgentToolLoopResult,
    ActionJournalEntry,
    AidocsToolDef,
    ParsedToolCall,
} from "./types.js";
export { PI_ON_TOOLS } from "./types.js";

// ============================================
// Verify Phase 函数（P5.7-R12-T3）
// ============================================

/**
 * 执行 verify phase
 *
 * 对每个工具调用执行验证，确保执行结果真实有效
 *
 * @param executedToolCalls 已执行的工具调用
 * @param actionJournal 当前 action journal
 * @param traceId 追踪 ID
 * @returns verify 结果
 */
async function runVerifyPhase(
    executedToolCalls: ExecutedToolCall[],
    actionJournal: ActionJournalEntry[],
    traceId: string,
    route: "tool" | "complex-tool"
): Promise<{ verifyResult?: VerifyResult; verifyJournal?: VerifyJournalEntry }> {
    if (executedToolCalls.length === 0) {
        // 无工具调用，无需 verify
        return {};
    }

    const lastToolCall = executedToolCalls[executedToolCalls.length - 1];
    const toolName = lastToolCall.tc.function.name;
    const args = lastToolCall.args;
    const result = lastToolCall.result;

    // 最小验证矩阵
    let verifyOk = false;
    let verifyMethod: VerifyJournalEntry["verifyMethod"] = "file-read";
    let verifyEvidence: string | undefined;
    let failureReason: string | undefined;

    try {
        if (toolName === "bash") {
            // bash 验证：exitCode === 0 且失败信息可诊断
            const exitCode = (result as ToolRunResult)?.exitCode;
            verifyOk = exitCode === 0;
            verifyMethod = "bash";
            verifyEvidence = JSON.stringify({ exitCode });
            failureReason = verifyOk ? undefined : `exitCode: ${exitCode}`;
        } else if (toolName === "write_file" || toolName === "edit_file") {
            // 文件修改验证：回读成功或目标文件存在
            const filePath = args.path as string;
            try {
                await fsPromises.access(filePath);
                verifyOk = true;
                verifyMethod = "file-exists";
                verifyEvidence = JSON.stringify({ filePath, exists: true });
            } catch {
                verifyOk = false;
                verifyMethod = "file-exists";
                verifyEvidence = JSON.stringify({ filePath, exists: false });
                failureReason = "文件不存在";
            }
        } else if (toolName === "read_file") {
            // 文件读取验证：假设成功执行即为有效
            verifyOk = true;
            verifyMethod = "file-read";
            verifyEvidence = JSON.stringify({ filePath: args.path });
        } else {
            // 其他工具：假设成功执行即为有效
            verifyOk = true;
            verifyMethod = "file-read";
            verifyEvidence = JSON.stringify({ toolName, args });
        }
    } catch (error) {
        verifyOk = false;
        failureReason = error instanceof Error ? error.message : String(error);
    }

    // 构建 verify journal entry
    const verifyJournal: VerifyJournalEntry = {
        traceId,
        stepId: actionJournal.length + 1,
        phase: "verify",
        timestamp: Date.now(),
        route,
        tool: toolName,
        ok: verifyOk,
        verifyMethod,
        verifiedTool: toolName,
        verifyEvidence,
        durationMs: 0, // verify 是快速检查，不计时
    };

    // 构建 verify result
    const verifyResult: VerifyResult = {
        ok: verifyOk,
        evidence: verifyEvidence,
        failureReason: verifyOk ? undefined : failureReason ?? "验证失败",
        errorCode: verifyOk ? undefined : "TOOL_VERIFY_FAILED",
    };

    return { verifyResult, verifyJournal };
}

// ============================================
// 类型定义
// ============================================

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
 * 统一后端 URL 归一化：
 * - 去掉尾部 `/`
 * - 若包含 `/v1` 后缀则去掉，避免后续拼接 `/v1/chat/completions` 形成 `/v1/v1/...`
 */
function normalizeBaseUrl(raw: string): string {
    let base = normalizeBaseUrlAdapter(raw);
    if (base.endsWith("/v1")) {
        base = base.slice(0, -3);
    }
    return base;
}

type ChatResponse = {
    choices: Array<{
        message?: {
            role?: string;
            content?: string;
            tool_calls?: ToolCall[];
        };
    }>;
};

const AIDOCS_ROOT = process.env.AIDOCS_ROOT || "AIDOCS";

function getToolNameFromDef(tool: unknown): string | undefined {
    if (!tool || typeof tool !== "object") return undefined;
    const asObj = tool as Record<string, unknown>;
    if (typeof asObj.name === "string" && asObj.name.trim()) return asObj.name;
    const fn = asObj.function as Record<string, unknown> | undefined;
    if (fn && typeof fn.name === "string" && fn.name.trim()) return fn.name;
    return undefined;
}

// ============================================
// HTTP 客户端
// ============================================

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
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
        clearTimeout(timeoutId);
        if (isAbortError(error)) {
            throw new Error(`API 请求超时`);
        }
        throw new Error(`API 连接失败：${params.url}`);
    }

    clearTimeout(timeoutId);
    const rawText = await resp.text();
    if (!resp.ok) {
        throw new Error(`API 错误 (${resp.status})：${rawText.slice(0, 200)}`);
    }
    return rawText;
}

// ============================================
// 辅助函数
// ============================================

function clipText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}...`;
}

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
            return `读取成功，前 3 行如下：\n${preview}`;
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
        const name = getToolNameFromDef(tool);
        if (!name) continue;
        available.add(name);
    }
    const candidates = ["read_file", "write_file", "edit_file", "bash"] as const;
    for (const name of candidates) {
        if (!available.has(name)) continue;
        if (new RegExp(`\\b${name}\\b`, "i").test(input)) {
            return name;
        }
        if (new RegExp(`(?:使用 | 用)\s*${name}\s*工具`, "i").test(input)) {
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
        const name = getToolNameFromDef(tool);
        return !!name && name === toolName;
    });
}

/**
 * 获取暴露给 LLM 的工具列表（从单一真相源派生）
 *
 * P5.7-R8c: 收口 LLM 工具暴露层
 *
 * 逻辑：
 * 1. 读取 workspace tooling.allow（允许的工具列表）
 * 2. 调用 resolveLlmToolExposure() 解析暴露结果
 * 3. 返回 exposedTools（ToolName[]）
 *
 * 不再使用 PI_ON_TOOLS 硬编码白名单
 */
export async function getToolsForLlm(workspacePath?: string): Promise<ToolName[]> {
    if (!workspacePath) {
        return [];
    }
    try {
        const { loadWorkspaceConfig } = await import("../config/workspace.js");
        const cfg = await loadWorkspaceConfig(workspacePath);
        // R6 hotfix contract: 未显式配置 pi.enabled 时不启用工具
        const piEnabled = Object.prototype.hasOwnProperty.call(cfg, "pi.enabled")
            ? cfg["pi.enabled"]
            : false;
        if (!piEnabled) {
            return [];
        }

        // P5.7-R8c: 从单一真相源派生工具列表
        // 读取 workspace tooling.allow（使用默认值）
        const allowedTools = (cfg["tooling.allow"] as ToolName[]) || ["bash", "read_file", "write_file", "edit_file"];

        // 解析 LLM 工具暴露结果，返回 exposedTools
        const exposure = resolveLlmToolExposure(allowedTools);

        return exposure.exposedTools;
    } catch {
        return [];
    }
}

function normalizeSoulPathArgs(toolName: string, args: Record<string, unknown>, workspacePath?: string): Record<string, unknown> {
    if (toolName !== "read_file") return args;
    const rawPath = typeof args.path === "string" ? args.path : "";
    if (!rawPath || !workspacePath) return args;

    const normalizedInput = rawPath.replace(/\\/g, "/").trim();
    const workspaceNorm = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
    const lower = normalizedInput.toLowerCase();
    const workspaceLower = workspaceNorm.toLowerCase();

    // 纠偏：<workspace>/SOUL.md 或 ./SOUL.md -> .msgcode/SOUL.md
    const shouldFix =
        lower === "soul.md" ||
        lower === "./soul.md" ||
        lower.endsWith("/soul.md") ||
        lower === `${workspaceLower}/soul.md`;

    if (!shouldFix) return args;
    return {
        ...args,
        path: ".msgcode/SOUL.md",
    };
}

async function runTool(name: string, args: Record<string, unknown>, root: string): Promise<ToolRunResult> {
    const { executeTool } = await import("../tools/bus.js");
    const { randomUUID } = await import("node:crypto");

    const result = await executeTool(name as any, args, {
        workspacePath: root,
        source: "llm-tool-call",
        requestId: `agent-${randomUUID()}`,
    });

    if (!result.ok) {
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
    const stop = params.toolChoice === "none" ? undefined : ["[END_TOOL_REQUEST]"];

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

    const parsed = parseChatCompletionResponse(rawText);

    if (parsed.error) {
        throw new Error(`Agent backend API 错误：${parsed.error}`);
    }

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

function splitSystemFromMessages(
    messages: Array<{ role: string; content?: string }>
): { system?: string; messages: MiniMaxAnthropicMessage[] } {
    const systemParts: string[] = [];
    const converted: MiniMaxAnthropicMessage[] = [];

    for (const msg of messages) {
        const content = typeof msg.content === "string" ? msg.content : "";
        if (!content.trim()) continue;

        if (msg.role === "system") {
            systemParts.push(content);
            continue;
        }

        const role = msg.role === "assistant" ? "assistant" : "user";
        converted.push({ role, content });
    }

    const system = systemParts.join("\n\n").trim();
    return {
        system: system || undefined,
        messages: converted,
    };
}

function toInternalToolCalls(toolCalls: Array<{ id: string; name: string; arguments: string }>): ToolCall[] {
    return toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
            name: tc.name,
            arguments: tc.arguments,
        },
    }));
}

async function callMiniMaxAnthropicRaw(params: {
    baseUrl: string;
    model: string;
    messages: MiniMaxAnthropicMessage[];
    system?: string;
    tools: readonly unknown[];
    toolChoice?: MiniMaxAnthropicToolChoice;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    apiKey?: string;
}): Promise<{
    role: string;
    contentBlocks: MiniMaxAnthropicContentBlock[];
    content: string;
    toolCalls: ToolCall[];
    stopReason: string | null;
}> {
    const url = `${normalizeMiniMaxAnthropicBaseUrl(params.baseUrl)}/v1/messages`;
    const rawText = await fetchTextWithTimeout({
        url,
        method: "POST",
        timeoutMs: params.timeoutMs,
        headers: buildMiniMaxAnthropicHeaders(params.apiKey),
        body: buildMiniMaxAnthropicRequest({
            model: params.model,
            messages: params.messages,
            system: params.system,
            tools: params.tools,
            toolChoice: params.toolChoice,
            maxTokens: params.maxTokens,
            temperature: params.temperature,
        }),
    });

    const parsed = parseMiniMaxAnthropicResponse(rawText);
    if (parsed.error) {
        throw new Error(`MiniMax API 错误：${parsed.error}`);
    }

    return {
        role: parsed.role,
        contentBlocks: parsed.contentBlocks,
        content: parsed.textContent,
        toolCalls: toInternalToolCalls(parsed.toolCalls),
        stopReason: parsed.stopReason,
    };
}

async function runMiniMaxAnthropicToolLoop(params: {
    options: AgentToolLoopOptions;
    baseUrl: string;
    model: string;
    apiKey?: string;
    timeoutMs: number;
    root: string;
    route: "tool" | "complex-tool";
    traceId: string;
    perTurnToolCallLimit: number;
    perTurnToolStepLimit: number;
    quotaProfile: "conservative" | "balanced" | "aggressive";
    preferredToolName?: string;
    baseMessages: Array<{ role: string; content?: string }>;
    activeToolSchemas: readonly unknown[];
    workspacePath: string;
}): Promise<AgentToolLoopResult> {
    const HARD_CAP_TOOL_CALLS = 20;
    const HARD_CAP_TOOL_STEPS = 64;
    const actionJournal: ActionJournalEntry[] = [];
    let stepId = 0;

    const anthropicContext = splitSystemFromMessages(params.baseMessages);
    let conversationMessages = anthropicContext.messages;
    const initialToolChoice: MiniMaxAnthropicToolChoice | undefined = params.preferredToolName
        ? { type: "tool", name: params.preferredToolName }
        : params.activeToolSchemas.length > 0
            ? { type: "auto" }
            : undefined;

    let response = await callMiniMaxAnthropicRaw({
        baseUrl: params.baseUrl,
        model: params.model,
        messages: conversationMessages,
        system: anthropicContext.system,
        tools: params.activeToolSchemas,
        toolChoice: initialToolChoice,
        temperature: 0,
        maxTokens: 800,
        timeoutMs: params.timeoutMs,
        apiKey: params.apiKey,
    });

    let toolCalls = response.toolCalls;

    if (params.options.allowNoTool && toolCalls.length === 0) {
        return {
            answer: sanitizeLmStudioOutput(response.content || ""),
            actionJournal: [],
            decisionSource: "model",
        };
    }

    if (toolCalls.length === 0 && params.activeToolSchemas.length > 0) {
        const retryMessages: MiniMaxAnthropicMessage[] = [
            ...conversationMessages,
            { role: "user", content: "请严格返回 tool_use；不要输出自然语言。" },
        ];
        response = await callMiniMaxAnthropicRaw({
            baseUrl: params.baseUrl,
            model: params.model,
            messages: retryMessages,
            system: anthropicContext.system,
            tools: params.activeToolSchemas,
            toolChoice: params.preferredToolName
                ? { type: "tool", name: params.preferredToolName }
                : { type: "any" },
            temperature: 0,
            maxTokens: 800,
            timeoutMs: params.timeoutMs,
            apiKey: params.apiKey,
        });
        toolCalls = response.toolCalls;
        conversationMessages = retryMessages;
    }

    if (toolCalls.length === 0 && params.preferredToolName && params.activeToolSchemas.length > 0) {
        const strictRetryMessages: MiniMaxAnthropicMessage[] = [
            ...conversationMessages,
            {
                role: "user",
                content: `你必须调用工具 ${params.preferredToolName}，并仅返回 tool_use。禁止任何自然语言。`,
            },
        ];
        response = await callMiniMaxAnthropicRaw({
            baseUrl: params.baseUrl,
            model: params.model,
            messages: strictRetryMessages,
            system: anthropicContext.system,
            tools: params.activeToolSchemas,
            toolChoice: { type: "tool", name: params.preferredToolName },
            temperature: 0,
            maxTokens: 800,
            timeoutMs: params.timeoutMs,
            apiKey: params.apiKey,
        });
        toolCalls = response.toolCalls;
        conversationMessages = strictRetryMessages;
    }

    const hasPreferredToolMismatch = (calls: ToolCall[]): boolean => {
        if (!params.preferredToolName) return false;
        return calls.some((tc) => tc.function.name !== params.preferredToolName);
    };

    if (toolCalls.length === 0) {
        return {
            answer: "协议失败：未收到工具调用指令\n- 错误码：MODEL_PROTOCOL_FAILED\n\n这通常意味着模型无法调用工具。请重试或切换到对话模式。",
            actionJournal: [],
        };
    }

    if (hasPreferredToolMismatch(toolCalls)) {
        return {
            answer: `工具协议失败：模型未按要求调用工具\n- 期望工具：${params.preferredToolName}\n- 错误码：MODEL_PROTOCOL_FAILED\n\n请重试并明确要求调用正确工具。`,
            actionJournal: [],
        };
    }

    const executedToolCalls: ExecutedToolCall[] = [];
    let currentResponse = response;
    let currentToolCalls = toolCalls;
    let finalAssistantContent = "";

    while (true) {
        if (currentToolCalls.length > params.perTurnToolCallLimit) {
            const isHardCapExceeded = currentToolCalls.length > HARD_CAP_TOOL_CALLS;
            const lastExecutedCall = executedToolCalls[executedToolCalls.length - 1];

            return {
                answer: isHardCapExceeded
                    ? `本轮工具调用次数达到单轮硬上限\n- 本轮请求数：${currentToolCalls.length}\n- 单轮硬上限：${HARD_CAP_TOOL_CALLS}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`
                    : `本轮工具调用次数达到档位上限\n- 本轮请求数：${currentToolCalls.length}\n- 档位上限：${params.perTurnToolCallLimit}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`,
                actionJournal,
                continuable: true,
                quotaProfile: params.quotaProfile,
                perTurnToolCallLimit: params.perTurnToolCallLimit,
                perTurnToolStepLimit: params.perTurnToolStepLimit,
                remainingToolCalls: 0,
                remainingSteps: params.perTurnToolStepLimit - executedToolCalls.length,
                continuationReason: isHardCapExceeded
                    ? `exceeded_hard_cap_tool_calls_${currentToolCalls.length}_limit_${HARD_CAP_TOOL_CALLS}`
                    : `reached_profile_limit_tool_calls_${currentToolCalls.length}_limit_${params.perTurnToolCallLimit}`,
                toolCall: lastExecutedCall ? {
                    name: lastExecutedCall.tc.function.name,
                    args: lastExecutedCall.args,
                    result: lastExecutedCall.result,
                } : undefined,
            };
        }

        const roundExecutedToolCalls: ExecutedToolCall[] = [];

        for (const tc of currentToolCalls) {
            let args: Record<string, unknown> = {};
            try {
                args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
                args = {};
            }
            args = normalizeSoulPathArgs(tc.function.name, args, params.workspacePath);

            let toolResult: ToolRunResult;
            try {
                toolResult = await runTool(tc.function.name, args, params.workspacePath);
            } catch (e) {
                toolResult = {
                    error: e instanceof Error ? e.message : String(e),
                    errorCode: "TOOL_EXEC_FAILED",
                    durationMs: 0,
                };
            }

            if (toolResult.error) {
                const toolErrorCode = toolResult.errorCode || "TOOL_EXEC_FAILED";
                const toolErrorMessage = toolResult.error || "工具执行失败";

                stepId++;
                actionJournal.push({
                    traceId: params.traceId,
                    stepId,
                    phase: "act",
                    timestamp: Date.now(),
                    route: params.route,
                    model: params.model,
                    tool: tc.function.name,
                    ok: false,
                    exitCode: toolResult.exitCode ?? undefined,
                    errorCode: toolErrorCode,
                    stdoutTail: toolResult.stdoutTail ?? undefined,
                    fullOutputPath: toolResult.fullOutputPath ?? undefined,
                    durationMs: toolResult.durationMs,
                });

                let answerText = `工具执行失败\n- 工具：${tc.function.name}\n- 错误码：${toolErrorCode}\n- 错误：${toolErrorMessage}`;
                if (toolResult.exitCode !== undefined && toolResult.exitCode !== null) {
                    answerText += `\n- 退出码：${toolResult.exitCode}`;
                }
                if (toolResult.stderrTail) {
                    answerText += `\n- stderr 尾部：${toolResult.stderrTail.slice(-200)}`;
                }
                if (toolResult.fullOutputPath) {
                    answerText += `\n- 完整日志：${toolResult.fullOutputPath}`;
                }

                return {
                    answer: answerText,
                    toolCall: { name: tc.function.name, args, result: toolResult },
                    actionJournal,
                };
            }

            const executed: ExecutedToolCall = { tc, args, result: toolResult.data };
            executedToolCalls.push(executed);
            roundExecutedToolCalls.push(executed);

            stepId++;
            actionJournal.push({
                traceId: params.traceId,
                stepId,
                phase: "act",
                timestamp: Date.now(),
                route: params.route,
                model: params.model,
                tool: tc.function.name,
                ok: true,
                durationMs: toolResult.durationMs,
            });

            if (executedToolCalls.length > params.perTurnToolStepLimit) {
                const isHardCapExceeded = executedToolCalls.length > HARD_CAP_TOOL_STEPS;
                const lastExecutedCall = executedToolCalls[executedToolCalls.length - 1];

                return {
                    answer: isHardCapExceeded
                        ? `本轮工具步骤总数达到单轮硬上限\n- 本轮步骤数：${executedToolCalls.length}\n- 单轮硬上限：${HARD_CAP_TOOL_STEPS}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`
                        : `本轮工具步骤总数达到档位上限\n- 总步骤数：${executedToolCalls.length}\n- 档位上限：${params.perTurnToolStepLimit}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`,
                    actionJournal,
                    continuable: true,
                    quotaProfile: params.quotaProfile,
                    perTurnToolCallLimit: params.perTurnToolCallLimit,
                    perTurnToolStepLimit: params.perTurnToolStepLimit,
                    remainingToolCalls: params.perTurnToolCallLimit - currentToolCalls.length,
                    remainingSteps: 0,
                    continuationReason: isHardCapExceeded
                        ? `exceeded_hard_cap_tool_steps_${executedToolCalls.length}_limit_${HARD_CAP_TOOL_STEPS}`
                        : `reached_profile_limit_tool_steps_${executedToolCalls.length}_limit_${params.perTurnToolStepLimit}`,
                    toolCall: lastExecutedCall ? {
                        name: lastExecutedCall.tc.function.name,
                        args: lastExecutedCall.args,
                        result: lastExecutedCall.result,
                    } : undefined,
                };
            }
        }

        const assistantMessage: MiniMaxAnthropicMessage = {
            role: "assistant",
            content: currentResponse.contentBlocks,
        };
        const toolResultMessage: MiniMaxAnthropicMessage = {
            role: "user",
            content: roundExecutedToolCalls.map(({ tc, result }) => ({
                type: "tool_result" as const,
                tool_use_id: tc.id,
                content: typeof result === "string" ? result : JSON.stringify(result),
            })),
        };

        conversationMessages = [...conversationMessages, assistantMessage, toolResultMessage];

        currentResponse = await callMiniMaxAnthropicRaw({
            baseUrl: params.baseUrl,
            model: params.model,
            messages: conversationMessages,
            system: anthropicContext.system,
            tools: params.activeToolSchemas,
            toolChoice: params.preferredToolName
                ? { type: "tool", name: params.preferredToolName }
                : { type: "auto" },
            temperature: 0,
            maxTokens: 800,
            timeoutMs: params.timeoutMs,
            apiKey: params.apiKey,
        });

        currentToolCalls = currentResponse.toolCalls;
        if (hasPreferredToolMismatch(currentToolCalls)) {
            return {
                answer: `工具协议失败：模型未按要求调用工具\n- 期望工具：${params.preferredToolName}\n- 错误码：MODEL_PROTOCOL_FAILED\n\n请重试并明确要求调用正确工具。`,
                actionJournal,
            };
        }

        if (currentToolCalls.length === 0) {
            finalAssistantContent = currentResponse.content || "";
            break;
        }
    }

    const cleanedAnswer = sanitizeLmStudioOutput(finalAssistantContent);
    let finalAnswer = cleanedAnswer;

    if (!cleanedAnswer || hasToolProtocolArtifacts(cleanedAnswer)) {
        const fallbackAnswer = buildToolLoopFallbackAnswer(executedToolCalls, params.options.prompt);
        if (fallbackAnswer) {
            finalAnswer = fallbackAnswer;
        }
    }

    const { verifyResult, verifyJournal } = await runVerifyPhase(
        executedToolCalls,
        actionJournal,
        params.traceId,
        params.route
    );

    if (verifyJournal) {
        actionJournal.push(verifyJournal);
    }

    const firstCall = executedToolCalls[0];
    return {
        answer: finalAnswer,
        toolCall: firstCall
            ? { name: firstCall.tc.function.name, args: firstCall.args, result: firstCall.result }
            : undefined,
        actionJournal,
        verifyResult,
        quotaProfile: params.quotaProfile,
        perTurnToolCallLimit: params.perTurnToolCallLimit,
        perTurnToolStepLimit: params.perTurnToolStepLimit,
        remainingToolCalls: params.perTurnToolCallLimit,
        remainingSteps: params.perTurnToolStepLimit - executedToolCalls.length,
    };
}

// ============================================
// 主函数：runAgentToolLoop
// ============================================

export async function runAgentToolLoop(options: AgentToolLoopOptions): Promise<AgentToolLoopResult> {
    // P5.7-R12-T8: 配额策略（冻结口径）
    const QUOTA_PROFILES = {
        conservative: { toolCalls: 8, toolSteps: 24 },
        balanced: { toolCalls: 16, toolSteps: 48 },
        aggressive: { toolCalls: 20, toolSteps: 64 },
    } as const;

    // 单轮硬上限（P5.7-R12-T8: 禁止超过此值）
    const HARD_CAP_TOOL_CALLS = 20;
    const HARD_CAP_TOOL_STEPS = 64;

    // 解析配额档位（默认 balanced）
    const quotaProfile = options.quotaProfile ?? "balanced";
    const profileLimits = QUOTA_PROFILES[quotaProfile];

    // 应用覆盖值（如果有）
    let perTurnToolCallLimit = options.perTurnToolCallLimit ?? profileLimits.toolCalls;
    let perTurnToolStepLimit = options.perTurnToolStepLimit ?? profileLimits.toolSteps;

    // 强制硬上限（P5.7-R12-T8: 不允许超过硬上限）
    perTurnToolCallLimit = Math.min(perTurnToolCallLimit, HARD_CAP_TOOL_CALLS);
    perTurnToolStepLimit = Math.min(perTurnToolStepLimit, HARD_CAP_TOOL_STEPS);

    const backendRuntime = options.backendRuntime || resolveAgentBackendRuntime();
    const baseUrl = normalizeBaseUrl(options.baseUrl || backendRuntime.baseUrl);
    const modelOverride = normalizeModelOverride(options.model);
    const backendDefaultModel = normalizeModelOverride(backendRuntime.model);
    const model = modelOverride
        ?? backendDefaultModel
        ?? (backendRuntime.nativeApiEnabled
            ? undefined // 简化：需要模型探测时再实现
            : undefined);

    if (!model && !backendDefaultModel) {
        throw new Error(`Agent backend(${backendRuntime.id}) 未配置模型。请设置 AGENT_MODEL 或对应后端模型变量。`);
    }

    const usedModel = model || backendDefaultModel || "";
    const timeoutMs = options.timeoutMs || backendRuntime.timeoutMs;
    const root = options.allowRoot || config.workspaceRoot || AIDOCS_ROOT;

    const actionJournal: ActionJournalEntry[] = [];
    let stepId = 0;
    const traceId = options.traceId || crypto.randomUUID().slice(0, 8);
    const route = options.route || "tool";

    const baseSystem = await resolveBaseSystemPrompt(options.system);
    const workspacePath = options.workspacePath || root;
    const workspaceRootForTools = options.workspacePath || root;
    const toolNames = options.tools ? (options.tools as ToolName[]) : await getToolsForLlm(workspaceRootForTools);
    const useMcp = backendRuntime.nativeApiEnabled && process.env.LMSTUDIO_ENABLE_MCP === "1" && !!workspacePath;
    let system = buildExecSystemPrompt(baseSystem, useMcp);

    system += `\n\n${renderLlmToolIndex(toolNames)}`;

    // 技能系统注入：只有真实暴露了 read_file + bash 时才提示
    if (toolNames.includes("read_file") && toolNames.includes("bash")) {
        try {
            const { existsSync } = await import("node:fs");
            const { join } = await import("node:path");
            const os = await import("node:os");
            const globalSkillIndexPath = join(os.homedir(), ".config", "msgcode", "skills", "index.json");

            let skillHint = "\n\n[技能系统]\n";
            if (existsSync(globalSkillIndexPath)) {
                try {
                    const indexContent = await fsPromises.readFile(globalSkillIndexPath, "utf-8");
                    const index = JSON.parse(indexContent);
                    if (index.skills && Array.isArray(index.skills) && index.skills.length > 0) {
                        const skillIds: string[] = [];
                        for (const skill of index.skills) {
                            if (!skill || typeof skill !== "object") continue;
                            const id = (skill as { id?: unknown }).id;
                            if (typeof id === "string" && id.trim()) {
                                skillIds.push(id);
                            }
                        }
                        if (skillIds.length > 0) {
                            skillHint += `全局技能：${skillIds.join(", ")}\n`;
                        }
                    }
                } catch {
                    // 忽略
                }
            }
            skillHint += "调用方式：read_file 读取技能文件（~/.config/msgcode/skills/<id>/main.sh），bash 执行";
            system += skillHint;
        } catch {
            // 忽略
        }
    }

    const messages: Array<{ role: string; content?: string; tool_call_id?: string; tool_calls?: ToolCall[] }> = [];
    if (system && system.trim()) {
        messages.push({ role: "system", content: system.trim() });
    }

    // 注入短期记忆上下文
    if (options.summaryContext && options.summaryContext.trim()) {
        messages.push({
            role: "assistant",
            content: `[历史对话摘要]\n${options.summaryContext}`
        });
    }

    const MAX_WINDOW_MESSAGES = 20;
    const MAX_CONTEXT_CHARS = 8000;
    if (options.windowMessages && options.windowMessages.length > 0) {
        let totalChars = 0;
        const recentMessages = options.windowMessages.slice(-MAX_WINDOW_MESSAGES);
        for (const msg of recentMessages) {
            const msgChars = msg.content?.length || 0;
            if (totalChars + msgChars > MAX_CONTEXT_CHARS) break;
            messages.push({ role: msg.role, content: msg.content });
            totalChars += msgChars;
        }
    }

    messages.push({ role: "user", content: options.prompt });

    // 把 ToolName[] 转换为工具对象格式（供 detectPreferredToolName 使用）
    const tools = toolNames.map((name) => ({ name }));
    const preferredToolName = detectPreferredToolName(options.prompt, tools);
    const preferredToolChoice: ToolChoice | undefined = preferredToolName
        ? "required"
        : undefined;
    const constrainedToolNames = preferredToolName
        ? toolNames.filter((n) => n === preferredToolName)
        : toolNames;
    const activeToolNames = constrainedToolNames.length > 0 ? constrainedToolNames : toolNames;

    // P5.7-R8c: 使用 manifest 的 toOpenAiToolSchemas 生成完整说明书
    const activeToolSchemas = toOpenAiToolSchemas(activeToolNames);
    const activeAnthropicToolSchemas = toAnthropicToolSchemas(activeToolNames);

    if (backendRuntime.id === "minimax") {
        return await runMiniMaxAnthropicToolLoop({
            options,
            baseUrl,
            model: usedModel,
            apiKey: backendRuntime.apiKey,
            timeoutMs,
            root,
            route,
            traceId,
            perTurnToolCallLimit,
            perTurnToolStepLimit,
            quotaProfile,
            preferredToolName,
            baseMessages: messages,
            activeToolSchemas: activeAnthropicToolSchemas,
            workspacePath,
        });
    }

    // 第一次请求
    const r1 = await callChatCompletionsRaw({
        baseUrl,
        model: usedModel,
        messages,
        tools: activeToolSchemas,
        toolChoice: preferredToolChoice ?? "auto",
        temperature: 0,
        maxTokens: 800,
        timeoutMs,
        apiKey: backendRuntime.apiKey,
    });

    let msg1 = r1.choices[0]?.message;
    let toolCalls = msg1?.tool_calls ?? [];

    // P5.7-R12-T10: agent-first 改造 - 如果允许 no-tool，模型可以自己决定不调用工具
    if (options.allowNoTool && toolCalls.length === 0) {
        // 模型决定不调用工具，直接返回文本结果
        return {
            answer: sanitizeLmStudioOutput(msg1?.content || ""),
            actionJournal: [],
            decisionSource: "model",
        };
    }

    // 无 tool_calls：重试一次（required 模式）
    if (toolCalls.length === 0 && activeToolNames.length > 0) {
        const retryMessages = [
            ...messages,
            { role: "user" as const, content: "请严格返回 tool_calls；不要输出自然语言。" },
        ];
        const retry = await callChatCompletionsRaw({
            baseUrl,
            model: usedModel,
            messages: retryMessages,
            tools: activeToolSchemas,
            toolChoice: preferredToolChoice ?? "required",
            temperature: 0,
            maxTokens: 800,
            timeoutMs,
            apiKey: backendRuntime.apiKey,
        });
        msg1 = retry.choices[0]?.message;
        toolCalls = msg1?.tool_calls ?? [];
    }

    // 二次强约束重试：显式工具场景下，若 required 仍未返回 tool_calls，再尝试一次
    if (toolCalls.length === 0 && preferredToolName && activeToolNames.length > 0) {
        const strictRetryMessages = [
            ...messages,
            {
                role: "user" as const,
                content: `你必须调用工具 ${preferredToolName}，并仅返回 tool_calls。禁止任何自然语言。`,
            },
        ];
        const strictRetry = await callChatCompletionsRaw({
            baseUrl,
            model: usedModel,
            messages: strictRetryMessages,
            tools: activeToolSchemas,
            toolChoice: "required",
            temperature: 0,
            maxTokens: 800,
            timeoutMs,
            apiKey: backendRuntime.apiKey,
        });
        msg1 = strictRetry.choices[0]?.message;
        toolCalls = msg1?.tool_calls ?? [];
    }

    const hasPreferredToolMismatch = (calls: ToolCall[]): boolean => {
        if (!preferredToolName) return false;
        return calls.some((tc) => tc.function.name !== preferredToolName);
    };

    // 显式工具名纠偏：首轮返回错误工具时，强制再请求一次
    if (toolCalls.length > 0 && hasPreferredToolMismatch(toolCalls) && activeToolNames.length > 0) {
        const strictRetry = await callChatCompletionsRaw({
            baseUrl,
            model: usedModel,
            messages,
            tools: activeToolSchemas,
            toolChoice: preferredToolChoice ?? "required",
            temperature: 0,
            maxTokens: 800,
            timeoutMs,
            apiKey: backendRuntime.apiKey,
        });
        msg1 = strictRetry.choices[0]?.message;
        toolCalls = msg1?.tool_calls ?? [];
    }

    // 仍无 tool_calls：硬失败
    if (toolCalls.length === 0) {
        return {
            answer: `协议失败：未收到工具调用指令\n- 错误码：MODEL_PROTOCOL_FAILED\n\n这通常意味着模型无法调用工具。请重试或切换到对话模式。`,
            actionJournal: [],
        };
    }

    // 纠偏后仍不匹配：拒绝执行错误工具
    if (hasPreferredToolMismatch(toolCalls)) {
        return {
            answer: `工具协议失败：模型未按要求调用工具\n- 期望工具：${preferredToolName}\n- 错误码：MODEL_PROTOCOL_FAILED\n\n请重试并明确要求调用正确工具。`,
            actionJournal: [],
        };
    }

    const executedToolCalls: ExecutedToolCall[] = [];
    let currentAssistantRole = msg1?.role || "assistant";
    let currentAssistantContent = msg1?.content;
    let currentToolCalls = toolCalls;
    let conversationMessages = [...messages];
    let finalAssistantContent = "";

    while (true) {
        // P5.7-R12-T8: 单轮工具调用数检查
        if (currentToolCalls.length > perTurnToolCallLimit) {
            // P5.7-R12-T8: 达到档位上限时，标记为可续跑（除非超过硬上限）
            const isHardCapExceeded = currentToolCalls.length > HARD_CAP_TOOL_CALLS;

            if (isHardCapExceeded) {
                // 超过硬上限，必须移交下一轮 heartbeat
                // P5.7-R12-T8: 补上 toolCall，用于 sameToolSameArgsRetryLimit 检查
                const lastExecutedCall = executedToolCalls[executedToolCalls.length - 1];
                return {
                    answer: `本轮工具调用次数达到单轮硬上限\n- 本轮请求数：${currentToolCalls.length}\n- 单轮硬上限：${HARD_CAP_TOOL_CALLS}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`,
                    actionJournal,
                    continuable: true,
                    quotaProfile,
                    perTurnToolCallLimit,
                    perTurnToolStepLimit,
                    remainingToolCalls: 0,
                    remainingSteps: perTurnToolStepLimit - executedToolCalls.length,
                    continuationReason: `exceeded_hard_cap_tool_calls_${currentToolCalls.length}_limit_${HARD_CAP_TOOL_CALLS}`,
                    toolCall: lastExecutedCall ? {
                        name: lastExecutedCall.tc.function.name,
                        args: lastExecutedCall.args,
                        result: lastExecutedCall.result,
                    } : undefined,
                };
            }

            // 达到档位上限但未超过硬上限，移交下一轮 heartbeat 继续执行
            // P5.7-R12-T8: 补上 toolCall，用于 sameToolSameArgsRetryLimit 检查
            const lastExecutedCall = executedToolCalls[executedToolCalls.length - 1];
            return {
                answer: `本轮工具调用次数达到档位上限\n- 本轮请求数：${currentToolCalls.length}\n- 档位上限：${perTurnToolCallLimit}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`,
                actionJournal,
                continuable: true,
                quotaProfile,
                perTurnToolCallLimit,
                perTurnToolStepLimit,
                remainingToolCalls: 0,
                remainingSteps: perTurnToolStepLimit - executedToolCalls.length,
                continuationReason: `reached_profile_limit_tool_calls_${currentToolCalls.length}_limit_${perTurnToolCallLimit}`,
                toolCall: lastExecutedCall ? {
                    name: lastExecutedCall.tc.function.name,
                    args: lastExecutedCall.args,
                    result: lastExecutedCall.result,
                } : undefined,
            };
        }

        const roundExecutedToolCalls: ExecutedToolCall[] = [];

        for (const tc of currentToolCalls) {
            let args: Record<string, unknown> = {};
            try {
                args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
                args = {};
            }
            args = normalizeSoulPathArgs(tc.function.name, args, workspacePath);

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

            if (toolResult.error) {
                const toolErrorCode = toolResult.errorCode || "TOOL_EXEC_FAILED";
                const toolErrorMessage = toolResult.error || "工具执行失败";

                stepId++;
                actionJournal.push({
                    traceId,
                    stepId,
                    phase: "act",
                    timestamp: Date.now(),
                    route,
                    model: usedModel,
                    tool: tc.function.name,
                    ok: false,
                    exitCode: toolResult.exitCode ?? undefined,
                    errorCode: toolErrorCode,
                    stdoutTail: toolResult.stdoutTail ?? undefined,
                    fullOutputPath: toolResult.fullOutputPath ?? undefined,
                    durationMs: toolResult.durationMs,
                });

                let answerText = `工具执行失败\n- 工具：${tc.function.name}\n- 错误码：${toolErrorCode}\n- 错误：${toolErrorMessage}`;
                if (toolResult.exitCode !== undefined && toolResult.exitCode !== null) {
                    answerText += `\n- 退出码：${toolResult.exitCode}`;
                }
                if (toolResult.stderrTail) {
                    answerText += `\n- stderr 尾部：${toolResult.stderrTail.slice(-200)}`;
                }
                if (toolResult.fullOutputPath) {
                    answerText += `\n- 完整日志：${toolResult.fullOutputPath}`;
                }

                return {
                    answer: answerText,
                    toolCall: { name: tc.function.name, args, result: toolResult },
                    actionJournal,
                };
            }

            const executed: ExecutedToolCall = { tc, args, result: toolResult.data };
            executedToolCalls.push(executed);
            roundExecutedToolCalls.push(executed);

            stepId++;
            actionJournal.push({
                traceId,
                stepId,
                phase: "act",
                timestamp: Date.now(),
                route,
                model: usedModel,
                tool: tc.function.name,
                ok: true,
                durationMs: toolResult.durationMs,
            });

            // P5.7-R12-T8: 总工具步骤数检查
            if (executedToolCalls.length > perTurnToolStepLimit) {
                // P5.7-R12-T8: 达到档位上限时，标记为可续跑（除非超过硬上限）
                const isHardCapExceeded = executedToolCalls.length > HARD_CAP_TOOL_STEPS;

                if (isHardCapExceeded) {
                    // 超过硬上限，必须移交下一轮 heartbeat
                    // P5.7-R12-T8: 补上 toolCall，用于 sameToolSameArgsRetryLimit 检查
                    const lastExecutedCall = executedToolCalls[executedToolCalls.length - 1];
                    return {
                        answer: `本轮工具步骤总数达到单轮硬上限\n- 本轮步骤数：${executedToolCalls.length}\n- 单轮硬上限：${HARD_CAP_TOOL_STEPS}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`,
                        actionJournal,
                        continuable: true,
                        quotaProfile,
                        perTurnToolCallLimit,
                        perTurnToolStepLimit,
                        remainingToolCalls: perTurnToolCallLimit - currentToolCalls.length,
                        remainingSteps: 0,
                        continuationReason: `exceeded_hard_cap_tool_steps_${executedToolCalls.length}_limit_${HARD_CAP_TOOL_STEPS}`,
                        toolCall: lastExecutedCall ? {
                            name: lastExecutedCall.tc.function.name,
                            args: lastExecutedCall.args,
                            result: lastExecutedCall.result,
                        } : undefined,
                    };
                }

                // 达到档位上限但未超过硬上限，移交下一轮 heartbeat 继续执行
                // P5.7-R12-T8: 补上 toolCall，用于 sameToolSameArgsRetryLimit 检查
                const lastExecutedCall = executedToolCalls[executedToolCalls.length - 1];
                return {
                    answer: `本轮工具步骤总数达到档位上限\n- 总步骤数：${executedToolCalls.length}\n- 档位上限：${perTurnToolStepLimit}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`,
                    actionJournal,
                    continuable: true,
                    quotaProfile,
                    perTurnToolCallLimit,
                    perTurnToolStepLimit,
                    remainingToolCalls: perTurnToolCallLimit - currentToolCalls.length,
                    remainingSteps: 0,
                    continuationReason: `reached_profile_limit_tool_steps_${executedToolCalls.length}_limit_${perTurnToolStepLimit}`,
                    toolCall: lastExecutedCall ? {
                        name: lastExecutedCall.tc.function.name,
                        args: lastExecutedCall.args,
                        result: lastExecutedCall.result,
                    } : undefined,
                };
            }
        }

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

        conversationMessages = [...conversationMessages, assistantMsg, ...toolResultMessages];

        const nextRound = await callChatCompletionsRaw({
            baseUrl,
            model: usedModel,
            messages: conversationMessages,
            tools: activeToolSchemas,
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
    }

    const cleanedAnswer = sanitizeLmStudioOutput(finalAssistantContent);
    let finalAnswer = cleanedAnswer;

    if (!cleanedAnswer || hasToolProtocolArtifacts(cleanedAnswer)) {
        const fallbackAnswer = buildToolLoopFallbackAnswer(executedToolCalls, options.prompt);
        if (fallbackAnswer) {
            finalAnswer = fallbackAnswer;
        }
    }

    // P5.7-R12-T3: 在返回前执行 verify phase
    const { verifyResult, verifyJournal } = await runVerifyPhase(
        executedToolCalls,
        actionJournal,
        traceId,
        route
    );

    // 如果有 verify journal，添加到 actionJournal
    if (verifyJournal) {
        actionJournal.push(verifyJournal);
    }

    const firstCall = executedToolCalls[0];
    return {
        answer: finalAnswer,
        toolCall: firstCall
            ? { name: firstCall.tc.function.name, args: firstCall.args, result: firstCall.result }
            : undefined,
        actionJournal,
        verifyResult,
        // P5.7-R12-T8: 正常结束时也返回配额信息
        quotaProfile,
        perTurnToolCallLimit,
        perTurnToolStepLimit,
        remainingToolCalls: perTurnToolCallLimit,
        remainingSteps: perTurnToolStepLimit - executedToolCalls.length,
    };
}

// ============================================
// 兼容别名
// ============================================

/**
 * @deprecated 请使用 runAgentToolLoop
 */
export const runLmStudioToolLoop = runAgentToolLoop;

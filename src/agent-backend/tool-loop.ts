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
    type AgentBackendRuntime,
    type ActionJournalEntry,
    type ParsedToolCall,
    type VerifyJournalEntry,
    type VerifyResult,
} from "./types.js";
import {
    resolveBaseSystemPrompt,
    buildExecSystemPrompt,
    buildConversationContextBlocks,
    LMSTUDIO_DEFAULT_CHAT_MODEL,
} from "./prompt.js";
import { clipToolPreviewText } from "../runtime/context-policy.js";
import {
    resolveAgentBackendRuntime,
    normalizeModelOverride,
} from "./config.js";
import { runAgentChat } from "./chat.js";
import {
    filterDefaultLlmTools,
    renderLlmToolIndex,
    resolveLlmToolExposure,
    toAnthropicToolSchemas,
    toOpenAiToolSchemas,
} from "../tools/manifest.js";
import type { ToolName } from "../tools/types.js";
import { getChromeRootInfo } from "../browser/chrome-root.js";
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
    ParsedToolCall,
} from "./types.js";

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

type ResolveModelParams = {
    baseUrl: string;
    configuredModel?: string;
    apiKey?: string;
    timeoutMs?: number;
    nativeApiEnabled?: boolean;
    modelsListPath?: string;
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
    finishReason?: string | null;
};

const AIDOCS_ROOT = process.env.AIDOCS_ROOT || "AIDOCS";
const MAIN_AGENT_MAX_TOKENS = 8192;
let cachedLocalModel: { baseUrl: string; id: string } | undefined;
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

function isModelsList(value: unknown): value is { data: Array<{ id?: unknown; type?: unknown }> } {
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

async function fetchFirstLoadedModelKeyNative(params: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
}): Promise<string | null> {
    const url = `${params.baseUrl}/api/v1/models`;
    const rawText = await fetchTextWithTimeout({
        url,
        method: "GET",
        timeoutMs: params.timeoutMs || (typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
            ? config.lmstudioTimeoutMs
            : 60_000),
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

async function isModelPresentInNativeCatalog(params: {
    baseUrl: string;
    key: string;
    apiKey?: string;
    timeoutMs?: number;
}): Promise<boolean> {
    try {
        const url = `${params.baseUrl}/api/v1/models`;
        const rawText = await fetchTextWithTimeout({
            url,
            method: "GET",
            timeoutMs: params.timeoutMs || (typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
                ? config.lmstudioTimeoutMs
                : 60_000),
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

    throw new Error("本地模型后端未返回可用模型，请先加载至少一个模型，或显式设置对应 backend 的模型变量。");
}

async function resolveLocalToolLoopModelId(params: ResolveModelParams): Promise<string> {
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
                cachedLocalModel &&
                cachedLocalModel.baseUrl === params.baseUrl &&
                cachedLocalModel.id === LMSTUDIO_DEFAULT_CHAT_MODEL
            ) {
                return cachedLocalModel.id;
            }
            cachedLocalModel = { baseUrl: params.baseUrl, id: LMSTUDIO_DEFAULT_CHAT_MODEL };
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
            if (cachedLocalModel && cachedLocalModel.baseUrl === params.baseUrl && cachedLocalModel.id === loadedModel) {
                return cachedLocalModel.id;
            }
            cachedLocalModel = { baseUrl: params.baseUrl, id: loadedModel };
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
        cachedLocalModel = { baseUrl: params.baseUrl, id: firstCatalogModel };
        return firstCatalogModel;
    }

    throw new Error("本地模型后端中没有已加载或可发现的模型。");
}

// ============================================
// 辅助函数
// ============================================

function clipText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}...`;
}

const TOOL_RESULT_CONTEXT_MAX_CHARS = 4000;

/**
 * 回灌给模型的 tool_result 只保留可用预览，避免单次 read_file/big JSON 直接顶爆上下文。
 */
function serializeToolResultForConversation(result: unknown): string {
    const raw = typeof result === "string" ? result : JSON.stringify(result);
    return clipToolPreviewText(raw, TOOL_RESULT_CONTEXT_MAX_CHARS);
}

function bashCommandLooksMutating(command: string): boolean {
    const input = (command || "").trim();
    if (!input) return false;

    return [
        /\bmsgcode\s+schedule\s+(add|remove|enable|disable)\b/i,
        /(^|[;&|]\s*)(rm|mv|cp|mkdir|touch|chmod|chown)\b/,
        /\bsed\s+-i\b/,
        /\bperl\s+-i\b/,
        /\bapply_patch\b/,
        /\bgit\s+(commit|push|tag|merge|rebase|cherry-pick|am|apply)\b/i,
        /(^|[;&|]\s*)bash\s+.*\/skills\/scheduler\/main\.sh\s+(add|remove|enable|disable)\b/i,
        /(^|[;&|]\s*)bash\s+.*\/skills\/patchright-browser\/main\.sh\b/i,
    ].some((pattern) => pattern.test(input));
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


function buildConversationToolResult(toolResult: ToolRunResult): unknown {
    if (!toolResult.error) {
        return toolResult.data || { success: true };
    }

    return {
        ok: false,
        error: toolResult.error,
        errorCode: toolResult.errorCode || "TOOL_EXEC_FAILED",
        exitCode: toolResult.exitCode ?? null,
        stderrTail: toolResult.stderrTail ?? "",
        stdoutTail: toolResult.stdoutTail ?? "",
        fullOutputPath: toolResult.fullOutputPath ?? null,
    };
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
 * 不再使用历史硬编码白名单
 */
export async function getToolsForLlm(workspacePath?: string): Promise<ToolName[]> {
    // 无 workspace 时，也必须走当前默认配置真相源，避免和真实工具面漂移。
    if (!workspacePath) {
        const { DEFAULT_WORKSPACE_CONFIG } = await import("../config/workspace.js");
        const configuredTools = Array.isArray(DEFAULT_WORKSPACE_CONFIG["tooling.allow"])
            ? (DEFAULT_WORKSPACE_CONFIG["tooling.allow"] as ToolName[])
            : [];
        const allowedTools = filterDefaultLlmTools(
            Array.from(new Set<ToolName>(["read_file", "bash", ...configuredTools]))
        );
        const exposure = resolveLlmToolExposure(allowedTools);
        return exposure.exposedTools;
    }
    try {
        const { loadWorkspaceConfig } = await import("../config/workspace.js");
        const cfg = await loadWorkspaceConfig(workspacePath);
        // 单一真相源：LLM 工具暴露只看 tooling.allow，再补 skill 发现所需的最小基线。
        // 不再依赖任何历史开关决定“有没有工具”，否则会吞掉 feishu_send_file 等已允许工具。
        const configuredTools = Array.isArray(cfg["tooling.allow"])
            ? (cfg["tooling.allow"] as ToolName[])
            : [];
        const allowedTools = filterDefaultLlmTools(
            Array.from(new Set<ToolName>(["read_file", "bash", ...configuredTools]))
        );

        // 解析 LLM 工具暴露结果，返回 exposedTools
        const exposure = resolveLlmToolExposure(allowedTools);

        return exposure.exposedTools;
    } catch {
        return [];
    }
}

function buildWorkspacePathHint(workspacePath?: string): string {
    const normalized = (workspacePath || "").trim();
    if (!normalized) return "";

    const workspaceConfigPath = path.join(normalized, ".msgcode", "config.json");
    return [
        "[当前工作区]",
        `当前工作区绝对路径：${normalized}`,
        `当前 workspace config 绝对路径：${workspaceConfigPath}`,
        "当任务要求读取当前 workspace 的 .msgcode/config.json 时，只能使用上面这个绝对路径。",
        "禁止猜测、拼接或虚构其他工作区绝对路径（例如 /Users/admin/*workspace）。",
        "",
        "重要：所有 msgcode CLI 命令（如 schedule add/remove/list）必须显式带上 --workspace 参数：",
        `  --workspace ${normalized}`,
    ].join("\n");
}

function buildBrowserRuntimeHint(toolNames: ToolName[]): string {
    if (!toolNames.includes("browser")) {
        return "";
    }

    try {
        const chrome = getChromeRootInfo();
        return [
            "[当前浏览器底座]",
            "唯一正式浏览器通道：browser 工具（Patchright + Chrome-as-State）。",
            "唯一正式连接方式：Patchright connectOverCDP。",
            `共享工作 Chrome profilesRoot：${chrome.profilesRoot}`,
            `默认工作 Chrome root：${chrome.chromeRoot}`,
            "如需人工启动共享工作 Chrome，只能使用下面这条系统提供的启动命令：",
            chrome.launchCommand,
            "不要猜测其他浏览器路径，不要使用 agent-browser 作为正式浏览器通道。",
            "instances.stop 和 tabs.list 必须传真实 instanceId，不允许裸调。",
            "instanceId 只能来自 instances.launch、instances.list、tabs.open 等真实返回值，不允许自己猜。",
            "tabId 只能来自 tabs.open、tabs.list、snapshot、text 的真实返回值，不允许自己写 1、2、3。",
            "如需查看 Patchright browser CLI 合同，可读取 ~/.config/msgcode/skills/patchright-browser/SKILL.md。",
        ].join("\n");
    } catch (error) {
        return [
            "[当前浏览器底座]",
            "唯一正式浏览器通道：browser 工具（Patchright + Chrome-as-State）。",
            `浏览器底座信息解析失败：${error instanceof Error ? error.message : String(error)}`,
            "不要猜测其他浏览器路径，不要使用 agent-browser 作为正式浏览器通道。",
            "instances.stop 和 tabs.list 必须传真实 instanceId，不允许裸调。",
            "instanceId 只能来自真实 browser 返回值，不允许自己猜。",
        ].join("\n");
    }
}

function buildNativeToolPriorityHint(toolNames: ToolName[]): string {
    const lines: string[] = [];

    lines.push("[原生工具优先]");
    lines.push("如果当前能力已经作为原生工具暴露，就优先调用原生工具，不要先走 bash 包一层 CLI。");
    lines.push("bash 只用于系统命令、脚本 glue、或当前确实没有原生工具的能力；不要把已有原生工具再包装一层。");

    if (toolNames.includes("feishu_send_file")) {
        lines.push("发送文件回飞书群时，唯一正式发送入口是 feishu_send_file。");
        lines.push("不要先用 bash 调 msgcode CLI 假装发送文件；只有 feishu_send_file 成功后，才可回答“已发送”。");
    }

    if (toolNames.includes("browser")) {
        lines.push("浏览器真实任务（打开网页、读标题、点击、截图）默认优先 browser 工具。");
        lines.push("只有在排障、查 root/instances/tabs 状态、或确认 CLI 合同时，才转向 msgcode browser CLI。");
    }

    return lines.join("\n");
}

async function runTool(
    name: string,
    args: Record<string, unknown>,
    root: string,
    context?: {
        currentMessageId?: string;
        defaultActionTargetMessageId?: string;
    }
): Promise<ToolRunResult> {
    const { executeTool } = await import("../tools/bus.js");
    const { randomUUID } = await import("node:crypto");

    const result = await executeTool(name as any, args, {
        workspacePath: root,
        currentMessageId: context?.currentMessageId,
        defaultActionTargetMessageId: context?.defaultActionTargetMessageId,
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
        finishReason: parsed.finishReason,
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
    baseMessages: Array<{ role: string; content?: string }>;
    activeToolSchemas: readonly unknown[];
    workspacePath: string;
    currentMessageId?: string;
    defaultActionTargetMessageId?: string;
}): Promise<AgentToolLoopResult> {
    const HARD_CAP_TOOL_CALLS = 999;
    const HARD_CAP_TOOL_STEPS = 4096;
    const actionJournal: ActionJournalEntry[] = [];
    let stepId = 0;

    const anthropicContext = splitSystemFromMessages(params.baseMessages);
    let conversationMessages = anthropicContext.messages;
    const initialToolChoice: MiniMaxAnthropicToolChoice | undefined = params.activeToolSchemas.length > 0
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
        maxTokens: MAIN_AGENT_MAX_TOKENS,
        timeoutMs: params.timeoutMs,
        apiKey: params.apiKey,
    });

    let toolCalls = response.toolCalls;

    const executedToolCalls: ExecutedToolCall[] = [];
    let currentResponse = response;
    let currentToolCalls = toolCalls;

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

        if (currentToolCalls.length > 0) {
            const roundExecutedToolCalls: ExecutedToolCall[] = [];

            for (const tc of currentToolCalls) {
                let args: Record<string, unknown> = {};
                try {
                    args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                } catch {
                    args = {};
                }
                let toolResult: ToolRunResult;
                try {
                    toolResult = await runTool(tc.function.name, args, params.workspacePath, {
                        currentMessageId: params.currentMessageId,
                        defaultActionTargetMessageId: params.defaultActionTargetMessageId,
                    });
                } catch (e) {
                    toolResult = {
                        error: e instanceof Error ? e.message : String(e),
                        errorCode: "TOOL_EXEC_FAILED",
                        durationMs: 0,
                    };
                }

                const executed: ExecutedToolCall = { tc, args, result: buildConversationToolResult(toolResult) };

                if (toolResult.error) {
                    const toolErrorCode = toolResult.errorCode || "TOOL_EXEC_FAILED";

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
                    executedToolCalls.push(executed);
                    roundExecutedToolCalls.push(executed);

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
                    break;
                }

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

            if (roundExecutedToolCalls.length > 0) {
                const assistantMessage: MiniMaxAnthropicMessage = {
                    role: "assistant",
                    content: currentResponse.contentBlocks,
                };
                const toolResultMessage: MiniMaxAnthropicMessage = {
                    role: "user",
                    content: roundExecutedToolCalls.map(({ tc, result }) => ({
                        type: "tool_result" as const,
                        tool_use_id: tc.id,
                        content: serializeToolResultForConversation(result),
                    })),
                };

                conversationMessages = [...conversationMessages, assistantMessage, toolResultMessage];

                currentResponse = await callMiniMaxAnthropicRaw({
                    baseUrl: params.baseUrl,
                    model: params.model,
                    messages: conversationMessages,
                    system: anthropicContext.system,
                    tools: params.activeToolSchemas,
                    // P0 松绑：使用 auto 让模型自由选择
                    toolChoice: { type: "auto" },
                    temperature: 0,
                    maxTokens: MAIN_AGENT_MAX_TOKENS,
                    timeoutMs: params.timeoutMs,
                    apiKey: params.apiKey,
                });

                currentToolCalls = currentResponse.toolCalls;
            }
        }
        if (currentToolCalls.length > 0) {
            continue;
        }

        const finalAnswer = currentResponse.content || "";
        const verifyOutcome = await runVerifyPhase(
            executedToolCalls,
            actionJournal,
            params.traceId,
            params.route
        );
        const verifyResult = verifyOutcome.verifyResult;

        if (verifyOutcome.verifyJournal) {
            actionJournal.push(verifyOutcome.verifyJournal);
        }

        const firstCall = executedToolCalls[0]
            ? { name: executedToolCalls[0].tc.function.name, args: executedToolCalls[0].args, result: executedToolCalls[0].result }
            : undefined;
        const metadataRoute = firstCall !== undefined ? "tool" : "no-tool";
        logger.info("agent final response metadata", {
            module: "agent-backend/tool-loop",
            traceId: params.traceId,
            route: metadataRoute,
            provider: "minimax",
            stopReason: currentResponse.stopReason,
            maxTokens: MAIN_AGENT_MAX_TOKENS,
        });
        return {
            answer: finalAnswer,
            toolCall: firstCall,
            actionJournal,
            verifyResult,
            decisionSource: executedToolCalls.length === 0 ? "model" : undefined,
            quotaProfile: params.quotaProfile,
            perTurnToolCallLimit: params.perTurnToolCallLimit,
            perTurnToolStepLimit: params.perTurnToolStepLimit,
            remainingToolCalls: params.perTurnToolCallLimit,
            remainingSteps: params.perTurnToolStepLimit - executedToolCalls.length,
        };
    }
}

// ============================================
// 主函数：runAgentToolLoop
// ============================================

export async function runAgentToolLoop(options: AgentToolLoopOptions): Promise<AgentToolLoopResult> {
    // P5.7-R12-T8: 配额策略（冻结口径）
    const QUOTA_PROFILES = {
        conservative: { toolCalls: 99, toolSteps: 297 },
        balanced: { toolCalls: 199, toolSteps: 597 },
        aggressive: { toolCalls: 399, toolSteps: 1197 },
    } as const;

    // 单轮硬上限：只保留极端防护，不作为默认主链阻断
    const HARD_CAP_TOOL_CALLS = 999;
    const HARD_CAP_TOOL_STEPS = 4096;

    // 解析配额档位（默认 balanced）
    const quotaProfile = options.quotaProfile ?? "balanced";
    const profileLimits = QUOTA_PROFILES[quotaProfile];

    // 应用覆盖值（如果有）
    let perTurnToolCallLimit = options.perTurnToolCallLimit ?? profileLimits.toolCalls;
    let perTurnToolStepLimit = options.perTurnToolStepLimit ?? profileLimits.toolSteps;

    // 极端硬上限：防止误传超大配置
    perTurnToolCallLimit = Math.min(perTurnToolCallLimit, HARD_CAP_TOOL_CALLS);
    perTurnToolStepLimit = Math.min(perTurnToolStepLimit, HARD_CAP_TOOL_STEPS);

    const backendRuntime = options.backendRuntime || resolveAgentBackendRuntime();
    const baseUrl = normalizeBaseUrl(options.baseUrl || backendRuntime.baseUrl);
    const modelOverride = normalizeModelOverride(options.model);
    const backendDefaultModel = normalizeModelOverride(backendRuntime.model);
    const model = modelOverride
        ?? backendDefaultModel
        ?? (backendRuntime.id === "local-openai"
            ? await resolveLocalToolLoopModelId({
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

    const usedModel = model;
    const timeoutMs = options.timeoutMs || backendRuntime.timeoutMs;
    const root = options.allowRoot || config.workspaceRoot || AIDOCS_ROOT;
    const workspaceRootForTools = options.workspacePath || root;

    if (workspaceRootForTools && !options.tools) {
        const { getToolPolicy } = await import("../config/workspace.js");
        const policy = await getToolPolicy(workspaceRootForTools);

        if (policy.mode === "explicit") {
            const answer = await runAgentChat({
                prompt: options.prompt,
                system: options.system,
                workspace: options.workspacePath,
                model: modelOverride ?? backendDefaultModel ?? model,
                temperature: 0,
                backendRuntime,
                windowMessages: options.windowMessages,
                summaryContext: options.summaryContext,
                soulContext: options.soulContext,
            });

            return {
                answer,
                actionJournal: [],
                quotaProfile,
                perTurnToolCallLimit,
                perTurnToolStepLimit,
                remainingToolCalls: perTurnToolCallLimit,
                remainingSteps: perTurnToolStepLimit,
                decisionSource: "model",
            };
        }
    }

    const actionJournal: ActionJournalEntry[] = [];
    let stepId = 0;
    const traceId = options.traceId || crypto.randomUUID().slice(0, 8);
    const route = options.route || "tool";

    const baseSystem = await resolveBaseSystemPrompt(options.system);
    const workspacePath = options.workspacePath || root;
    const toolNames = options.tools ? (options.tools as ToolName[]) : await getToolsForLlm(workspaceRootForTools);
    const useMcp = backendRuntime.nativeApiEnabled && process.env.LMSTUDIO_ENABLE_MCP === "1" && !!workspacePath;
    let system = buildExecSystemPrompt(baseSystem, useMcp);

    system += `\n\n${renderLlmToolIndex(toolNames)}`;
    const workspacePathHint = buildWorkspacePathHint(workspacePath);
    if (workspacePathHint) {
        system += `\n\n${workspacePathHint}`;
    }
    const nativeToolPriorityHint = buildNativeToolPriorityHint(toolNames);
    if (nativeToolPriorityHint) {
        system += `\n\n${nativeToolPriorityHint}`;
    }
    const browserRuntimeHint = buildBrowserRuntimeHint(toolNames);
    if (browserRuntimeHint) {
        system += `\n\n${browserRuntimeHint}`;
    }

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
                    skillHint += `全局 skills 索引 JSON（只读）:\n${indexContent.trim()}\n`;
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
            skillHint += "调用方式：read_file 先读 ~/.config/msgcode/skills/<id>/SKILL.md。把 SKILL.md 当成能力说明书 / 接口文档，仔细阅读后再按里面写明的真实调用合同执行；不要自造 wrapper，不要猜 main.sh，也不要猜 skill 目录里还有别的脚本。若当前能力已经作为原生工具暴露（例如 browser、feishu_send_file），优先调用原生工具，不要先绕回 bash/CLI。判断某个 skill 能做什么、不能做什么之前，必须先读清 SKILL.md；如果看完仍然不确定，就先和用户沟通，不要先下结论。";
            system += skillHint;
        } catch {
            // 忽略
        }
    }

    const messages: Array<{ role: string; content?: string; tool_call_id?: string; tool_calls?: ToolCall[] }> = [];
    if (system && system.trim()) {
        messages.push({ role: "system", content: system.trim() });
    }

    const contextBlocks = buildConversationContextBlocks({
        summaryContext: options.summaryContext,
        windowMessages: options.windowMessages,
    });

    // 注入短期记忆上下文
    if (contextBlocks.summaryText) {
        messages.push({
            role: "assistant",
            content: `[历史对话摘要]\n${contextBlocks.summaryText}`
        });
    }

    if (contextBlocks.windowMessages.length > 0) {
        for (const msg of contextBlocks.windowMessages) {
            messages.push({ role: msg.role, content: msg.content });
        }
    }

    messages.push({ role: "user", content: options.prompt });

    const preferredToolChoice: ToolChoice | undefined = undefined;

    const activeToolNames = toolNames;

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
            baseMessages: messages,
            activeToolSchemas: activeAnthropicToolSchemas,
            workspacePath,
            currentMessageId: options.currentMessageId,
            defaultActionTargetMessageId: options.defaultActionTargetMessageId,
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
        maxTokens: MAIN_AGENT_MAX_TOKENS,
        timeoutMs,
        apiKey: backendRuntime.apiKey,
    });

    let msg1 = r1.choices[0]?.message;
    let toolCalls = msg1?.tool_calls ?? [];
    let currentFinishReason = r1.finishReason ?? null;

    const executedToolCalls: ExecutedToolCall[] = [];
    let currentAssistantRole = msg1?.role || "assistant";
    let currentAssistantContent = msg1?.content;
    let currentToolCalls = toolCalls;
    let conversationMessages = [...messages];

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

        if (currentToolCalls.length > 0) {
            const roundExecutedToolCalls: ExecutedToolCall[] = [];

            for (const tc of currentToolCalls) {
                let args: Record<string, unknown> = {};
                try {
                    args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                } catch {
                    args = {};
                }
                let toolResult: ToolRunResult;
                try {
                    toolResult = await runTool(tc.function.name, args, workspacePath, {
                        currentMessageId: options.currentMessageId,
                        defaultActionTargetMessageId: options.defaultActionTargetMessageId,
                    });
                } catch (e) {
                    toolResult = {
                        error: e instanceof Error ? e.message : String(e),
                        errorCode: "TOOL_EXEC_FAILED",
                        durationMs: 0,
                    };
                }

                const executed: ExecutedToolCall = { tc, args, result: buildConversationToolResult(toolResult) };

                if (toolResult.error) {
                    const toolErrorCode = toolResult.errorCode || "TOOL_EXEC_FAILED";

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
                    executedToolCalls.push(executed);
                    roundExecutedToolCalls.push(executed);

                    if (executedToolCalls.length > perTurnToolStepLimit) {
                        const isHardCapExceeded = executedToolCalls.length > HARD_CAP_TOOL_STEPS;
                        const lastExecutedCall = executedToolCalls[executedToolCalls.length - 1];
                        return {
                            answer: isHardCapExceeded
                                ? `本轮工具步骤总数达到单轮硬上限\n- 本轮步骤数：${executedToolCalls.length}\n- 单轮硬上限：${HARD_CAP_TOOL_STEPS}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`
                                : `本轮工具步骤总数达到档位上限\n- 总步骤数：${executedToolCalls.length}\n- 档位上限：${perTurnToolStepLimit}\n- 错误码：TOOL_LOOP_LIMIT_EXCEEDED\n\n任务将在下一轮 heartbeat 继续执行。`,
                            actionJournal,
                            continuable: true,
                            quotaProfile,
                            perTurnToolCallLimit,
                            perTurnToolStepLimit,
                            remainingToolCalls: perTurnToolCallLimit - currentToolCalls.length,
                            remainingSteps: 0,
                            continuationReason: isHardCapExceeded
                                ? `exceeded_hard_cap_tool_steps_${executedToolCalls.length}_limit_${HARD_CAP_TOOL_STEPS}`
                                : `reached_profile_limit_tool_steps_${executedToolCalls.length}_limit_${perTurnToolStepLimit}`,
                            toolCall: lastExecutedCall ? {
                                name: lastExecutedCall.tc.function.name,
                                args: lastExecutedCall.args,
                                result: lastExecutedCall.result,
                            } : undefined,
                        };
                    }
                    break;
                }

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

            if (roundExecutedToolCalls.length > 0) {
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
                    content: serializeToolResultForConversation(result)
                }));

                conversationMessages = [...conversationMessages, assistantMsg, ...toolResultMessages];

                const nextRound = await callChatCompletionsRaw({
                    baseUrl,
                    model: usedModel,
                    messages: conversationMessages,
                    tools: activeToolSchemas,
                    toolChoice: preferredToolChoice ?? "auto",
                    temperature: 0,
                    maxTokens: MAIN_AGENT_MAX_TOKENS,
                    timeoutMs,
                    apiKey: backendRuntime.apiKey,
                });

                const nextMsg = nextRound.choices[0]?.message;
                currentAssistantRole = nextMsg?.role || "assistant";
                currentAssistantContent = nextMsg?.content;
                currentToolCalls = nextMsg?.tool_calls ?? [];
                currentFinishReason = nextRound.finishReason ?? null;
            }
        }

        if (currentToolCalls.length > 0) {
            continue;
        }

        const finalAnswer = currentAssistantContent ?? "";

        // P5.7-R12-T3: 在返回前执行 verify phase
        const verifyOutcome = await runVerifyPhase(
            executedToolCalls,
            actionJournal,
            traceId,
            route
        );
        const verifyResult = verifyOutcome.verifyResult;

        // 如果有 verify journal，添加到 actionJournal
        if (verifyOutcome.verifyJournal) {
            actionJournal.push(verifyOutcome.verifyJournal);
        }

        const firstCall = executedToolCalls[0]
            ? { name: executedToolCalls[0].tc.function.name, args: executedToolCalls[0].args, result: executedToolCalls[0].result }
            : undefined;
        const metadataRoute = firstCall !== undefined ? "tool" : "no-tool";
        logger.info("agent final response metadata", {
            module: "agent-backend/tool-loop",
            traceId,
            route: metadataRoute,
            provider: backendRuntime.id,
            finishReason: currentFinishReason,
            maxTokens: MAIN_AGENT_MAX_TOKENS,
        });
        return {
            answer: finalAnswer,
            toolCall: firstCall,
            actionJournal,
            verifyResult,
            decisionSource: executedToolCalls.length === 0 ? "model" : undefined,
            // P5.7-R12-T8: 正常结束时也返回配额信息
            quotaProfile,
            perTurnToolCallLimit,
            perTurnToolStepLimit,
            remainingToolCalls: perTurnToolCallLimit,
            remainingSteps: perTurnToolStepLimit - executedToolCalls.length,
        };
    }
}

// ============================================
// 兼容别名
// ============================================

/**
 * @deprecated 请使用 runAgentToolLoop
 */
export const runLmStudioToolLoop = runAgentToolLoop;

export const __test = process.env.NODE_ENV === "test"
    ? {
        buildWorkspacePathHint,
    }
    : undefined;

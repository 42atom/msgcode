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
    type AidocsToolDef,
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

type ForcedFinalState = {
    answer: string;
    toolCall: { name: string; args: Record<string, unknown>; result: unknown };
    verifyResult: VerifyResult;
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
const FINISH_SUPERVISOR_MAX_CONTINUES = 3;
const MAIN_AGENT_MAX_TOKENS = 8192;
let cachedLocalModel: { baseUrl: string; id: string } | undefined;
const FINISH_SUPERVISOR_MUTATING_TOOLS = new Set<ToolName>([
    "write_file",
    "edit_file",
    "feishu_send_file",
    "desktop",
]);

type FinishSupervisorDecision = {
    decision: "PASS" | "CONTINUE";
    reason?: string;
    raw: string;
    durationMs: number;
    source: "explicit-pass" | "explicit-continue" | "heuristic-pass" | "heuristic-continue" | "verify-pass-fallback" | "invalid";
};

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

function getFinishSupervisorSettings(): {
    enabled: boolean;
    temperature: number;
    maxTokens: number;
    maxContinues: number;
} {
    const temperature = Number.isFinite(config.supervisor.temperature)
        ? Math.max(0, config.supervisor.temperature)
        : 0.1;
    const maxTokens = Number.isFinite(config.supervisor.maxTokens)
        ? Math.max(32, Math.floor(config.supervisor.maxTokens))
        : 300;

    return {
        enabled: config.supervisor.enabled !== false,
        temperature,
        maxTokens,
        maxContinues: FINISH_SUPERVISOR_MAX_CONTINUES,
    };
}

function stringifyForSupervisor(value: unknown, maxChars: number): string {
    if (typeof value === "string") {
        return clipText(value, maxChars);
    }
    try {
        return clipText(JSON.stringify(value), maxChars);
    } catch {
        return clipText(String(value), maxChars);
    }
}

function normalizeFinishSupervisorRaw(rawInput: string): string {
    let raw = sanitizeLmStudioOutput(rawInput || "").trim();
    if (!raw) return raw;

    raw = raw
        .replace(/^```[\w-]*\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    return lines.join("\n").trim();
}

function extractFinishSupervisorTextFromBlocks(blocks: MiniMaxAnthropicContentBlock[]): string {
    const textParts: string[] = [];
    const thinkingParts: string[] = [];

    for (const block of blocks) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            textParts.push(block.text.trim());
        }
        if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
            thinkingParts.push(block.thinking.trim());
        }
    }

    const text = textParts.join("\n").trim();
    if (text) return text;
    return thinkingParts.join("\n").trim();
}

function containsContinueSemantics(input: string): boolean {
    return [
        /不能结束/,
        /不可结束/,
        /还不能结束/,
        /不要结束/,
        /需要继续/,
        /请继续/,
        /未完成/,
        /证据不足/,
        /缺少/,
        /仍需/,
        /先不要结束/,
        /不通过/,
        /未明确放行/,
        /继续执行/,
    ].some((pattern) => pattern.test(input));
}

function containsPassSemantics(input: string): boolean {
    return [
        /可以结束/,
        /可结束/,
        /可以收尾/,
        /可收尾/,
        /可以交付/,
        /可交付/,
        /任务已完成/,
        /已经完成/,
        /结束条件已满足/,
        /允许结束/,
        /通过复核/,
        /无需继续/,
        /可以停止/,
        /可以返回/,
    ].some((pattern) => pattern.test(input));
}

function buildFinishSupervisorPrompt(params: {
    prompt: string;
    finalAnswer: string;
    windowMessages?: Array<{ role: string; content?: string }>;
    actionJournal: ActionJournalEntry[];
    executedToolCalls: ExecutedToolCall[];
    verifyResult?: VerifyResult;
    continueCount: number;
}): string {
    const sections: string[] = [
        "请判断这个任务现在是否可以结束。",
        "只能输出两种格式之一：",
        "PASS",
        "CONTINUE: <简短原因>",
        "",
        "[用户任务]",
        clipText(params.prompt.trim(), 4000),
        "",
        "[候选最终回复]",
        clipText((params.finalAnswer || "").trim() || "（空）", 2000),
    ];

    if (params.windowMessages && params.windowMessages.length > 0) {
        const recent = params.windowMessages
            .slice(-6)
            .map((msg) => `${msg.role}: ${clipText((msg.content || "").trim(), 400)}`)
            .join("\n");
        if (recent.trim()) {
            sections.push("", "[最近对话]", recent);
        }
    }

    const recentJournal = params.actionJournal
        .slice(-10)
        .map((entry) => {
            const parts = [
                `phase=${entry.phase}`,
                `tool=${entry.tool}`,
                `ok=${entry.ok}`,
            ];
            if (entry.errorCode) parts.push(`error=${entry.errorCode}`);
            if (typeof entry.exitCode === "number") parts.push(`exit=${entry.exitCode}`);
            return parts.join(" ");
        })
        .join("\n");
    if (recentJournal.trim()) {
        sections.push("", "[执行记录]", recentJournal);
    }

    const recentResults = params.executedToolCalls
        .slice(-4)
        .map(({ tc, args, result }) => [
            `tool=${tc.function.name}`,
            `args=${stringifyForSupervisor(args, 300)}`,
            `result=${stringifyForSupervisor(result, 500)}`,
        ].join("\n"))
        .join("\n---\n");
    if (recentResults.trim()) {
        sections.push("", "[最近工具结果]", recentResults);
    }

    if (params.verifyResult) {
        sections.push(
            "",
            "[verify]",
            stringifyForSupervisor(params.verifyResult, 800)
        );
    }

    sections.push("", `[已被要求继续次数] ${params.continueCount}`);
    return sections.join("\n");
}

function parseFinishSupervisorDecision(rawInput: string, durationMs: number): FinishSupervisorDecision {
    const raw = normalizeFinishSupervisorRaw(rawInput);
    if (/^PASS\b/i.test(raw)) {
        return {
            decision: "PASS",
            raw: raw || "PASS",
            durationMs,
            source: "explicit-pass",
        };
    }

    const continueMatch = raw.match(/^CONTINUE\s*[:：-]?\s*(.*)$/is);
    if (continueMatch) {
        const reason = continueMatch[1]?.trim() || "结束前证据不足";
        return {
            decision: "CONTINUE",
            reason,
            raw: raw || `CONTINUE: ${reason}`,
            durationMs,
            source: "explicit-continue",
        };
    }

    if (raw && containsContinueSemantics(raw)) {
        return {
            decision: "CONTINUE",
            reason: clipText(raw, 200),
            raw,
            durationMs,
            source: "heuristic-continue",
        };
    }

    if (raw && containsPassSemantics(raw)) {
        return {
            decision: "PASS",
            raw,
            durationMs,
            source: "heuristic-pass",
        };
    }

    return {
        decision: "CONTINUE",
        reason: clipText(raw || "监督员未明确放行", 200),
        raw: raw || "CONTINUE: 监督员未明确放行",
        durationMs,
        source: "invalid",
    };
}

function buildFinishSupervisorContinuationMessage(reason: string, continueCount: number, maxContinues: number): string {
    return [
        `结束前复核未通过（${continueCount}/${maxContinues}）：${reason}`,
        "你还不能结束。",
        "请继续完成缺失动作，必要时调用工具拿到证据；准备结束时再给出最终结果。",
    ].join("\n");
}

function buildFinishSupervisorBlockedAnswer(reason: string, continueCount: number): string {
    return [
        "任务已停止：结束前监督连续要求继续，未能通过。",
        `- 连续 CONTINUE 次数：${continueCount}`,
        `- 阻塞原因：${reason}`,
        "- 错误码：FINISH_SUPERVISOR_BLOCKED",
    ].join("\n");
}

function appendFinishSupervisorJournalEntry(params: {
    actionJournal: ActionJournalEntry[];
    traceId: string;
    route: "tool" | "complex-tool";
    model: string;
    decision: FinishSupervisorDecision;
}): void {
    params.actionJournal.push({
        traceId: params.traceId,
        stepId: params.actionJournal.length + 1,
        phase: "report",
        timestamp: Date.now(),
        route: params.route,
        model: params.model,
        tool: "finish-supervisor",
        ok: params.decision.decision === "PASS",
        errorCode: params.decision.decision === "PASS" ? undefined : "FINISH_SUPERVISOR_CONTINUE",
        stdoutTail: clipText(params.decision.raw, 200),
        durationMs: params.decision.durationMs,
    });
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

function answerClaimsSideEffect(answer: string): boolean {
    const input = (answer || "").trim();
    if (!input) return false;
    return /(已|已经).{0,8}(创建|删除|移除|停止|停用|禁用|启用|发送|上传|修复|修改|更新|写入|清理|部署|绑定|取消|保存|提交|添加)/.test(input)
        || /(创建成功|删除成功|发送成功|上传成功|修复完成|更新完成)/.test(input);
}

function isMutatingToolCall(name: string, args: Record<string, unknown>): boolean {
    if (FINISH_SUPERVISOR_MUTATING_TOOLS.has(name as ToolName)) {
        return true;
    }
    if (name !== "bash") {
        return false;
    }
    return bashCommandLooksMutating(typeof args.command === "string" ? args.command : "");
}

function hasSuccessfulMutatingExecution(executedToolCalls: ExecutedToolCall[]): boolean {
    for (let i = executedToolCalls.length - 1; i >= 0; i -= 1) {
        const entry = executedToolCalls[i];
        if (!isMutatingToolCall(entry.tc.function.name, entry.args)) {
            continue;
        }
        const result = (entry.result || {}) as ToolRunResult;
        const exitCode = typeof result.exitCode === "number" ? result.exitCode : 0;
        if (!result.error && !result.errorCode && exitCode === 0) {
            return true;
        }
    }
    return false;
}

function shouldRunFinishSupervisor(params: {
    finalAnswer: string;
    executedToolCalls: ExecutedToolCall[];
    forcedFinalState?: ForcedFinalState;
}): boolean {
    if (params.executedToolCalls.some(({ tc, args }) => isMutatingToolCall(tc.function.name, args))) {
        return true;
    }

    if (
        params.forcedFinalState
        && isMutatingToolCall(
            params.forcedFinalState.toolCall.name,
            params.forcedFinalState.toolCall.args,
        )
    ) {
        return true;
    }

    return answerClaimsSideEffect(params.finalAnswer);
}

async function runFinishSupervisorReview(params: {
    backendRuntime: AgentBackendRuntime;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    prompt: string;
    finalAnswer: string;
    windowMessages?: Array<{ role: string; content?: string }>;
    actionJournal: ActionJournalEntry[];
    executedToolCalls: ExecutedToolCall[];
    verifyResult?: VerifyResult;
    continueCount: number;
}): Promise<FinishSupervisorDecision> {
    const reviewPrompt = buildFinishSupervisorPrompt({
        prompt: params.prompt,
        finalAnswer: params.finalAnswer,
        windowMessages: params.windowMessages,
        actionJournal: params.actionJournal,
        executedToolCalls: params.executedToolCalls,
        verifyResult: params.verifyResult,
        continueCount: params.continueCount,
    });
    const supervisorSettings = getFinishSupervisorSettings();
    const startedAt = Date.now();
    const supervisorSystem = "你现在只做结束前复核，不调用工具。只输出单行 PASS 或 CONTINUE: <简短原因>。不要输出其他文字。";

    if (params.backendRuntime.id === "minimax") {
        const response = await callMiniMaxAnthropicRaw({
            baseUrl: params.baseUrl,
            model: params.model,
            messages: [{ role: "user", content: reviewPrompt }],
            system: supervisorSystem,
            tools: [],
            temperature: supervisorSettings.temperature,
            maxTokens: supervisorSettings.maxTokens,
            timeoutMs: params.timeoutMs,
            apiKey: params.backendRuntime.apiKey,
        });
        const rawDecisionText = response.content.trim()
            || extractFinishSupervisorTextFromBlocks(response.contentBlocks);
        const parsed = parseFinishSupervisorDecision(rawDecisionText, Date.now() - startedAt);
        if (parsed.source === "invalid" && params.verifyResult?.ok && hasSuccessfulMutatingExecution(params.executedToolCalls)) {
            return {
                decision: "PASS",
                raw: parsed.raw,
                durationMs: parsed.durationMs,
                source: "verify-pass-fallback",
            };
        }
        return parsed;
    }

    const response = await callChatCompletionsRaw({
        baseUrl: params.baseUrl,
        model: params.model,
        messages: [
            { role: "system", content: supervisorSystem },
            { role: "user", content: reviewPrompt },
        ],
        tools: [],
        toolChoice: "none",
        temperature: supervisorSettings.temperature,
        maxTokens: supervisorSettings.maxTokens,
        timeoutMs: params.timeoutMs,
        apiKey: params.backendRuntime.apiKey,
    });
    const parsed = parseFinishSupervisorDecision(response.choices[0]?.message?.content || "", Date.now() - startedAt);
    if (parsed.source === "invalid" && params.verifyResult?.ok && hasSuccessfulMutatingExecution(params.executedToolCalls)) {
        return {
            decision: "PASS",
            raw: parsed.raw,
            durationMs: parsed.durationMs,
            source: "verify-pass-fallback",
        };
    }
    return parsed;
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


function promptLooksLikeFeishuAttachmentSend(prompt: string): boolean {
    const input = (prompt || "").trim();
    if (!input) return false;
    return /(飞书|feishu)/i.test(input)
        && /(发送|发给|上传|回传)/.test(input)
        && /(文件|图片|附件|截图|png|jpg|jpeg|pdf|image)/i.test(input);
}

function answerClaimsFeishuDelivery(answer: string): boolean {
    const input = (answer || "").trim();
    if (!input) return false;
    return /(已|已经).{0,8}(发送|上传).{0,24}(飞书|群|图片|文件|附件)/.test(input)
        || (/发送成功/.test(input) && /(飞书|图片|文件|附件)/.test(input));
}

function hasSuccessfulFeishuSendResult(executedToolCalls: ExecutedToolCall[]): boolean {
    return executedToolCalls.some(({ tc, result }) => {
        if (tc.function.name !== "feishu_send_file") return false;
        if (!result || typeof result !== "object") return false;
        return typeof (result as Record<string, unknown>).attachmentType === "string";
    });
}

function hardenFeishuDeliveryClaim(
    answer: string,
    executedToolCalls: ExecutedToolCall[],
    prompt: string
): string {
    if (!promptLooksLikeFeishuAttachmentSend(prompt)) return answer;
    if (!answerClaimsFeishuDelivery(answer)) return answer;
    if (hasSuccessfulFeishuSendResult(executedToolCalls)) return answer;
    return "我还没有真正把附件发送到飞书。只有 feishu_send_file 成功后，我才会确认“已发送”。";
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

function buildToolFailureAnswer(toolName: string, toolResult: ToolRunResult): string {
    const toolErrorCode = toolResult.errorCode || "TOOL_EXEC_FAILED";
    const toolErrorMessage = toolResult.error || "工具执行失败";
    let answerText = `工具执行失败\n- 工具：${toolName}\n- 错误码：${toolErrorCode}\n- 错误：${toolErrorMessage}`;
    if (toolResult.exitCode !== undefined && toolResult.exitCode !== null) {
        answerText += `\n- 退出码：${toolResult.exitCode}`;
    }
    if (toolResult.stderrTail) {
        answerText += `\n- stderr 尾部：${toolResult.stderrTail.slice(-200)}`;
    }
    if (toolResult.fullOutputPath) {
        answerText += `\n- 完整日志：${toolResult.fullOutputPath}`;
    }
    return answerText;
}

function buildToolFailureVerifyResult(toolName: string, toolResult: ToolRunResult): VerifyResult {
    return {
        ok: false,
        evidence: JSON.stringify({
            tool: toolName,
            exitCode: toolResult.exitCode ?? null,
            stderrTail: toolResult.stderrTail ?? "",
            fullOutputPath: toolResult.fullOutputPath ?? null,
        }),
        failureReason: toolResult.error || "工具执行失败",
        errorCode: toolResult.errorCode || "TOOL_EXEC_FAILED",
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
 * 不再使用 PI_ON_TOOLS 硬编码白名单
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
        // 不再让 pi.enabled 决定“有没有工具”，否则会吞掉 feishu_send_file 等已允许工具。
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
    const supervisorSettings = getFinishSupervisorSettings();
    let supervisorContinueCount = 0;
    let currentResponse = response;
    let currentToolCalls = toolCalls;
    let forcedFinalState: ForcedFinalState | undefined;
    let lastFailureState: ForcedFinalState | undefined;

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
            let toolFailureTriggered = false;

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

                    forcedFinalState = {
                        answer: buildToolFailureAnswer(tc.function.name, toolResult),
                        toolCall: { name: tc.function.name, args, result: toolResult },
                        verifyResult: buildToolFailureVerifyResult(tc.function.name, toolResult),
                    };
                    lastFailureState = forcedFinalState;
                    toolFailureTriggered = true;
                    break;
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

            if (toolFailureTriggered) {
                currentToolCalls = [];
            } else {
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

        let finalAnswer: string;
        let verifyResult: VerifyResult | undefined;

        if (forcedFinalState) {
            finalAnswer = forcedFinalState.answer;
            verifyResult = forcedFinalState.verifyResult;
        } else {
            const cleanedAnswer = sanitizeLmStudioOutput(currentResponse.content || "");
            finalAnswer = cleanedAnswer;

            if (!cleanedAnswer || hasToolProtocolArtifacts(cleanedAnswer)) {
                const fallbackAnswer = buildToolLoopFallbackAnswer(executedToolCalls, params.options.prompt);
                if (fallbackAnswer) {
                    finalAnswer = fallbackAnswer;
                }
            }

            finalAnswer = hardenFeishuDeliveryClaim(finalAnswer, executedToolCalls, params.options.prompt);

            const verifyOutcome = await runVerifyPhase(
                executedToolCalls,
                actionJournal,
                params.traceId,
                params.route
            );
            verifyResult = verifyOutcome.verifyResult;

            if (verifyOutcome.verifyJournal) {
                actionJournal.push(verifyOutcome.verifyJournal);
            }
        }

        const shouldReviewWithSupervisor = supervisorSettings.enabled && shouldRunFinishSupervisor({
            finalAnswer,
            executedToolCalls,
            forcedFinalState,
        });

        if (shouldReviewWithSupervisor) {
            const supervisorDecision = await runFinishSupervisorReview({
                backendRuntime: {
                    id: "minimax",
                    baseUrl: params.baseUrl,
                    apiKey: params.apiKey,
                    model: params.model,
                    timeoutMs: params.timeoutMs,
                    nativeApiEnabled: false,
                },
                baseUrl: params.baseUrl,
                model: params.model,
                timeoutMs: params.timeoutMs,
                prompt: params.options.prompt,
                finalAnswer,
                windowMessages: params.options.windowMessages,
                actionJournal,
                executedToolCalls,
                verifyResult,
                continueCount: supervisorContinueCount,
            });
            appendFinishSupervisorJournalEntry({
                actionJournal,
                traceId: params.traceId,
                route: params.route,
                model: params.model,
                decision: supervisorDecision,
            });
            logger.info("finish supervisor reviewed", {
                module: "agent-backend/tool-loop",
                traceId: params.traceId,
                route: params.route,
                provider: "minimax",
                decision: supervisorDecision.decision,
                source: supervisorDecision.source,
                continueCount: supervisorContinueCount,
                reason: supervisorDecision.reason,
                rawPreview: clipText(supervisorDecision.raw, 120),
            });

            if (supervisorDecision.decision === "CONTINUE") {
                supervisorContinueCount += 1;
                const continueReason = supervisorDecision.reason || "结束前证据不足";
                if (supervisorContinueCount >= supervisorSettings.maxContinues) {
                    logger.warn("finish supervisor blocked completion", {
                        module: "agent-backend/tool-loop",
                        traceId: params.traceId,
                        route: params.route,
                        provider: "minimax",
                        continueCount: supervisorContinueCount,
                        reason: continueReason,
                    });
                    const firstBlockedCall = forcedFinalState?.toolCall
                        ?? lastFailureState?.toolCall
                        ?? (executedToolCalls[0]
                            ? { name: executedToolCalls[0].tc.function.name, args: executedToolCalls[0].args, result: executedToolCalls[0].result }
                            : undefined);
                    return {
                        answer: buildFinishSupervisorBlockedAnswer(continueReason, supervisorContinueCount),
                        toolCall: firstBlockedCall,
                        actionJournal,
                        verifyResult: verifyResult ?? lastFailureState?.verifyResult,
                        decisionSource: executedToolCalls.length === 0 ? "model" : undefined,
                        quotaProfile: params.quotaProfile,
                        perTurnToolCallLimit: params.perTurnToolCallLimit,
                        perTurnToolStepLimit: params.perTurnToolStepLimit,
                        remainingToolCalls: params.perTurnToolCallLimit,
                        remainingSteps: params.perTurnToolStepLimit - executedToolCalls.length,
                    };
                }

                const assistantMessage: MiniMaxAnthropicMessage = {
                    role: "assistant",
                    content: forcedFinalState?.answer
                        ?? (currentResponse.contentBlocks.length > 0 ? currentResponse.contentBlocks : currentResponse.content || ""),
                };
                const supervisorFeedback: MiniMaxAnthropicMessage = {
                    role: "user",
                    content: buildFinishSupervisorContinuationMessage(
                        continueReason,
                        supervisorContinueCount,
                        supervisorSettings.maxContinues
                    ),
                };

                conversationMessages = [...conversationMessages, assistantMessage, supervisorFeedback];
                forcedFinalState = undefined;
                currentResponse = await callMiniMaxAnthropicRaw({
                    baseUrl: params.baseUrl,
                    model: params.model,
                    messages: conversationMessages,
                    system: anthropicContext.system,
                    tools: params.activeToolSchemas,
                    toolChoice: { type: "auto" },
                    temperature: 0,
                    maxTokens: MAIN_AGENT_MAX_TOKENS,
                    timeoutMs: params.timeoutMs,
                    apiKey: params.apiKey,
                });
                currentToolCalls = currentResponse.toolCalls;
                continue;
            }
        }

        const firstCall = forcedFinalState?.toolCall
            ?? (executedToolCalls[0]
                ? { name: executedToolCalls[0].tc.function.name, args: executedToolCalls[0].args, result: executedToolCalls[0].result }
                : undefined);
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
    const workspacePathHint = buildWorkspacePathHint(workspacePath);
    if (workspacePathHint) {
        system += `\n\n${workspacePathHint}`;
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
            skillHint += "调用方式：read_file 先读 ~/.config/msgcode/skills/<id>/SKILL.md。把 SKILL.md 当成能力说明书 / 接口文档，仔细阅读后再按里面写明的真实调用合同执行；不要自造 wrapper，不要猜 main.sh，也不要猜 skill 目录里还有别的脚本。判断某个 skill 能做什么、不能做什么之前，必须先读清 SKILL.md；如果看完仍然不确定，就先和用户沟通，不要先下结论。";
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
    const supervisorSettings = getFinishSupervisorSettings();
    let supervisorContinueCount = 0;
    let currentAssistantRole = msg1?.role || "assistant";
    let currentAssistantContent = msg1?.content;
    let currentToolCalls = toolCalls;
    let conversationMessages = [...messages];
    let forcedFinalState: ForcedFinalState | undefined;
    let lastFailureState: ForcedFinalState | undefined;

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
            let toolFailureTriggered = false;

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

                    forcedFinalState = {
                        answer: buildToolFailureAnswer(tc.function.name, toolResult),
                        toolCall: { name: tc.function.name, args, result: toolResult },
                        verifyResult: buildToolFailureVerifyResult(tc.function.name, toolResult),
                    };
                    lastFailureState = forcedFinalState;
                    currentAssistantRole = "assistant";
                    currentAssistantContent = forcedFinalState.answer;
                    toolFailureTriggered = true;
                    break;
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

            if (toolFailureTriggered) {
                currentToolCalls = [];
            } else {
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

        let finalAnswer: string;
        let verifyResult: VerifyResult | undefined;

        if (forcedFinalState) {
            finalAnswer = forcedFinalState.answer;
            verifyResult = forcedFinalState.verifyResult;
        } else {
            const cleanedAnswer = sanitizeLmStudioOutput(currentAssistantContent ?? "");
            finalAnswer = cleanedAnswer;

            if (!cleanedAnswer || hasToolProtocolArtifacts(cleanedAnswer)) {
                const fallbackAnswer = buildToolLoopFallbackAnswer(executedToolCalls, options.prompt);
                if (fallbackAnswer) {
                    finalAnswer = fallbackAnswer;
                }
            }

            finalAnswer = hardenFeishuDeliveryClaim(finalAnswer, executedToolCalls, options.prompt);

            // P5.7-R12-T3: 在返回前执行 verify phase
            const verifyOutcome = await runVerifyPhase(
                executedToolCalls,
                actionJournal,
                traceId,
                route
            );
            verifyResult = verifyOutcome.verifyResult;

            // 如果有 verify journal，添加到 actionJournal
            if (verifyOutcome.verifyJournal) {
                actionJournal.push(verifyOutcome.verifyJournal);
            }
        }

        const shouldReviewWithSupervisor = supervisorSettings.enabled && shouldRunFinishSupervisor({
            finalAnswer,
            executedToolCalls,
            forcedFinalState,
        });

        if (shouldReviewWithSupervisor) {
            const supervisorDecision = await runFinishSupervisorReview({
                backendRuntime,
                baseUrl,
                model: usedModel,
                timeoutMs,
                prompt: options.prompt,
                finalAnswer,
                windowMessages: options.windowMessages,
                actionJournal,
                executedToolCalls,
                verifyResult,
                continueCount: supervisorContinueCount,
            });
            appendFinishSupervisorJournalEntry({
                actionJournal,
                traceId,
                route,
                model: usedModel,
                decision: supervisorDecision,
            });
            logger.info("finish supervisor reviewed", {
                module: "agent-backend/tool-loop",
                traceId,
                route,
                provider: backendRuntime.id,
                decision: supervisorDecision.decision,
                source: supervisorDecision.source,
                continueCount: supervisorContinueCount,
                reason: supervisorDecision.reason,
                rawPreview: clipText(supervisorDecision.raw, 120),
            });

            if (supervisorDecision.decision === "CONTINUE") {
                supervisorContinueCount += 1;
                const continueReason = supervisorDecision.reason || "结束前证据不足";
                if (supervisorContinueCount >= supervisorSettings.maxContinues) {
                    logger.warn("finish supervisor blocked completion", {
                        module: "agent-backend/tool-loop",
                        traceId,
                        route,
                        provider: backendRuntime.id,
                        continueCount: supervisorContinueCount,
                        reason: continueReason,
                    });
                    const firstBlockedCall = forcedFinalState?.toolCall
                        ?? lastFailureState?.toolCall
                        ?? (executedToolCalls[0]
                            ? { name: executedToolCalls[0].tc.function.name, args: executedToolCalls[0].args, result: executedToolCalls[0].result }
                            : undefined);
                    return {
                        answer: buildFinishSupervisorBlockedAnswer(continueReason, supervisorContinueCount),
                        toolCall: firstBlockedCall,
                        actionJournal,
                        verifyResult: verifyResult ?? lastFailureState?.verifyResult,
                        decisionSource: executedToolCalls.length === 0 ? "model" : undefined,
                        quotaProfile,
                        perTurnToolCallLimit,
                        perTurnToolStepLimit,
                        remainingToolCalls: perTurnToolCallLimit,
                        remainingSteps: perTurnToolStepLimit - executedToolCalls.length,
                    };
                }

                const supervisorFeedback = {
                    role: "user" as const,
                    content: buildFinishSupervisorContinuationMessage(
                        continueReason,
                        supervisorContinueCount,
                        supervisorSettings.maxContinues
                    ),
                };
                if ((currentAssistantContent || "").trim()) {
                    conversationMessages = [
                        ...conversationMessages,
                        { role: currentAssistantRole, content: currentAssistantContent },
                        supervisorFeedback,
                    ];
                } else {
                    conversationMessages = [...conversationMessages, supervisorFeedback];
                }
                forcedFinalState = undefined;

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
                continue;
            }
        }

        const firstCall = forcedFinalState?.toolCall
            ?? (executedToolCalls[0]
                ? { name: executedToolCalls[0].tc.function.name, args: executedToolCalls[0].args, result: executedToolCalls[0].result }
                : undefined);
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
        hardenFeishuDeliveryClaim,
        buildWorkspacePathHint,
    }
    : undefined;

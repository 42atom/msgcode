/**
 * msgcode: Agent Backend 配置解析模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的配置解析逻辑
 * 目标：单源化后端配置解析，支持多后端扩展
 *
 * 配置驱动原则（冻结）：
 * 1. 后端与模型切换一律走配置，不走代码分支切换
 * 2. 业务主链禁止出现"按具体模型名判断逻辑"
 * 3. 配置解析单源化：AGENT_BACKEND + AGENT_MODEL 为主入口
 * 4. 任何新增后端必须先接入统一配置解析，再接入执行链路
 */

import { config } from "../config.js";
import { resolveLocalBackendRuntime } from "../local-backend/registry.js";
import type { AgentBackendId, AgentBackendRuntime } from "./types.js";

////// Per-model contract baseline

export type ModelContractSelector =
    | "tmux:codex"
    | "tmux:claude-code"
    | "agent:openai-compat"
    | "agent:minimax";

export type ModelToolProtocol =
    | "cli-owned"
    | "native-tool-call"
    | "anthropic-content";

export type ModelRequestMaxOutputPolicy = "cli-owned" | "explicit";
export type ModelRequestStopPolicy = "cli-owned" | "explicit" | "unsupported";
export type ModelReasoningEffortPolicy = "cli-owned" | "provider-default";
export type ModelParserKind =
    | "codex-jsonl"
    | "assistant-jsonl"
    | "openai-compat-tool-call"
    | "minimax-anthropic-content";
export type ModelCompletionSignal = "stable-text" | "stop-hook-summary" | "finish-reason";
export type ModelToolCallShape = "none" | "anthropic-content-block" | "openai-tool-call";

export interface ModelRequestContract {
    modelSelector: ModelContractSelector;
    toolProtocol: ModelToolProtocol;
    requestMaxOutputTokens: ModelRequestMaxOutputPolicy;
    requestStopSequences: ModelRequestStopPolicy;
    reasoningEffortPolicy: ModelReasoningEffortPolicy;
    stopSequences: string[];
}

export interface ModelParseContract {
    modelSelector: ModelContractSelector;
    parserKind: ModelParserKind;
    completionSignal: ModelCompletionSignal;
    toolCallShape: ModelToolCallShape;
}

export interface ModelOutputContract {
    modelSelector: ModelContractSelector;
    request: ModelRequestContract;
    parse: ModelParseContract;
}

type TmuxContractRunner = "codex" | "claude-code" | "claude";

const MODEL_OUTPUT_CONTRACTS: Record<ModelContractSelector, ModelOutputContract> = {
    "tmux:codex": {
        modelSelector: "tmux:codex",
        request: {
            modelSelector: "tmux:codex",
            toolProtocol: "cli-owned",
            requestMaxOutputTokens: "cli-owned",
            requestStopSequences: "cli-owned",
            reasoningEffortPolicy: "cli-owned",
            stopSequences: [],
        },
        parse: {
            modelSelector: "tmux:codex",
            parserKind: "codex-jsonl",
            completionSignal: "stable-text",
            toolCallShape: "none",
        },
    },
    "tmux:claude-code": {
        modelSelector: "tmux:claude-code",
        request: {
            modelSelector: "tmux:claude-code",
            toolProtocol: "cli-owned",
            requestMaxOutputTokens: "cli-owned",
            requestStopSequences: "cli-owned",
            reasoningEffortPolicy: "cli-owned",
            stopSequences: [],
        },
        parse: {
            modelSelector: "tmux:claude-code",
            parserKind: "assistant-jsonl",
            completionSignal: "stop-hook-summary",
            toolCallShape: "anthropic-content-block",
        },
    },
    "agent:openai-compat": {
        modelSelector: "agent:openai-compat",
        request: {
            modelSelector: "agent:openai-compat",
            toolProtocol: "native-tool-call",
            requestMaxOutputTokens: "explicit",
            requestStopSequences: "explicit",
            reasoningEffortPolicy: "provider-default",
            stopSequences: [],
        },
        parse: {
            modelSelector: "agent:openai-compat",
            parserKind: "openai-compat-tool-call",
            completionSignal: "finish-reason",
            toolCallShape: "openai-tool-call",
        },
    },
    "agent:minimax": {
        modelSelector: "agent:minimax",
        request: {
            modelSelector: "agent:minimax",
            toolProtocol: "anthropic-content",
            requestMaxOutputTokens: "explicit",
            requestStopSequences: "unsupported",
            reasoningEffortPolicy: "provider-default",
            stopSequences: [],
        },
        parse: {
            modelSelector: "agent:minimax",
            parserKind: "minimax-anthropic-content",
            completionSignal: "finish-reason",
            toolCallShape: "anthropic-content-block",
        },
    },
};

export function resolveAgentModelOutputContract(runtime: Pick<AgentBackendRuntime, "id">): ModelOutputContract {
    if (runtime.id === "minimax") {
        return MODEL_OUTPUT_CONTRACTS["agent:minimax"];
    }
    return MODEL_OUTPUT_CONTRACTS["agent:openai-compat"];
}

export function resolveTmuxModelOutputContract(runnerOld: TmuxContractRunner): ModelOutputContract {
    if (runnerOld === "codex") {
        return MODEL_OUTPUT_CONTRACTS["tmux:codex"];
    }
    return MODEL_OUTPUT_CONTRACTS["tmux:claude-code"];
}

// ============================================
// Provider 别名集合
// ============================================

/**
 * Provider 别名（不是真实模型 ID）
 * 用于路由分类和配置解析
 */
export const MODEL_ALIAS_SET = new Set([
    "lmstudio",
    "omlx",
    "agent-backend",
    "local-openai",
    "openai",
    "minimax",
    "deepseek",
    "llama",
    "claude",
    "none",
    "default-executor",
    "default-responder",
]);

/**
 * 标准化模型覆盖值
 *
 * 规则：
 * - 空字符串/别名返回 undefined（触发自动模型解析）
 * - 其他值按真实模型 ID 透传
 */
export function normalizeModelOverride(model?: string): string | undefined {
    const normalized = (model || "").trim();
    if (!normalized) return undefined;
    if (MODEL_ALIAS_SET.has(normalized.toLowerCase())) return undefined;
    return normalized;
}

// ============================================
// 配置解析辅助函数
// ============================================

/**
 * 解析后端超时时间（毫秒）
 */
export function parseBackendTimeoutMs(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

/**
 * 标准化后端 ID
 *
 * 将各种别名统一为标准后端 ID：
 * - lmstudio / agent-backend / local-openai → local-openai
 * - openai → openai
 * - minimax → minimax
 * - deepseek → deepseek
 * - llama / claude / none → local-openai（兼容遗留）
 */
export function normalizeAgentBackendId(raw?: string): AgentBackendId {
    const normalized = (raw || "").trim().toLowerCase();
    if (
        !normalized ||
        normalized === "lmstudio" ||
        normalized === "omlx" ||
        normalized === "agent-backend" ||
        normalized === "local-openai"
    ) {
        return "local-openai";
    }
    if (normalized === "openai") return "openai";
    if (normalized === "minimax") return "minimax";
    if (normalized === "deepseek") return "deepseek";
    // 兼容遗留 provider 名称，先统一回本地后端
    if (normalized === "llama" || normalized === "claude" || normalized === "none") {
        return "local-openai";
    }
    return "local-openai";
}

// ============================================
// 主配置解析入口
// ============================================

/**
 * 解析 Agent Backend 运行时配置（单源化入口）
 *
 * 优先级：
 * 1. 传入的 rawBackend 参数
 * 2. AGENT_BACKEND 环境变量
 * 3. 回退到 "local-openai"
 *
 * @param rawBackend 可选的后端字符串（覆盖环境变量）
 * @returns AgentBackendRuntime 配置对象
 */
export function resolveAgentBackendRuntime(rawBackend?: string): AgentBackendRuntime {
    const id = normalizeAgentBackendId(rawBackend || process.env.AGENT_BACKEND);
    const defaultTimeout = typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 120_000;

    if (id === "minimax") {
        const baseUrl = (
            process.env.MINIMAX_ANTHROPIC_BASE_URL ||
            process.env.MINIMAX_BASE_URL ||
            process.env.AGENT_BASE_URL ||
            "https://api.minimax.io/anthropic"
        ).trim();
        return {
            id,
            baseUrl,
            apiKey: (process.env.MINIMAX_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: (process.env.MINIMAX_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: parseBackendTimeoutMs(process.env.MINIMAX_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, defaultTimeout),
            nativeApiEnabled: false,
        };
    }

    if (id === "openai") {
        return {
            id,
            baseUrl: (process.env.OPENAI_BASE_URL || process.env.AGENT_BASE_URL || "https://api.openai.com").trim(),
            apiKey: (process.env.OPENAI_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: (process.env.OPENAI_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: parseBackendTimeoutMs(process.env.OPENAI_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, defaultTimeout),
            nativeApiEnabled: false,
        };
    }

    if (id === "deepseek") {
        return {
            id,
            baseUrl: (process.env.DEEPSEEK_BASE_URL || process.env.AGENT_BASE_URL || "https://api.deepseek.com").trim(),
            apiKey: (process.env.DEEPSEEK_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: (process.env.DEEPSEEK_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: parseBackendTimeoutMs(process.env.DEEPSEEK_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, defaultTimeout),
            nativeApiEnabled: false,
        };
    }

    const localRuntime = resolveLocalBackendRuntime(rawBackend);
    return {
        id: "local-openai",
        baseUrl: localRuntime.baseUrl,
        apiKey: localRuntime.apiKey,
        model: localRuntime.model,
        timeoutMs: localRuntime.timeoutMs || defaultTimeout,
        nativeApiEnabled: localRuntime.nativeApiEnabled,
        localBackendId: localRuntime.id,
        supportsModelLifecycle: localRuntime.supportsModelLifecycle,
        modelsListPath: localRuntime.modelsListPath,
        modelsStatusPath: localRuntime.modelsStatusPath,
    };
}

// ============================================
// 兼容函数（过渡期保留）
// ============================================

/**
 * @deprecated 请使用 resolveAgentBackendRuntime
 */
export const resolveLmStudioBackendRuntime = resolveAgentBackendRuntime;

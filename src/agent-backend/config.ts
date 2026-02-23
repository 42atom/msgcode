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
import type { AgentBackendId, AgentBackendRuntime } from "./types.js";

// ============================================
// Provider 别名集合
// ============================================

/**
 * Provider 别名（不是真实模型 ID）
 * 用于路由分类和配置解析
 */
export const MODEL_ALIAS_SET = new Set([
    "lmstudio",
    "agent-backend",
    "local-openai",
    "openai",
    "minimax",
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
 * - llama / claude / none → local-openai（兼容遗留）
 */
export function normalizeAgentBackendId(raw?: string): AgentBackendId {
    const normalized = (raw || "").trim().toLowerCase();
    if (!normalized || normalized === "lmstudio" || normalized === "agent-backend" || normalized === "local-openai") {
        return "local-openai";
    }
    if (normalized === "openai") return "openai";
    if (normalized === "minimax") return "minimax";
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
        const baseUrl = (process.env.MINIMAX_BASE_URL || process.env.AGENT_BASE_URL || "").trim();
        if (!baseUrl) {
            throw new Error("MiniMax backend 未配置：请设置 MINIMAX_BASE_URL 或 AGENT_BASE_URL");
        }
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

    return {
        id: "local-openai",
        baseUrl: (process.env.LMSTUDIO_BASE_URL || process.env.AGENT_BASE_URL || config.lmstudioBaseUrl || "http://127.0.0.1:1234").trim(),
        apiKey: (process.env.LMSTUDIO_API_KEY || process.env.AGENT_API_KEY || config.lmstudioApiKey || "").trim() || undefined,
        model: (process.env.LMSTUDIO_MODEL || process.env.AGENT_MODEL || config.lmstudioModel || "").trim() || undefined,
        timeoutMs: parseBackendTimeoutMs(process.env.LMSTUDIO_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, defaultTimeout),
        nativeApiEnabled: true,
    };
}

// ============================================
// 兼容函数（过渡期保留）
// ============================================

/**
 * @deprecated 请使用 resolveAgentBackendRuntime
 */
export const resolveLmStudioBackendRuntime = resolveAgentBackendRuntime;

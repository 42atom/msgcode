/**
 * msgcode: 本地模型后端注册表
 *
 * 目标：
 * - 收口 lmstudio / omlx 的本地运行时配置
 * - 让 chat / vision / embedding / capability probe 共享同一份本地后端真相源
 * - 本轮只支持手动切换，不做自动切换或恢复编排
 */

import { config } from "../config.js";

/**
 * 本地后端 ID
 */
export type LocalAgentBackendId = "lmstudio" | "omlx";

/**
 * 本地后端运行时配置
 */
export interface LocalBackendRuntime {
    id: LocalAgentBackendId;
    baseUrl: string;
    apiKey?: string;
    model?: string;
    visionModel?: string;
    embeddingModel?: string;
    timeoutMs: number;
    nativeApiEnabled: boolean;
    supportsModelLifecycle: boolean;
    modelsListPath: string;
    modelsStatusPath?: string;
}

const DEFAULT_LOCAL_BACKEND_TIMEOUT_MS = typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
    ? config.lmstudioTimeoutMs
    : 120_000;

function parseTimeoutMs(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function normalizeBaseUrl(raw: string): string {
    return raw.trim().replace(/\/+$/, "");
}

/**
 * 标准化本地后端 ID
 *
 * 兼容：
 * - 空值 / agent-backend / local-openai -> lmstudio
 * - omlx -> omlx
 */
export function normalizeLocalAgentBackendId(raw?: string): LocalAgentBackendId {
    const normalized = (raw || "").trim().toLowerCase();
    if (normalized === "omlx") {
        return "omlx";
    }
    return "lmstudio";
}

/**
 * 解析当前配置中的本地后端 ID
 *
 * 优先级：
 * 1. 显式传入
 * 2. LOCAL_AGENT_BACKEND
 * 3. 遗留兼容：AGENT_BACKEND=omlx
 * 4. 默认 lmstudio
 */
export function resolveConfiguredLocalBackendId(raw?: string): LocalAgentBackendId {
    const explicit = (raw || "").trim().toLowerCase();
    if (explicit === "lmstudio" || explicit === "omlx") {
        return normalizeLocalAgentBackendId(explicit);
    }

    const configured = (process.env.LOCAL_AGENT_BACKEND || "").trim().toLowerCase();
    if (configured) {
        return normalizeLocalAgentBackendId(configured);
    }

    const legacyAgentBackend = (process.env.AGENT_BACKEND || "").trim().toLowerCase();
    if (legacyAgentBackend === "lmstudio" || legacyAgentBackend === "omlx") {
        return normalizeLocalAgentBackendId(legacyAgentBackend);
    }

    return "lmstudio";
}

/**
 * 解析本地后端运行时配置
 */
export function resolveLocalBackendRuntime(raw?: string): LocalBackendRuntime {
    const id = resolveConfiguredLocalBackendId(raw);

    if (id === "omlx") {
        return {
            id,
            baseUrl: normalizeBaseUrl(process.env.OMLX_BASE_URL || process.env.AGENT_BASE_URL || "http://127.0.0.1:8000"),
            apiKey: (process.env.OMLX_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: (process.env.OMLX_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            visionModel: (process.env.OMLX_VISION_MODEL || "").trim() || undefined,
            embeddingModel: (process.env.OMLX_EMBEDDING_MODEL || "").trim() || undefined,
            timeoutMs: parseTimeoutMs(process.env.OMLX_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, DEFAULT_LOCAL_BACKEND_TIMEOUT_MS),
            nativeApiEnabled: false,
            supportsModelLifecycle: false,
            modelsListPath: "/v1/models",
            modelsStatusPath: "/v1/models/status",
        };
    }

    return {
        id: "lmstudio",
        baseUrl: normalizeBaseUrl(process.env.LMSTUDIO_BASE_URL || process.env.AGENT_BASE_URL || config.lmstudioBaseUrl || "http://127.0.0.1:1234"),
        apiKey: (process.env.LMSTUDIO_API_KEY || process.env.AGENT_API_KEY || config.lmstudioApiKey || "").trim() || undefined,
        model: (process.env.LMSTUDIO_MODEL || process.env.AGENT_MODEL || config.lmstudioModel || "").trim() || undefined,
        visionModel: (process.env.LMSTUDIO_VISION_MODEL || "").trim() || undefined,
        embeddingModel: (process.env.LMSTUDIO_EMBEDDING_MODEL || "").trim() || undefined,
        timeoutMs: parseTimeoutMs(process.env.LMSTUDIO_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, DEFAULT_LOCAL_BACKEND_TIMEOUT_MS),
        nativeApiEnabled: true,
        supportsModelLifecycle: true,
        modelsListPath: "/api/v1/models",
    };
}

/**
 * 解析视觉模型名
 */
export function resolveLocalVisionModel(runtime: LocalBackendRuntime, fallback: string): string {
    return runtime.visionModel || runtime.model || fallback;
}

/**
 * 解析 embedding 模型名
 */
export function resolveLocalEmbeddingModel(runtime: LocalBackendRuntime, fallback: string): string {
    return runtime.embeddingModel || fallback;
}

/**
 * msgcode: Model Capabilities Registry
 *
 * Purpose:
 * - Define model capabilities for context budgeting
 * - Support per-provider token limits and reservations
 * - Runtime resolve: API first, table fallback, env override
 *
 * Design:
 * - Support lmstudio, codex, claude-code
 * - Fallback to safe defaults if provider not found
 */

// ============================================
// Types
// ============================================

/**
 * Model capability descriptor
 */
export interface ModelCapabilities {
    /**
     * Total context window size in tokens
     * - Default: 4096 (conservative for GLM4.7 Flash)
     */
    contextWindowTokens: number;

    /**
     * Reserved tokens for model output
     * - Default: 1024 (ensure space for response)
     */
    reservedOutputTokens: number;

    /**
     * Approximate characters per token
     * - Default: 2 (Chinese/English mixed)
     */
    charsPerToken: number;
}

/**
 * Agent backend provider（预算解析专用）
 */
export type AgentCapabilityProvider = "local-openai" | "openai" | "minimax" | "gemini";

/**
 * 运行时能力来源
 */
export type RuntimeCapabilitySource =
    | "env-override"
    | "api-models"
    | "model-table"
    | "provider-table"
    | "fallback";

/**
 * 运行时能力解析结果
 */
export interface RuntimeCapabilities extends ModelCapabilities {
    provider: AgentCapabilityProvider;
    model?: string;
    source: RuntimeCapabilitySource;
    cacheHit: boolean;
}

/**
 * Budget target types (用于 context budgeting)
 *
 * 注意：这是 budget/capabilities 的目标分类，不是完整意义上的 provider registry
 * - "lmstudio": 本地模型 provider
 * - "codex" / "claude-code": tmux runners
 */
export type BudgetTarget = "lmstudio" | "codex" | "claude-code";

// ============================================
// Capability Definitions
// ============================================

/**
 * Default capabilities for local models (GLM4.7 Flash)
 *
 * GLM4.7 Flash context window: ~128k tokens (theoretical)
 * - Use 16384 (16k) as practical limit for stability
 * - GLM-4.7 tends to loop with very long contexts
 * - 16k provides good balance between memory and stability
 */
const DEFAULT_CAPABILITIES: ModelCapabilities = {
    contextWindowTokens: 16384,  // 16k tokens (increased from 4096 for better context)
    reservedOutputTokens: 2048,    // Reserve more space for longer responses
    charsPerToken: 2,
};

/**
 * 兜底能力（保守）
 */
const SAFE_FALLBACK_CAPABILITIES: ModelCapabilities = {
    contextWindowTokens: 4096,
    reservedOutputTokens: 1024,
    charsPerToken: 2,
};

/**
 * Capabilities registry
 */
const CAPABILITIES_REGISTRY: Record<BudgetTarget, ModelCapabilities> = {
    lmstudio: DEFAULT_CAPABILITIES,
    codex: DEFAULT_CAPABILITIES,
    "claude-code": DEFAULT_CAPABILITIES,
};

/**
 * Provider 级默认能力（表覆盖）
 */
const PROVIDER_CAPABILITIES: Record<AgentCapabilityProvider, ModelCapabilities> = {
    "local-openai": {
        contextWindowTokens: 16384,
        reservedOutputTokens: 2048,
        charsPerToken: 2,
    },
    openai: {
        contextWindowTokens: 128000,
        reservedOutputTokens: 4096,
        charsPerToken: 3,
    },
    minimax: {
        contextWindowTokens: 204800,
        reservedOutputTokens: 4096,
        charsPerToken: 2,
    },
    gemini: {
        contextWindowTokens: 1048576,
        reservedOutputTokens: 8192,
        charsPerToken: 3,
    },
};

/**
 * 模型级能力提示表（表覆盖）
 *
 * 说明：
 * - API 解析失败时兜底
 * - 使用保守值避免高估导致爆窗
 */
const MODEL_CAPABILITY_HINTS: Array<{ pattern: RegExp; caps: ModelCapabilities }> = [
    {
        pattern: /(huihui-glm|glm-4\.7|glm-4\.6v|glm4|qwen2\.5-coder-7b|qwen2\.5-7b)/i,
        caps: { contextWindowTokens: 16384, reservedOutputTokens: 2048, charsPerToken: 2 },
    },
    {
        pattern: /(minimax|abab|m2|mini\s*max)/i,
        caps: { contextWindowTokens: 204800, reservedOutputTokens: 4096, charsPerToken: 2 },
    },
    {
        pattern: /(gemini|banana-pro|gemini-2\.5|gemini-1\.5)/i,
        caps: { contextWindowTokens: 1048576, reservedOutputTokens: 8192, charsPerToken: 3 },
    },
    {
        pattern: /(gpt-4\.1|gpt-4o|o3|o4|claude-3|claude-4|claude-sonnet|claude-opus)/i,
        caps: { contextWindowTokens: 200000, reservedOutputTokens: 4096, charsPerToken: 3 },
    },
];

const CAPABILITY_CACHE_TTL_MS = 5 * 60 * 1000;

interface RuntimeCapabilityContext {
    provider: AgentCapabilityProvider;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    timeoutMs: number;
}

interface RuntimeCapabilityCacheEntry {
    expiresAt: number;
    value: Omit<RuntimeCapabilities, "cacheHit">;
}

const runtimeCapabilityCache = new Map<string, RuntimeCapabilityCacheEntry>();

// ============================================
// Public API
// ============================================

/**
 * Get capabilities for a budget target
 *
 * @param target - Budget target type (lmstudio, codex, claude-code)
 * @returns Model capabilities or safe defaults
 */
export function getCapabilities(target: BudgetTarget): ModelCapabilities {
    const caps = CAPABILITIES_REGISTRY[target];

    if (!caps) {
        return SAFE_FALLBACK_CAPABILITIES;
    }

    return caps;
}

/**
 * Get input budget (context window minus reserved output)
 *
 * @param target - Budget target type
 * @returns Input budget in tokens
 */
export function getInputBudget(target: BudgetTarget): number {
    const caps = getCapabilities(target);
    return getInputBudgetFromCapabilities(caps);
}

/**
 * 从能力对象计算输入预算
 */
export function getInputBudgetFromCapabilities(caps: ModelCapabilities): number {
    return caps.contextWindowTokens - caps.reservedOutputTokens;
}

/**
 * 清理运行时能力缓存（供测试使用）
 */
export function clearRuntimeCapabilityCache(): void {
    runtimeCapabilityCache.clear();
}

/**
 * 解析运行时能力（动态获取优先 + 表覆盖）
 */
export async function resolveRuntimeCapabilities(params?: {
    agentProvider?: string;
    model?: string;
}): Promise<RuntimeCapabilities> {
    const runtime = resolveRuntimeCapabilityContext(params?.agentProvider, params?.model);

    const overrideWindow = resolveContextWindowOverride(runtime.provider);
    const overrideReserved = resolveReservedOutputOverride(runtime.provider);
    const overrideCharsPerToken = resolveCharsPerTokenOverride(runtime.provider);

    // 显式覆盖优先，避免人工修正被动态值覆盖
    if (typeof overrideWindow === "number") {
        const baseCaps = PROVIDER_CAPABILITIES[runtime.provider] || SAFE_FALLBACK_CAPABILITIES;
        return {
            provider: runtime.provider,
            model: runtime.model,
            source: "env-override",
            cacheHit: false,
            contextWindowTokens: overrideWindow,
            reservedOutputTokens: overrideReserved ?? baseCaps.reservedOutputTokens,
            charsPerToken: overrideCharsPerToken ?? baseCaps.charsPerToken,
        };
    }

    const cacheKey = [
        runtime.provider,
        runtime.baseUrl || "",
        runtime.model || "",
        String(overrideReserved ?? ""),
        String(overrideCharsPerToken ?? ""),
    ].join("|");
    const now = Date.now();
    const cached = runtimeCapabilityCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return { ...cached.value, cacheHit: true };
    }

    let source: RuntimeCapabilitySource = "fallback";
    let selectedCaps: ModelCapabilities | undefined;

    const apiWindow = await resolveContextWindowFromApi(runtime);
    if (typeof apiWindow === "number" && apiWindow > 0) {
        source = "api-models";
        const providerCaps = PROVIDER_CAPABILITIES[runtime.provider] || SAFE_FALLBACK_CAPABILITIES;
        selectedCaps = {
            contextWindowTokens: apiWindow,
            reservedOutputTokens: providerCaps.reservedOutputTokens,
            charsPerToken: providerCaps.charsPerToken,
        };
    }

    if (!selectedCaps && runtime.model) {
        const modelHintCaps = resolveModelHintCapabilities(runtime.model);
        if (modelHintCaps) {
            source = "model-table";
            selectedCaps = modelHintCaps;
        }
    }

    if (!selectedCaps) {
        const providerCaps = PROVIDER_CAPABILITIES[runtime.provider];
        if (providerCaps) {
            source = "provider-table";
            selectedCaps = providerCaps;
        }
    }

    if (!selectedCaps) {
        source = "fallback";
        selectedCaps = SAFE_FALLBACK_CAPABILITIES;
    }

    const resolved: Omit<RuntimeCapabilities, "cacheHit"> = {
        provider: runtime.provider,
        model: runtime.model,
        source,
        contextWindowTokens: selectedCaps.contextWindowTokens,
        reservedOutputTokens: overrideReserved ?? selectedCaps.reservedOutputTokens,
        charsPerToken: overrideCharsPerToken ?? selectedCaps.charsPerToken,
    };

    runtimeCapabilityCache.set(cacheKey, {
        expiresAt: now + CAPABILITY_CACHE_TTL_MS,
        value: resolved,
    });

    return { ...resolved, cacheHit: false };
}

// ============================================
// Runtime Resolver
// ============================================

function normalizeAgentCapabilityProvider(raw?: string): AgentCapabilityProvider {
    const normalized = (raw || "").trim().toLowerCase();
    if (
        !normalized ||
        normalized === "lmstudio" ||
        normalized === "agent-backend" ||
        normalized === "local-openai" ||
        normalized === "llama" ||
        normalized === "claude" ||
        normalized === "none"
    ) {
        return "local-openai";
    }
    if (normalized === "openai") return "openai";
    if (normalized === "minimax") return "minimax";
    if (normalized === "gemini") return "gemini";
    return "local-openai";
}

function normalizeBaseUrl(raw?: string): string | undefined {
    const input = (raw || "").trim();
    if (!input) return undefined;
    let url = input;
    if (!/^https?:\/\//i.test(url)) {
        url = `http://${url}`;
    }
    while (url.endsWith("/")) {
        url = url.slice(0, -1);
    }
    return url;
}

function parsePositiveInt(raw?: string): number | undefined {
    if (!raw) return undefined;
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.floor(parsed);
}

function resolveTimeoutMs(provider: AgentCapabilityProvider): number {
    const providerSpecific = provider === "local-openai"
        ? parsePositiveInt(process.env.LMSTUDIO_TIMEOUT_MS)
        : provider === "openai"
            ? parsePositiveInt(process.env.OPENAI_TIMEOUT_MS)
            : provider === "minimax"
                ? parsePositiveInt(process.env.MINIMAX_TIMEOUT_MS)
                : parsePositiveInt(process.env.GEMINI_TIMEOUT_MS);
    const shared = parsePositiveInt(process.env.AGENT_TIMEOUT_MS);
    return providerSpecific ?? shared ?? 120000;
}

function resolveRuntimeCapabilityContext(rawProvider?: string, modelOverride?: string): RuntimeCapabilityContext {
    const provider = normalizeAgentCapabilityProvider(rawProvider || process.env.AGENT_BACKEND);
    const overrideModel = (modelOverride || "").trim();

    if (provider === "minimax") {
        return {
            provider,
            baseUrl: normalizeBaseUrl(process.env.MINIMAX_BASE_URL || process.env.AGENT_BASE_URL),
            apiKey: (process.env.MINIMAX_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: overrideModel || (process.env.MINIMAX_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: resolveTimeoutMs(provider),
        };
    }

    if (provider === "openai") {
        return {
            provider,
            baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL || process.env.AGENT_BASE_URL || "https://api.openai.com"),
            apiKey: (process.env.OPENAI_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: overrideModel || (process.env.OPENAI_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: resolveTimeoutMs(provider),
        };
    }

    if (provider === "gemini") {
        return {
            provider,
            baseUrl: normalizeBaseUrl(process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"),
            apiKey: (process.env.GEMINI_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: overrideModel || (process.env.GEMINI_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: resolveTimeoutMs(provider),
        };
    }

    return {
        provider: "local-openai",
        baseUrl: normalizeBaseUrl(process.env.LMSTUDIO_BASE_URL || process.env.AGENT_BASE_URL || "http://127.0.0.1:1234"),
        apiKey: (process.env.LMSTUDIO_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
        model: overrideModel || (process.env.LMSTUDIO_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
        timeoutMs: resolveTimeoutMs("local-openai"),
    };
}

function resolveModelHintCapabilities(model: string): ModelCapabilities | undefined {
    const normalized = model.trim();
    if (!normalized) return undefined;
    for (const hint of MODEL_CAPABILITY_HINTS) {
        if (hint.pattern.test(normalized)) {
            return hint.caps;
        }
    }
    return undefined;
}

function resolveContextWindowOverride(provider: AgentCapabilityProvider): number | undefined {
    const globalValue = parsePositiveInt(process.env.AGENT_CONTEXT_WINDOW_TOKENS);
    if (typeof globalValue === "number") return globalValue;

    const providerValue = provider === "local-openai"
        ? parsePositiveInt(process.env.LMSTUDIO_CONTEXT_WINDOW_TOKENS)
        : provider === "openai"
            ? parsePositiveInt(process.env.OPENAI_CONTEXT_WINDOW_TOKENS)
            : provider === "minimax"
                ? parsePositiveInt(process.env.MINIMAX_CONTEXT_WINDOW_TOKENS)
                : parsePositiveInt(process.env.GEMINI_CONTEXT_WINDOW_TOKENS);
    return providerValue;
}

function resolveReservedOutputOverride(provider: AgentCapabilityProvider): number | undefined {
    const globalValue = parsePositiveInt(process.env.AGENT_RESERVED_OUTPUT_TOKENS);
    if (typeof globalValue === "number") return globalValue;

    const providerValue = provider === "local-openai"
        ? parsePositiveInt(process.env.LMSTUDIO_RESERVED_OUTPUT_TOKENS)
        : provider === "openai"
            ? parsePositiveInt(process.env.OPENAI_RESERVED_OUTPUT_TOKENS)
            : provider === "minimax"
                ? parsePositiveInt(process.env.MINIMAX_RESERVED_OUTPUT_TOKENS)
                : parsePositiveInt(process.env.GEMINI_RESERVED_OUTPUT_TOKENS);
    return providerValue;
}

function resolveCharsPerTokenOverride(provider: AgentCapabilityProvider): number | undefined {
    const globalValue = parsePositiveInt(process.env.AGENT_CHARS_PER_TOKEN);
    if (typeof globalValue === "number") return globalValue;

    const providerValue = provider === "local-openai"
        ? parsePositiveInt(process.env.LMSTUDIO_CHARS_PER_TOKEN)
        : provider === "openai"
            ? parsePositiveInt(process.env.OPENAI_CHARS_PER_TOKEN)
            : provider === "minimax"
                ? parsePositiveInt(process.env.MINIMAX_CHARS_PER_TOKEN)
                : parsePositiveInt(process.env.GEMINI_CHARS_PER_TOKEN);
    return providerValue;
}

// ============================================
// API Dynamic Resolver
// ============================================

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return undefined;
}

function toPositiveInt(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === "string") {
        return parsePositiveInt(value);
    }
    return undefined;
}

function readNestedValue(root: Record<string, unknown>, path: string[]): unknown {
    let current: unknown = root;
    for (const key of path) {
        const record = asRecord(current);
        if (!record || !(key in record)) return undefined;
        current = record[key];
    }
    return current;
}

function pickFirstPositiveInt(values: unknown[]): number | undefined {
    for (const value of values) {
        const parsed = toPositiveInt(value);
        if (typeof parsed === "number") return parsed;
    }
    return undefined;
}

function normalizeApiBaseUrl(baseUrl: string, provider: AgentCapabilityProvider): string {
    const normalized = normalizeBaseUrl(baseUrl) || baseUrl;
    if (provider === "local-openai" && normalized.endsWith("/v1")) {
        return normalized.slice(0, -3);
    }
    if ((provider === "openai" || provider === "minimax") && normalized.endsWith("/v1")) {
        return normalized.slice(0, -3);
    }
    return normalized;
}

function rankModelRecord(record: Record<string, unknown>, model?: string): number {
    if (!model) return 1;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const target = model.trim();
    if (!id || !target) return 0;
    if (id === target) return 4;
    if (id.toLowerCase() === target.toLowerCase()) return 3;
    if (id.toLowerCase().includes(target.toLowerCase())) return 2;
    if (target.toLowerCase().includes(id.toLowerCase())) return 1;
    return 0;
}

function extractContextWindowFromModelRecord(record: Record<string, unknown>): number | undefined {
    const loadedInstances = Array.isArray(record.loaded_instances) ? record.loaded_instances : [];
    for (const instance of loadedInstances) {
        const instanceRecord = asRecord(instance);
        if (!instanceRecord) continue;
        const instanceConfig = asRecord(instanceRecord.config);
        const fromLoaded = pickFirstPositiveInt([
            instanceRecord.context_length,
            instanceRecord.max_context_length,
            instanceRecord.context_window,
            instanceConfig?.context_length,
            instanceConfig?.max_context_length,
            instanceConfig?.context_window,
            instanceConfig?.input_token_limit,
            instanceConfig?.max_input_tokens,
        ]);
        if (typeof fromLoaded === "number") return fromLoaded;
    }

    return pickFirstPositiveInt([
        record.context_length,
        record.max_context_length,
        record.context_window,
        record.contextWindow,
        record.input_token_limit,
        record.max_input_tokens,
        record.max_tokens,
        readNestedValue(record, ["limits", "context_window"]),
        readNestedValue(record, ["limits", "max_context_length"]),
        readNestedValue(record, ["capabilities", "context_window"]),
    ]);
}

function extractContextWindowFromModelList(payload: unknown, model?: string): number | undefined {
    const payloadRecord = asRecord(payload);
    if (!payloadRecord) return undefined;
    const data = Array.isArray(payloadRecord.data) ? payloadRecord.data : [];
    if (data.length === 0) return undefined;

    const records = data
        .map(item => asRecord(item))
        .filter((item): item is Record<string, unknown> => !!item);

    records.sort((left, right) => rankModelRecord(right, model) - rankModelRecord(left, model));

    for (const record of records) {
        const contextWindow = extractContextWindowFromModelRecord(record);
        if (typeof contextWindow === "number") return contextWindow;
    }
    return undefined;
}

function extractContextWindowFromGeminiModel(payload: unknown): number | undefined {
    const record = asRecord(payload);
    if (!record) return undefined;
    return pickFirstPositiveInt([
        record.inputTokenLimit,
        record.input_token_limit,
        record.maxInputTokens,
        record.max_input_tokens,
    ]);
}

async function fetchJsonWithTimeout(params: {
    url: string;
    timeoutMs: number;
    headers?: Record<string, string>;
}): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
        const resp = await fetch(params.url, {
            method: "GET",
            headers: params.headers,
            signal: controller.signal,
        });
        if (!resp.ok) return undefined;
        return await resp.json();
    } catch {
        return undefined;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function resolveContextWindowFromApi(runtime: RuntimeCapabilityContext): Promise<number | undefined> {
    if (!runtime.baseUrl) return undefined;
    const baseUrl = normalizeApiBaseUrl(runtime.baseUrl, runtime.provider);

    if (runtime.provider === "gemini") {
        if (!runtime.model || !runtime.apiKey) return undefined;
        const encodedModel = encodeURIComponent(runtime.model);
        const url = `${baseUrl}/v1beta/models/${encodedModel}?key=${runtime.apiKey}`;
        const payload = await fetchJsonWithTimeout({ url, timeoutMs: runtime.timeoutMs });
        return extractContextWindowFromGeminiModel(payload);
    }

    const url = runtime.provider === "local-openai"
        ? `${baseUrl}/api/v1/models`
        : `${baseUrl}/v1/models`;
    const headers = runtime.apiKey
        ? { authorization: `Bearer ${runtime.apiKey}` }
        : undefined;
    const payload = await fetchJsonWithTimeout({
        url,
        timeoutMs: runtime.timeoutMs,
        headers,
    });
    return extractContextWindowFromModelList(payload, runtime.model);
}

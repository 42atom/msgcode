/**
 * msgcode: Agent Backend API 门面（中性命名）
 *
 * 设计约束：
 * - 主实现统一指向 src/agent-backend/*
 * - src/lmstudio.ts 仅作为历史兼容层，不再承载主链实现
 * - 新增后端能力必须先接入 resolveAgentBackendRuntime
 */

import {
    PI_ON_TOOLS,
    resolveAgentBackendRuntime,
    type AgentBackendId,
} from "./agent-backend/index.js";

// ============================================
// 主链导出（来自核心模块）
// ============================================

export {
    type AgentBackendRuntime,
    type AgentChatOptions,
    type AgentToolLoopOptions,
    type AgentRoutedChatOptions,
    type AgentRoutedChatResult,
    type AgentToolLoopResult,
    type AidocsToolDef,
    type ParsedToolCall,
    type ActionJournalEntry,
    executeAgentTurn,
    runAgentChat,
    runAgentToolLoop,
    runAgentRoutedChat,
    sanitizeLmStudioOutput as sanitizeAgentOutput,
} from "./agent-backend/index.js";

// ============================================
// 历史辅助导出（兼容）
// ============================================

export {
    getToolsForLlm as getToolsForAgent,
    parseToolCallBestEffortFromText,
} from "./lmstudio.js";

// ============================================
// 配置读取门面（单源：resolveAgentBackendRuntime）
// ============================================

export interface AgentBackendConfig {
    backendId: AgentBackendId;
    baseUrl: string;
    apiKey?: string;
    model?: string;
    timeoutMs: number;
}

export function resolveAgentBackendConfig(): AgentBackendConfig {
    const runtime = resolveAgentBackendRuntime();
    return {
        backendId: runtime.id,
        baseUrl: runtime.baseUrl,
        apiKey: runtime.apiKey,
        model: runtime.model,
        timeoutMs: runtime.timeoutMs,
    };
}

// 工具集合（中性命名）
export const AGENT_TOOLS = PI_ON_TOOLS;

/**
 * @deprecated 请使用 resolveAgentBackendConfig
 */
export const getAgentBackendConfig = resolveAgentBackendConfig;

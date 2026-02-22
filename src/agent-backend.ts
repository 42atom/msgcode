/**
 * msgcode: Agent Backend API 适配器（中性命名）
 *
 * 目标：
 * - 统一多后端语义（local-openai / openai / minimax）
 * - 消除 lmstudio 专有命名对认知的误导
 * - 配置驱动原则：AGENT_BACKEND + AGENT_MODEL 为主入口
 *
 * 架构：
 * - 本文件为主实现承载
 * - src/lmstudio.ts 降级为兼容 re-export 层（薄封装）
 *
 * 配置驱动原则（冻结）：
 * 1. 后端与模型切换一律走配置，不走代码分支切换
 * 2. 业务主链禁止出现"按具体模型名判断逻辑"
 * 3. 配置解析单源化：AGENT_BACKEND + AGENT_MODEL 为主入口
 * 4. 任何新增后端必须先接入统一配置解析，再接入执行链路
 * 5. 测试口径：切换配置后，分类/执行/总结三段必须使用同一解析结果
 */

// ============================================
// 从 lmstudio.ts 导入核心实现（过渡期桥接）
// ============================================

export {
    // 类型定义
    type LmStudioChatOptions as AgentChatOptions,
    type LmStudioToolLoopOptions as AgentToolLoopOptions,
    type LmStudioRoutedChatOptions as AgentRoutedChatOptions,
    type RoutedChatResult as AgentRoutedChatResult,
    type ToolLoopResult as AgentToolLoopResult,
    type AidocsToolDef,
    type ParsedToolCall,
    type ActionJournalEntry,

    // 接口函数（主实现仍在 lmstudio.ts，本文件只做 re-export）
    runLmStudioChat as runAgentChat,
    runLmStudioToolLoop as runAgentToolLoop,
    runLmStudioRoutedChat as runAgentRoutedChat,

    // 工具相关
    getToolsForLlm as getToolsForAgent,
    parseToolCallBestEffortFromText,
    isLikelyFakeToolExecutionText,

    // 输出清洗
    sanitizeLmStudioOutput as sanitizeAgentOutput,
} from "./lmstudio.js";

// ============================================
// 中性配置解析（单源化）
// ============================================

/**
 * Agent Backend 配置结果
 */
export interface AgentBackendConfig {
    /** 后端 ID（local-openai / openai / minimax） */
    backendId: string;
    /** Base URL */
    baseUrl: string;
    /** API Key（可选） */
    apiKey?: string;
    /** 模型名（可选） */
    model?: string;
    /** 超时毫秒 */
    timeoutMs: number;
}

/**
 * 解析 Agent Backend 配置（单源化入口）
 *
 * 优先级：
 * 1. AGENT_BACKEND 环境变量
 * 2. 回退到 "local-openai"
 */
export function resolveAgentBackendConfig(): AgentBackendConfig {
    const backendId = (process.env.AGENT_BACKEND || "local-openai").trim();

    if (backendId === "minimax") {
        return {
            backendId: "minimax",
            baseUrl: (process.env.MINIMAX_BASE_URL || process.env.AGENT_BASE_URL || "").trim(),
            apiKey: (process.env.MINIMAX_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: (process.env.MINIMAX_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: parseTimeoutMs(process.env.MINIMAX_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, 120_000),
        };
    }

    if (backendId === "openai") {
        return {
            backendId: "openai",
            baseUrl: (process.env.OPENAI_BASE_URL || process.env.AGENT_BASE_URL || "https://api.openai.com").trim(),
            apiKey: (process.env.OPENAI_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
            model: (process.env.OPENAI_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
            timeoutMs: parseTimeoutMs(process.env.OPENAI_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, 120_000),
        };
    }

    // 默认本地后端（lmstudio / local-openai）
    return {
        backendId: "local-openai",
        baseUrl: (process.env.LMSTUDIO_BASE_URL || process.env.AGENT_BASE_URL || "http://127.0.0.1:1234").trim(),
        apiKey: (process.env.LMSTUDIO_API_KEY || process.env.AGENT_API_KEY || "").trim() || undefined,
        model: (process.env.LMSTUDIO_MODEL || process.env.AGENT_MODEL || "").trim() || undefined,
        timeoutMs: parseTimeoutMs(process.env.LMSTUDIO_TIMEOUT_MS || process.env.AGENT_TIMEOUT_MS, 120_000),
    };
}

function parseTimeoutMs(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

// ============================================
// 工具定义类型（中性命名）
// ============================================

/**
 * PI ON 模式下的工具定义（中性命名）
 */
export const AGENT_TOOLS = [
    { name: "bash", description: "执行 bash 命令" },
    { name: "read_file", description: "读取文件内容" },
    { name: "write_file", description: "写入文件" },
    { name: "list_directory", description: "列出目录内容" },
    { name: "search_file", description: "搜索文件" },
    { name: "search_content", description: "搜索内容" },
    { name: "todo_read", description: "读取待办" },
    { name: "todo_write", description: "写入待办" },
] as const;

// ============================================
// 兼容别名（过渡期保留）
// ============================================

/**
 * @deprecated 请使用 resolveAgentBackendConfig
 */
export const getAgentBackendConfig = resolveAgentBackendConfig;

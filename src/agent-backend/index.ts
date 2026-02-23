/**
 * msgcode: Agent Backend 核心模块入口
 *
 * P5.7-R9-T7: 从 lmstudio.ts 拆分出的核心实现
 *
 * 目标结构：
 * - types.ts: 类型定义
 * - config.ts: 后端配置解析
 * - prompt.ts: 提示词构造
 * - tool-loop.ts: 工具循环（Step 3 迁移）
 * - routed-chat.ts: 路由聊天（Step 3 迁移）
 *
 * 使用方式：
 * - import { ... } from "./agent-backend/index.js"
 * - 或直接 import { ... } from "./agent-backend/types.js" 等
 */

// ============================================
// 类型导出
// ============================================

export type {
    // 后端配置类型
    AgentBackendId,
    AgentBackendRuntime,
    // Chat 选项类型
    AgentChatOptions,
    // Tool Loop 类型
    AgentToolLoopOptions,
    AgentToolLoopResult,
    ActionJournalEntry,
    AidocsToolDef,
    ParsedToolCall,
    // Routed Chat 类型
    AgentRoutedChatOptions,
    AgentRoutedChatResult,
} from "./types.js";

export { PI_ON_TOOLS } from "./types.js";

// ============================================
// 配置模块导出
// ============================================

export {
    // 配置常量
    MODEL_ALIAS_SET,
    // 配置函数
    parseBackendTimeoutMs,
    normalizeAgentBackendId,
    resolveAgentBackendRuntime,
    // 兼容函数
    resolveLmStudioBackendRuntime,
} from "./config.js";

// ============================================
// 提示词模块导出
// ============================================

export {
    // 提示词常量
    MCP_ANTI_LOOP_RULES,
    QUICK_ANSWER_CONSTRAINT,
    EXEC_TOOL_PROTOCOL_CONSTRAINT,
    AGENT_BACKEND_DEFAULT_CHAT_MODEL,
    LMSTUDIO_DEFAULT_CHAT_MODEL,
    DEFAULT_SYSTEM_PROMPT_FILE,
    DEFAULT_LMSTUDIO_SYSTEM_PROMPT_FILE,
    // 提示词函数
    normalizeModelOverride,
    resolvePromptFilePath,
    loadSystemPromptFromFile,
    loadLmStudioSystemPromptFromFile,
    resolveBaseSystemPrompt,
    buildDialogSystemPrompt,
    buildExecSystemPrompt,
    buildDialogPromptWithContext,
} from "./prompt.js";

// ============================================
// Tool Loop 模块导出（Step 3 完成后）
// ============================================

export type {
    AgentToolLoopOptions as ToolLoopOptions,
    AgentToolLoopResult as ToolLoopResultType,
} from "./tool-loop.js";

// ============================================
// Routed Chat 模块导出（Step 3 完成后）
// ============================================

export type {
    AgentRoutedChatOptions as RoutedChatOptions,
    AgentRoutedChatResult as RoutedChatResultType,
} from "./routed-chat.js";

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
    normalizeModelOverride,
    resolveAgentBackendRuntime,
    // 兼容函数
    resolveLmStudioBackendRuntime,
} from "./config.js";

// ============================================
// 提示词模块导出
// ============================================

export {
    // 提示词常量
    DEFAULT_PROMPT_FRAGMENT_DIR,
    MCP_ANTI_LOOP_RULES_FILE,
    MCP_ANTI_LOOP_RULES,
    QUICK_ANSWER_CONSTRAINT_FILE,
    QUICK_ANSWER_CONSTRAINT,
    EXEC_TOOL_PROTOCOL_CONSTRAINT_FILE,
    EXEC_TOOL_PROTOCOL_CONSTRAINT,
    AGENT_BACKEND_DEFAULT_CHAT_MODEL,
    LMSTUDIO_DEFAULT_CHAT_MODEL,
    DEFAULT_SYSTEM_PROMPT_FILE,
    // 提示词函数
    resolvePromptFilePath,
    loadSystemPromptFromFile,
    resolveBaseSystemPrompt,
    buildDialogSystemPrompt,
    buildExecSystemPrompt,
    DEFAULT_CONVERSATION_CONTEXT_BUDGET,
    buildConversationContextBlocks,
    buildDialogPromptWithContext,
} from "./prompt.js";

// ============================================
// Chat 模块导出
// ============================================

export type {
    AgentChatOptions as ChatOptions,
} from "./types.js";

export {
    // Chat 主函数
    runAgentChat,
    // 兼容别名
    runLmStudioChat,
} from "./chat.js";

export {
    sanitizeLmStudioOutput,
} from "./chat.js";

// ============================================
// Tool Loop 模块导出
// ============================================

export type {
    AgentToolLoopOptions as ToolLoopOptions,
    AgentToolLoopResult as ToolLoopResultType,
} from "./tool-loop.js";

export {
    // Tool Loop 主函数
    runAgentToolLoop,
    // 兼容别名
    runLmStudioToolLoop,
    // P5.7-R8c: 工具暴露解析器
    getToolsForLlm,
} from "./tool-loop.js";

// ============================================
// Routed Chat 模块导出
// ============================================

export type {
    AgentRoutedChatOptions as RoutedChatOptions,
    AgentRoutedChatResult as RoutedChatResultType,
} from "./types.js";

export {
    executeAgentTurn,
} from "./execute-turn.js";

export {
    // Routed Chat 主函数
    runAgentRoutedChat,
    // 兼容别名
    runLmStudioRoutedChat,
} from "./routed-chat.js";

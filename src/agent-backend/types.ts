/**
 * msgcode: Agent Backend 核心类型定义
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的类型定义
 * 目标：提供中性命名的类型接口，支持多后端扩展
 *
 * 约束：
 * - 所有对外接口使用 Agent* 命名
 * - 内部兼容层保留 LmStudio* 别名
 */

// ============================================
// 后端运行时配置类型
// ============================================

/**
 * 后端 ID（支持的 agent backend）
 */
export type AgentBackendId = "local-openai" | "openai" | "minimax";

/**
 * 后端运行时配置
 */
export interface AgentBackendRuntime {
    id: AgentBackendId;
    baseUrl: string;
    apiKey?: string;
    model?: string;
    timeoutMs: number;
    nativeApiEnabled: boolean;
}

// ============================================
// Chat 选项类型
// ============================================

/**
 * Agent Chat 选项
 */
export interface AgentChatOptions {
    prompt: string;
    system?: string;
    workspace?: string;  // 可选：工作目录（启用 MCP integrations）
    model?: string;      // P5.7-R3e: 可选覆盖模型（用于 responder/executor 分流）
    temperature?: number; // P5.7-R3e: 可选覆盖温度（默认 0.7）
    backendRuntime?: AgentBackendRuntime; // P5.7-R8b: 后端运行时配置
    windowMessages?: Array<{ role: string; content?: string }>; // P5.7-R3l: 对话窗口上下文
    summaryContext?: string; // P5.7-R3l: 历史摘要上下文
    soulContext?: { content: string; source: string; path: string; chars: number }; // P5.7-R3l: SOUL 上下文
}

// ============================================
// Tool Loop 类型
// ============================================

/**
 * PI ON 模式下的工具定义
 */
export const PI_ON_TOOLS = [
    { name: "bash", description: "执行 shell 命令" },
    { name: "read_file", description: "读取文件内容" },
    { name: "write_file", description: "写入文件" },
    { name: "edit_file", description: "编辑文件" },
    { name: "list_directory", description: "列出目录内容" },
    { name: "search_file", description: "搜索文件" },
    { name: "search_content", description: "搜索内容" },
    { name: "todo_read", description: "读取待办" },
    { name: "todo_write", description: "写入待办" },
] as const;

/**
 * 工具定义类型
 */
export type AidocsToolDef = (typeof PI_ON_TOOLS)[number];

/**
 * 解析后的工具调用
 */
export type ParsedToolCall = { name: string; args: Record<string, unknown> };

/**
 * Agent Tool Loop 选项
 */
export interface AgentToolLoopOptions {
    prompt: string;
    system?: string;
    tools?: readonly unknown[];
    allowRoot?: string;
    workspacePath?: string; // P0: 用于读取 workspace 配置以确定工具策略
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
    backendRuntime?: AgentBackendRuntime; // P5.7-R8b: 后端运行时配置
    // P5.6.8-R4b: 短期记忆上下文
    windowMessages?: Array<{ role: string; content?: string }>; // 历史窗口消息
    summaryContext?: string; // summary 格式化后的上下文
    // P5.6.8-R4e: SOUL 上下文（direct only）
    soulContext?: { content: string; source: string; path: string; chars: number };
    // P5.7-R3l-4: 追踪字段
    traceId?: string;  // 用于 journal 追踪
    route?: "tool" | "complex-tool";  // 用于 journal 路由标记
}

// ============================================
// Action Journal 类型（P5.7-R3l-4）
// ============================================

/**
 * Action Journal 条目类型
 *
 * 作为 report 阶段事实源，记录工具执行的完整诊断信息。
 */
export interface ActionJournalEntry {
    // 追踪字段
    traceId: string;           // 请求追踪 ID
    stepId: number;            // 步骤序号（单调递增）

    // 阶段字段
    phase: "plan" | "act" | "report";  // 所属阶段
    timestamp: number;         // 时间戳（Date.now()）

    // 路由字段
    route: "tool" | "complex-tool";  // 所属路由
    model?: string;            // 使用的模型

    // 工具字段
    tool: string;              // 工具名称
    ok: boolean;               // 成功与否
    exitCode?: number | null;  // 退出码（bash 工具）
    errorCode?: string;        // 错误码
    stdoutTail?: string;       // stdout 尾部
    fullOutputPath?: string;   // 完整输出文件路径

    // 诊断字段
    durationMs: number;        // 执行耗时
}

/**
 * Tool Loop 结果
 * P5.7-R3l-4: 必有 actionJournal（无工具时为空数组）
 */
export interface AgentToolLoopResult {
    answer: string;
    toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
    actionJournal: ActionJournalEntry[];  // 必有，无工具时为空数组
}

// ============================================
// Routed Chat 类型
// ============================================

/**
 * Agent Routed Chat 选项
 */
export interface AgentRoutedChatOptions {
    prompt: string;
    system?: string;
    workspacePath?: string;
    agentProvider?: string; // P5.7-R8b: 当前工作区后端
    windowMessages?: Array<{ role: string; content?: string }>;
    summaryContext?: string;
    soulContext?: { content: string; source: string; path: string; chars: number };
    hasToolsAvailable?: boolean;
    temperature?: number; // 可选覆盖温度
}

/**
 * 路由聊天结果
 * P5.7-R3l-4: 必有 actionJournal（结构一致锁）
 */
export interface AgentRoutedChatResult {
    answer: string;
    route: "no-tool" | "tool" | "complex-tool";
    temperature: number;
    toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
    actionJournal: ActionJournalEntry[];  // P5.7-R3l-4: 必有，无工具时为空数组
}

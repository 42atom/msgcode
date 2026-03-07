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
 * 工具定义类型（通用格式）
 *
 * P5.7-R8c: 改为通用格式，不再绑定 PI_ON_TOOLS
 * LLM 工具暴露层从 manifest 单一真相源派生
 */
export type AidocsToolDef = {
    name: string;
    description?: string;
};

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
    // P5.7-R12-T8: 配额策略（冻结口径）
    quotaProfile?: "conservative" | "balanced" | "aggressive"; // 档位（默认 balanced）
    perTurnToolCallLimit?: number; // 单轮工具调用上限（可选覆盖）
    perTurnToolStepLimit?: number; // 单轮工具步骤上限（可选覆盖）
    // P5.7-R12-T10: agent-first 改造 - 允许模型自己决定是否调用工具
    allowNoTool?: boolean; // 如果为 true，模型可以自己决定不调用工具（默认 false，保持向后兼容）
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
    phase: "plan" | "act" | "verify" | "report";  // 所属阶段（P5.7-R12-T3: 新增 verify）
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

// ============================================
// Verify Phase 类型（P5.7-R12-T3）
// ============================================

/**
 * Verify Journal 条目类型
 *
 * 专门用于记录 verify 阶段的验证结果
 */
export interface VerifyJournalEntry extends ActionJournalEntry {
    phase: "verify";  // 强制为 verify 阶段
    verifyMethod: "bash" | "file-read" | "file-exists" | "output-exists";  // 验证方法
    verifiedTool: string;  // 被验证的工具名称
    verifyEvidence?: string;  // 验证证据（JSON 字符串）
}

/**
 * Verify 结果
 *
 * 用于 verify phase 的返回值
 */
export interface VerifyResult {
    /** 是否验证成功 */
    ok: boolean;
    /** 验证证据（JSON 字符串） */
    evidence?: string;
    /** 失败原因（验证失败时） */
    failureReason?: string;
    /** 错误码 */
    errorCode?: string;
}

/**
 * Tool Loop 结果
 * P5.7-R3l-4: 必有 actionJournal（无工具时为空数组）
 * P5.7-R12-T3: 新增 verifyResult，记录 verify 阶段结果
 * P5.7-R12-T8: 新增配额与续跑信息
 */
export interface AgentToolLoopResult {
    answer: string;
    toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
    actionJournal: ActionJournalEntry[];  // 必有，无工具时为空数组
    verifyResult?: VerifyResult;  // P5.7-R12-T3: verify 阶段结果
    // P5.7-R12-T8: 配额与续跑信息
    continuable?: boolean;  // 本轮触顶但可继续（true=可继续，false=终态失败）
    quotaProfile?: "conservative" | "balanced" | "aggressive";  // 当前档位
    perTurnToolCallLimit?: number;  // 单轮工具调用上限
    perTurnToolStepLimit?: number;  // 单轮工具步骤上限
    remainingToolCalls?: number;  // 剩余工具调用数
    remainingSteps?: number;  // 剩余步骤数
    continuationReason?: string;  // 续跑原因（触顶时填写）
    // P5.7-R12-T10: agent-first 改造 - 决策来源
    decisionSource?: "model" | "router" | "degrade";  // 决策来源
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
    // P5.7-R12-T10: agent-first 改造 - 显式强制 complex-tool 模式
    forceComplexTool?: boolean; // 如果为 true，强制使用 plan/act/report 流程
}

/**
 * 路由聊天结果
 * P5.7-R3l-4: 必有 actionJournal（结构一致锁）
 * P5.7-R12-T3: 新增 verifyResult，记录 verify 阶段结果
 * P5.7-R12-T8: 新增配额与续跑信息
 */
export interface AgentRoutedChatResult {
    answer: string;
    route: "no-tool" | "tool" | "complex-tool";  // 最终执行结果语义
    decisionSource?: "model" | "router" | "degrade";  // P5.7-R12-T10: 决策来源（agent-first 改造）
    temperature: number;
    toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
    actionJournal: ActionJournalEntry[];  // P5.7-R3l-4: 必有，无工具时为空数组
    verifyResult?: VerifyResult;  // P5.7-R12-T3: verify 阶段结果
    // P5.7-R12-T8: 配额与续跑信息（从 tool-loop 透传）
    continuable?: boolean;
    quotaProfile?: "conservative" | "balanced" | "aggressive";
    perTurnToolCallLimit?: number;
    perTurnToolStepLimit?: number;
    remainingToolCalls?: number;
    remainingSteps?: number;
    continuationReason?: string;
}

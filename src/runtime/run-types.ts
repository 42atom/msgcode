/**
 * msgcode: Run Core 类型定义（Phase 1/2）
 *
 * 目标：
 * - 让每次执行都有统一 run 元数据
 * - 先只收口最小生命周期字段
 * - Phase 1 先收口 runId，Phase 2 再补最小 sessionKey
 * - 不引入外部 event stream / 控制面
 */

/**
 * Run 来源
 */
export type RunSource = "message" | "task" | "heartbeat" | "schedule";

/**
 * Run 形态
 *
 * - light: 普通聊天、一次性 schedule 等轻量执行
 * - task: 显式长期任务及其续跑
 */
export type RunKind = "light" | "task";

/**
 * Run 生命周期状态
 */
export type RunStatus =
    | "accepted"
    | "running"
    | "blocked"
    | "completed"
    | "failed"
    | "cancelled";

/**
 * Run 终态
 */
export type RunTerminalStatus = Exclude<RunStatus, "accepted" | "running">;

/**
 * Run 持久化记录（JSONL 每行）
 */
export interface RunRecord {
    /** 唯一 run ID */
    runId: string;
    /** 归属的稳定 sessionKey */
    sessionKey: string;
    /** 触发来源 */
    source: RunSource;
    /** 轻量执行 / 长期任务 */
    kind: RunKind;
    /** 当前记录对应的生命周期状态 */
    status: RunStatus;
    /** run 开始时间 */
    startedAt: number;
    /** run 结束时间（仅终态有） */
    endedAt?: number;
    /** run 持续时长（毫秒，仅终态有） */
    durationMs?: number;
    /** 原始 chatId（保留用于排障与回溯） */
    chatId?: string;
    /** 关联工作区 */
    workspacePath?: string;
    /** 关联 taskId（若有） */
    taskId?: string;
    /** 关联触发器 ID（如 tickId / jobId） */
    triggerId?: string;
    /** 错误信息（失败时） */
    error?: string;
    /** 写入该条记录的时间 */
    loggedAt: number;
}

/**
 * 创建 run 时的最小输入
 */
export interface CreateRunInput {
    source: RunSource;
    kind?: RunKind;
    chatId?: string;
    workspacePath?: string;
    taskId?: string;
    triggerId?: string;
}

/**
 * run 结束时允许补充的字段
 */
export interface FinishRunInput {
    status: RunTerminalStatus;
    chatId?: string;
    workspacePath?: string;
    taskId?: string;
    triggerId?: string;
    error?: string;
}

/**
 * msgcode: 任务状态机类型定义（P5.7-R12 Agent Relentless Task Closure）
 *
 * 职责：
 * - 定义任务状态枚举
 * - 定义任务记录接口
 * - 定义事件队列类型
 *
 * 约束：
 * - 单 chat 单活跃任务（禁止并发）
 * - 状态机：pending -> running -> blocked/completed/failed/cancelled
 */

import { randomUUID } from "node:crypto";

// ============================================
// 任务状态枚举
// ============================================

/**
 * 任务状态
 *
 * 状态机流转：
 * - pending: 任务已创建，等待执行
 * - running: 任务正在执行中
 * - blocked: 任务被阻塞，需要人工接力
 * - completed: 任务已完成（有 verify 证据）
 * - failed: 任务执行失败（不可恢复错误）
 * - cancelled: 任务被用户取消
 */
export type TaskStatus = "pending" | "running" | "blocked" | "completed" | "failed" | "cancelled";

/**
 * 合法状态转换
 *
 * pending   -> running / cancelled
 * running   -> pending (retry) / blocked / completed / failed / cancelled
 * blocked   -> running (resume) / cancelled
 * completed -> (终态)
 * failed    -> (终态)
 * cancelled -> (终态)
 */
export const LEGAL_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    pending: ["running", "cancelled"],
    running: ["pending", "blocked", "completed", "failed", "cancelled"],
    blocked: ["running", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
};

/**
 * 检查状态转换是否合法
 */
export function isLegalTransition(from: TaskStatus, to: TaskStatus): boolean {
    return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================
// 任务记录
// ============================================

/**
 * 任务记录
 *
 * 关键字段：
 * - taskId: 唯一标识
 * - chatId: 所属会话
 * - workspacePath: 工作区路径
 * - goal: 任务目标描述
 * - status: 当前状态
 * - attemptCount: 重试次数
 * - maxAttempts: 最大重试次数（P5.7-R12-T8: 默认 5）
 * - sameToolSameArgsRetryCount: 同工具同参数重试次数（P5.7-R12-T8: 默认限制 2）
 * - lastToolCall: 上次工具调用记录（用于检测同工具同参数）
 * - sameErrorCodeStreakCount: 同错误码连续失败次数（P5.7-R12-T8: 默认限制 3）
 * - lastErrorCode: 上次错误码
 * - blockedReason: 阻塞原因
 * - nextWakeAtMs: 下次唤醒时间戳
 * - verifyEvidence: verify 证据（completed 必须有）
 * - createdAt/updatedAt: 时间戳
 */
export interface TaskRecord {
    /** 唯一任务 ID */
    taskId: string;
    /** 所属 chat ID */
    chatId: string;
    /** 工作区路径 */
    workspacePath: string;
    /** 任务目标描述 */
    goal: string;
    /** 当前状态 */
    status: TaskStatus;
    /** 重试次数 */
    attemptCount: number;
    /** 最大重试次数 */
    maxAttempts: number;
    /** P5.7-R12-T8: 同工具同参数重试次数 */
    sameToolSameArgsRetryCount?: number;
    /** P5.7-R12-T8: 上次工具调用记录（用于检测同工具同参数） */
    lastToolCall?: {
        name: string;
        args: Record<string, unknown>;
    };
    /** P5.7-R12-T8: 同错误码连续失败次数 */
    sameErrorCodeStreakCount?: number;
    /** 上次错误码 */
    lastErrorCode?: string;
    /** 上次错误消息 */
    lastErrorMessage?: string;
    /** 阻塞原因（blocked 状态时填写） */
    blockedReason?: string;
    /** 阻塞时的恢复上下文（JSON 字符串） */
    recoveryContext?: string;
    /** 下次唤醒时间戳（毫秒） */
    nextWakeAtMs?: number;
    /** verify 证据（completed 状态时必须有） */
    verifyEvidence?: string;
    /** 创建时间戳 */
    createdAt: number;
    /** 更新时间戳 */
    updatedAt: number;
}

/**
 * 创建新任务记录的工厂函数
 *
 * P5.7-R12-T8: 默认 maxAttempts=5
 */
export function createTaskRecord(params: {
    chatId: string;
    workspacePath: string;
    goal: string;
    maxAttempts?: number;
}): TaskRecord {
    const now = Date.now();
    return {
        taskId: randomUUID(),
        chatId: params.chatId,
        workspacePath: params.workspacePath,
        goal: params.goal,
        status: "pending",
        attemptCount: 0,
        maxAttempts: params.maxAttempts ?? 5, // P5.7-R12-T8: 默认 5
        sameToolSameArgsRetryCount: 0, // P5.7-R12-T8
        sameErrorCodeStreakCount: 0, // P5.7-R12-T8
        createdAt: now,
        updatedAt: now,
    };
}

// ============================================
// 事件队列类型
// ============================================

/**
 * 事件队列状态
 *
 * 对齐 steering-queue 语义：
 * - queued: 事件等待处理
 * - processing: 事件正在处理
 * - done: 事件处理完成
 * - failed: 事件处理失败
 */
export type EventQueueStatus = "queued" | "processing" | "done" | "failed";

/**
 * 任务事件
 *
 * 用于在事件队列中追踪任务执行进度
 */
export interface TaskEvent {
    /** 事件 ID */
    eventId: string;
    /** 关联任务 ID */
    taskId: string;
    /** 关联 chat ID */
    chatId: string;
    /** 事件类型 */
    type: "task_start" | "tool_call" | "tool_result" | "verify" | "task_end";
    /** 事件状态 */
    status: EventQueueStatus;
    /** 事件内容（JSON 字符串） */
    payload?: string;
    /** 创建时间戳 */
    createdAt: number;
    /** 完成时间戳 */
    completedAt?: number;
}

/**
 * 创建新任务事件的工厂函数
 */
export function createTaskEvent(params: {
    taskId: string;
    chatId: string;
    type: TaskEvent["type"];
    payload?: object;
}): TaskEvent {
    return {
        eventId: randomUUID(),
        taskId: params.taskId,
        chatId: params.chatId,
        type: params.type,
        status: "queued",
        payload: params.payload ? JSON.stringify(params.payload) : undefined,
        createdAt: Date.now(),
    };
}

// ============================================
// Supervisor 配置
// ============================================

/**
 * Supervisor 配置
 */
export interface TaskSupervisorConfig {
    /** 心跳间隔（毫秒），默认 60000 */
    heartbeatIntervalMs?: number;
    /** 最大并发任务数（默认 1，单 chat 单活跃） */
    maxConcurrentTasks?: number;
    /** P5.7-R12-T8: 默认最大重试次数（默认 5） */
    defaultMaxAttempts?: number;
    /** 任务目录路径 */
    taskDir: string;
    /** 事件队列目录路径 */
    eventQueueDir: string;
    /** 外部注入的任务执行器；supervisor 只负责调度，不负责 agent 实现细节 */
    executeTaskTurn?: TaskTurnExecutor;
}

/**
 * 默认配置
 *
 * P5.7-R12-T8: defaultMaxAttempts 默认 5
 */
export const DEFAULT_SUPERVISOR_CONFIG: Partial<TaskSupervisorConfig> = {
    heartbeatIntervalMs: 60_000,
    maxConcurrentTasks: 1,
    defaultMaxAttempts: 5, // P5.7-R12-T8
};

// ============================================
// Task 执行器注入类型
// ============================================

export interface TaskTurnVerifyResult {
    ok: boolean;
    evidence?: string;
    failureReason?: string;
    errorCode?: string;
}

export interface TaskTurnResult {
    answer: string;
    toolCall?: {
        name: string;
        args: Record<string, unknown>;
        result?: unknown;
    };
    actionJournal: Array<{
        ok: boolean;
        errorCode?: string;
    }>;
    verifyResult?: TaskTurnVerifyResult;
    continuable?: boolean;
    quotaProfile?: "conservative" | "balanced" | "aggressive";
    perTurnToolCallLimit?: number;
    perTurnToolStepLimit?: number;
    remainingToolCalls?: number;
    remainingSteps?: number;
    continuationReason?: string;
}

export type TaskTurnExecutor = (task: TaskRecord) => Promise<TaskTurnResult>;

// ============================================
// 诊断输出类型
// ============================================

/**
 * 任务诊断信息
 *
 * 用于 /task status 命令输出
 *
 * P5.7-R12-T8: 添加总预算相关字段
 */
export interface TaskDiagnostics {
    taskId: string;
    chatId: string;
    status: TaskStatus;
    goal: string;
    attemptCount: number;
    maxAttempts: number;
    /** P5.7-R12-T8: 同工具同参数重试次数 */
    sameToolSameArgsRetryCount?: number;
    /** P5.7-R12-T8: 同错误码连续失败次数 */
    sameErrorCodeStreakCount?: number;
    nextWakeAtMs?: number;
    lastErrorCode?: string;
    lastErrorMessage?: string;
    blockedReason?: string;
    verifyEvidence?: string;
    createdAt: number;
    updatedAt: number;
}

/**
 * 将 TaskRecord 转换为诊断信息
 */
export function toDiagnostics(record: TaskRecord): TaskDiagnostics {
    return {
        taskId: record.taskId,
        chatId: record.chatId,
        status: record.status,
        goal: record.goal,
        attemptCount: record.attemptCount,
        maxAttempts: record.maxAttempts,
        sameToolSameArgsRetryCount: record.sameToolSameArgsRetryCount,
        sameErrorCodeStreakCount: record.sameErrorCodeStreakCount,
        nextWakeAtMs: record.nextWakeAtMs,
        lastErrorCode: record.lastErrorCode,
        lastErrorMessage: record.lastErrorMessage,
        blockedReason: record.blockedReason,
        verifyEvidence: record.verifyEvidence,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

// ============================================
// 任务执行结果类型（P5.7-R12）
// ============================================

/**
 * 任务执行结果
 *
 * 用于 supervisor 与执行器之间的结果传递
 */
export interface TaskExecutionResult {
    /** 是否成功 */
    ok: boolean;
    /** 新状态 */
    status: TaskStatus;
    /** verify 证据（如果有） */
    verifyEvidence?: string;
    /** 错误码（失败时） */
    errorCode?: string;
    /** 错误消息（失败时） */
    errorMessage?: string;
    /** 阻塞原因（blocked 时） */
    blockedReason?: string;
    /** 恢复上下文（blocked 时） */
    recoveryContext?: string;
}

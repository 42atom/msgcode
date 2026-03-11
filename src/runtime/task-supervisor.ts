/**
 * msgcode: 任务监督器（P5.7-R12 Agent Relentless Task Closure）
 *
 * 职责：
 * - 用户发起任务时创建 task（仅显式 /task run <goal>）
 * - heartbeat tick 扫描并继续可执行任务
 * - 单 chat 只允许一个活跃任务
 * - 任务执行后根据结果推进状态
 * - 需人工接力时转 blocked
 *
 * 约束：
 * - heartbeat 只续跑显式创建的 task，不扫描普通消息
 * - supervisor 与 steering 共用持久化 backend
 * - 单 chat 单活跃任务（重复创建必须拒绝）
 */

import type {
    TaskRecord,
    TaskStatus,
    TaskCheckpoint,
    TaskDiagnostics,
    TaskSupervisorConfig,
    TaskExecutionResult,
    TaskTurnExecutor,
    TaskTurnResult,
} from "./task-types.js";
import { createTaskRecord, toDiagnostics } from "./task-types.js";
import { TaskStore } from "./task-store.js";
import { logger } from "../logger/index.js";
import type { TickContext } from "./heartbeat.js";
import { beginRun, toRunErrorMessage } from "./run-store.js";
import { emitRunEvent } from "./run-events.js";
import type { RunSource } from "./run-types.js";

// ============================================
// Task Supervisor 类
// ============================================

export class TaskSupervisor {
    private taskStore: TaskStore;
    private config: Required<Omit<TaskSupervisorConfig, "executeTaskTurn">>;
    private executeTaskTurn: TaskTurnExecutor;
    private isRunning = false;

    // P5.7-R12-T8: 冻结的总预算限制
    private readonly SAME_TOOL_SAME_ARGS_RETRY_LIMIT = 2;
    private readonly SAME_ERROR_CODE_STREAK_LIMIT = 3;

    constructor(config: TaskSupervisorConfig) {
        this.config = {
            heartbeatIntervalMs: config.heartbeatIntervalMs ?? 60_000,
            maxConcurrentTasks: config.maxConcurrentTasks ?? 1,
            defaultMaxAttempts: config.defaultMaxAttempts ?? 5, // P5.7-R12-T8: 默认 5
            taskDir: config.taskDir,
            eventQueueDir: config.eventQueueDir,
        };

        this.taskStore = new TaskStore({
            taskDir: this.config.taskDir,
        });
        this.executeTaskTurn = config.executeTaskTurn ?? (async () => {
            throw new Error("TaskSupervisor 未配置 executeTaskTurn");
        });
    }

    /**
     * 启动 supervisor
     *
     * 恢复活跃任务
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn("TaskSupervisor 已在运行", {
                module: "task-supervisor",
            });
            return;
        }

        this.isRunning = true;

        // 恢复活跃任务
        const recoveredTasks = await this.taskStore.recoverActiveTasks();
        logger.info("任务监督器已启动", {
            module: "task-supervisor",
            recoveredCount: recoveredTasks.length,
        });
    }

    /**
     * 停止 supervisor
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        logger.info("任务监督器已停止", {
            module: "task-supervisor",
        });
    }

    /**
     * 对外暴露 heartbeat 入口，供 commands 主流程统一接线。
     */
    async handleHeartbeatTick(ctx: TickContext): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        await this.onHeartbeatTick(ctx);
    }

    /**
     * 创建任务
     *
     * 约束：单 chat 单活跃任务
     * - 若该 chat 已有非终态任务，拒绝创建
     * - 终态任务（completed/failed/cancelled）可覆盖
     *
     * @param chatId 会话 ID
     * @param workspacePath 工作区路径
     * @param goal 任务目标描述
     * @returns 创建结果
     */
    async createTask(
        chatId: string,
        workspacePath: string,
        goal: string
    ): Promise<{ ok: true; task: TaskDiagnostics } | { ok: false; error: string }> {
        const task = createTaskRecord({
            chatId,
            workspacePath,
            goal,
            maxAttempts: this.config.defaultMaxAttempts,
        });

        const result = await this.taskStore.createTask(task);

        if (!result.ok) {
            return { ok: false, error: result.error };
        }

        logger.info("任务已创建", {
            module: "task-supervisor",
            taskId: task.taskId,
            chatId,
            goal,
        });

        return { ok: true, task: toDiagnostics(result.task) };
    }

    /**
     * 取消任务
     *
     * @param taskId 任务 ID
     * @returns 取消结果
     */
    async cancelTask(taskId: string): Promise<{ ok: true; task: TaskDiagnostics } | { ok: false; error: string }> {
        const result = await this.taskStore.updateTask(taskId, { status: "cancelled" });

        if (!result.ok) {
            return { ok: false, error: result.error };
        }

        logger.info("任务已取消", {
            module: "task-supervisor",
            taskId,
        });

        return { ok: true, task: toDiagnostics(result.task) };
    }

    /**
     * 恢复 blocked 任务
     *
     * @param taskId 任务 ID
     * @returns 恢复结果
     */
    async resumeTask(taskId: string): Promise<{ ok: true; task: TaskDiagnostics } | { ok: false; error: string }> {
        const existing = await this.taskStore.getTaskById(taskId);

        if (!existing) {
            return { ok: false, error: `任务不存在: ${taskId}` };
        }

        if (existing.status !== "blocked") {
            return { ok: false, error: `只能恢复 blocked 状态的任务，当前状态: ${existing.status}` };
        }

        const result = await this.taskStore.updateTask(taskId, {
            status: "running",
            blockedReason: undefined,
            recoveryContext: undefined,
            checkpoint: existing.checkpoint
                ? {
                    ...existing.checkpoint,
                    currentPhase: "running",
                    nextAction: "继续执行当前任务",
                    updatedAt: Date.now(),
                }
                : {
                    currentPhase: "running",
                    summary: existing.goal,
                    nextAction: "继续执行当前任务",
                    updatedAt: Date.now(),
                },
        });

        if (!result.ok) {
            return { ok: false, error: result.error };
        }

        logger.info("任务已恢复", {
            module: "task-supervisor",
            taskId,
        });

        return { ok: true, task: toDiagnostics(result.task) };
    }

    /**
     * 获取任务状态
     *
     * @param taskId 任务 ID
     * @returns 任务诊断信息
     */
    async getTaskStatus(taskId: string): Promise<TaskDiagnostics | null> {
        const task = await this.taskStore.getTaskById(taskId);
        return task ? toDiagnostics(task) : null;
    }

    /**
     * 获取指定 chat 的活跃任务
     *
     * @param chatId 会话 ID
     * @returns 任务诊断信息
     */
    async getActiveTask(chatId: string): Promise<TaskDiagnostics | null> {
        const task = await this.taskStore.getActiveTask(chatId);
        return task ? toDiagnostics(task) : null;
    }

    /**
     * 更新任务执行结果
     *
     * 由任务执行器（tool-loop）调用，根据执行结果推进状态
     *
     * @param taskId 任务 ID
     * @param result 执行结果
     * @returns 更新结果
     */
    async updateTaskResult(
        taskId: string,
        result: TaskExecutionResult
    ): Promise<{ ok: true; task: TaskDiagnostics } | { ok: false; error: string }> {
        const existing = await this.taskStore.getTaskById(taskId);

        if (!existing) {
            return { ok: false, error: `任务不存在: ${taskId}` };
        }

        // 根据执行结果确定新状态
        let newStatus: TaskStatus = result.status;
        let updates: Partial<TaskRecord> = {};

        switch (result.status) {
            case "completed":
                // completed 必须带 verify 证据；否则继续保持 running，等待下一轮补证据
                if (result.verifyEvidence) {
                    updates.verifyEvidence = result.verifyEvidence;
                } else {
                    newStatus = "running";
                }
                break;
            case "blocked":
                updates.blockedReason = result.blockedReason;
                updates.recoveryContext = result.recoveryContext;
                break;
            case "failed":
                updates.lastErrorCode = result.errorCode;
                updates.lastErrorMessage = result.errorMessage;
                break;
            case "pending":
                updates.lastErrorCode = result.errorCode;
                updates.lastErrorMessage = result.errorMessage;
                if (!result.ok) {
                    updates.attemptCount = existing.attemptCount + 1;
                    updates.nextWakeAtMs = Date.now() + this.config.heartbeatIntervalMs;
                }
                break;
            case "running":
            case "cancelled":
                break;
        }

        const checkpointSource = result.checkpoint ?? existing.checkpoint;
        if (checkpointSource) {
            const alignedCheckpoint: TaskCheckpoint = {
                ...checkpointSource,
                currentPhase: newStatus,
                updatedAt: Date.now(),
            };

            if (result.status === "completed" && newStatus === "running" && !result.verifyEvidence) {
                alignedCheckpoint.nextAction = "补充验证证据后再结束任务";
            }

            updates.checkpoint = alignedCheckpoint;
        }

        // 应用状态转换
        const updateResult = await this.taskStore.updateTask(taskId, {
            ...updates,
            status: newStatus,
        });

        if (!updateResult.ok) {
            return { ok: false, error: updateResult.error };
        }

        logger.info("任务状态已更新", {
            module: "task-supervisor",
            taskId,
            oldStatus: existing.status,
            newStatus,
        });

        return { ok: true, task: toDiagnostics(updateResult.task) };
    }

    /**
     * Heartbeat tick 回调
     *
     * 扫描并继续可执行任务
     */
    private async onHeartbeatTick(ctx: TickContext): Promise<void> {
        try {
            logger.debug("Heartbeat tick 扫描任务", {
                module: "task-supervisor",
                tickId: ctx.tickId,
            });

            // 获取所有活跃任务
            const activeTasks = await this.taskStore.getAllActiveTasks();

            // 过滤可执行任务（pending 且到达唤醒时间）
            const now = Date.now();
            const runnableTasks = activeTasks.filter((task) => {
                const isActiveRunnable = task.status === "pending" || task.status === "running";
                return isActiveRunnable && (!task.nextWakeAtMs || task.nextWakeAtMs <= now);
            });

            if (runnableTasks.length === 0) {
                logger.debug("无可执行任务", {
                    module: "task-supervisor",
                    tickId: ctx.tickId,
                });
                return;
            }

            logger.info("发现可执行任务", {
                module: "task-supervisor",
                tickId: ctx.tickId,
                count: runnableTasks.length,
            });

            // 执行任务（当前 MVP 只支持单任务，取第一个）
            for (const task of runnableTasks) {
                await this.executeTask(task, {
                    source: "heartbeat",
                    triggerId: ctx.tickId,
                });
            }
        } catch (error) {
            logger.error("Heartbeat tick 执行失败", {
                module: "task-supervisor",
                tickId: ctx.tickId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * 执行单个任务
     *
     * P5.7-R12: 接入真实 agent 主链
     * P5.7-R12-T8: 处理 tool-loop 返回的 continuable 信号和总预算检查
     *
     * @param task 任务记录
     */
    private async executeTask(
        task: TaskRecord,
        runContext: { source: Extract<RunSource, "task" | "heartbeat">; triggerId?: string }
    ): Promise<void> {
        const run = beginRun({
            source: runContext.source,
            kind: "task",
            chatId: task.chatId,
            workspacePath: task.workspacePath,
            taskId: task.taskId,
            triggerId: runContext.triggerId,
        });

        logger.info("开始执行任务", {
            module: "task-supervisor",
            runId: run.runId,
            source: runContext.source,
            taskId: task.taskId,
            goal: task.goal,
            attemptCount: task.attemptCount,
            maxAttempts: task.maxAttempts,
        });

        // 更新状态为 running
        const updateResult = await this.taskStore.updateTask(task.taskId, {
            status: "running",
        });

        if (!updateResult.ok) {
            logger.error("更新任务状态失败", {
                module: "task-supervisor",
                runId: run.runId,
                source: runContext.source,
                taskId: task.taskId,
                error: updateResult.error,
            });
            run.finish({
                status: "failed",
                error: updateResult.error,
            });
            return;
        }

        try {
            const result = await this.executeTaskTurn(task, {
                runId: run.runId,
                sessionKey: run.sessionKey,
                source: runContext.source,
            });

            // P5.7-R12-T8: 检查是否可续跑
            if (result.continuable) {
                logger.info("任务本轮触顶，检查总预算", {
                    module: "task-supervisor",
                    taskId: task.taskId,
                    continuable: true,
                    continuationReason: result.continuationReason,
                    quotaProfile: result.quotaProfile,
                });

                // P5.7-R12-T8: 检查总预算是否耗尽
                const budgetCheckResult = this.checkBudgetExhausted(task, result, result.actionJournal);

                if (budgetCheckResult.exhausted) {
                    // 总预算耗尽，进入终态失败
                    await this.updateTaskResult(task.taskId, {
                        ok: false,
                        status: "failed",
                        errorCode: "BUDGET_EXHAUSTED",
                        errorMessage: budgetCheckResult.reason,
                        checkpoint: {
                            currentPhase: "failed",
                            summary: task.checkpoint?.summary || task.goal,
                            nextAction: "检查预算耗尽原因后决定是否重新发起任务",
                            lastToolName: result.toolCall?.name || task.lastToolCall?.name,
                            lastErrorCode: "BUDGET_EXHAUSTED",
                            updatedAt: Date.now(),
                        },
                    });

                    logger.info("任务总预算耗尽，进入失败状态", {
                        module: "task-supervisor",
                        runId: run.runId,
                        source: runContext.source,
                        taskId: task.taskId,
                        reason: budgetCheckResult.reason,
                    });
                    run.finish({
                        status: "failed",
                        error: budgetCheckResult.reason,
                    });
                    return;
                }

                // 总预算未耗尽，继续下一轮
                const updates: Partial<TaskRecord> = {
                    status: "pending",
                    attemptCount: task.attemptCount + 1,
                    nextWakeAtMs: Date.now() + this.config.heartbeatIntervalMs,
                    checkpoint: this.buildCheckpointFromTurn(task, result, "pending"),
                };

                // P5.7-R12-T8: 检测同工具同参数
                if (result.toolCall) {
                    const { name, args } = result.toolCall;
                    if (task.lastToolCall?.name === name && JSON.stringify(task.lastToolCall.args) === JSON.stringify(args)) {
                        updates.sameToolSameArgsRetryCount = (task.sameToolSameArgsRetryCount ?? 0) + 1;
                    } else {
                        updates.sameToolSameArgsRetryCount = 0;
                        updates.lastToolCall = { name, args };
                    }
                }

                // P5.7-R12-T8: 更新错误码连续失败计数
                // 从 actionJournal 中提取最后一个错误码
                if (result.actionJournal.length > 0) {
                    for (let i = result.actionJournal.length - 1; i >= 0; i--) {
                        const entry = result.actionJournal[i];
                        if (entry.ok === false && entry.errorCode) {
                            const lastErrorCode = entry.errorCode;
                            if (task.lastErrorCode === lastErrorCode) {
                                // 同一错误码，累加计数
                                updates.sameErrorCodeStreakCount = (task.sameErrorCodeStreakCount ?? 0) + 1;
                            } else {
                                // 不同错误码，重置计数
                                updates.sameErrorCodeStreakCount = 1;
                                updates.lastErrorCode = lastErrorCode;
                            }
                            break;
                        }
                    }
                }

                await this.taskStore.updateTask(task.taskId, updates);

                logger.info("任务续跑准备下一轮", {
                    module: "task-supervisor",
                    runId: run.runId,
                    source: runContext.source,
                    taskId: task.taskId,
                    newAttemptCount: task.attemptCount + 1,
                });
                run.finish({
                    status: "completed",
                });
                return;
            }

            // P5.7-R12-T8: 不可续跑，正常完成
            const executionResult: TaskExecutionResult = {
                ok: true,
                status: "completed",
                verifyEvidence: result.verifyResult?.evidence,
                checkpoint: this.buildCheckpointFromTurn(task, result, "completed"),
            };

            // 如果有 verify 结果且失败，标记为 blocked
            if (result.verifyResult && !result.verifyResult.ok) {
                executionResult.ok = false;
                executionResult.status = "blocked";
                executionResult.blockedReason = result.verifyResult.failureReason;
                executionResult.errorCode = result.verifyResult.errorCode;
                executionResult.checkpoint = this.buildCheckpointFromTurn(task, result, "blocked");
            }

            // P5.7-R12-T8: 更新错误码计数（不可续跑分支）
            const errorUpdates: Partial<TaskRecord> = {};
            if (result.actionJournal.length > 0) {
                for (let i = result.actionJournal.length - 1; i >= 0; i--) {
                    const entry = result.actionJournal[i];
                    if (entry.ok === false && entry.errorCode) {
                        const lastErrorCode = entry.errorCode;
                        if (task.lastErrorCode === lastErrorCode) {
                            // 同一错误码，累加计数
                            errorUpdates.sameErrorCodeStreakCount = (task.sameErrorCodeStreakCount ?? 0) + 1;
                        } else {
                            // 不同错误码，重置计数
                            errorUpdates.sameErrorCodeStreakCount = 1;
                            errorUpdates.lastErrorCode = lastErrorCode;
                        }
                        break;
                    }
                }
            }

            // 如果有错误码更新，应用到任务
            if (Object.keys(errorUpdates).length > 0) {
                await this.taskStore.updateTask(task.taskId, errorUpdates);
            }

            await this.updateTaskResult(task.taskId, executionResult);

            if (
                executionResult.status === "blocked" &&
                (!result.verifyResult || result.verifyResult.ok)
            ) {
                emitRunEvent({
                    runId: run.runId,
                    sessionKey: run.sessionKey,
                    source: runContext.source,
                    type: "run:block",
                    taskId: task.taskId,
                    message: executionResult.blockedReason || "任务已进入 blocked 状态",
                    errorCode: executionResult.errorCode,
                });
            }

            logger.info("任务执行完成", {
                module: "task-supervisor",
                runId: run.runId,
                source: runContext.source,
                taskId: task.taskId,
                status: executionResult.status,
            });
            run.finish({
                status: executionResult.status === "blocked" ? "blocked" : "completed",
                error: executionResult.errorMessage || executionResult.blockedReason,
            });
        } catch (error) {
            const errorMessage = toRunErrorMessage(error);
            logger.error("任务执行失败", {
                module: "task-supervisor",
                runId: run.runId,
                source: runContext.source,
                taskId: task.taskId,
                error: errorMessage,
            });

            // P5.7-R12-T8: 更新错误码计数（异常分支）
            // 在异常分支中，我们使用 "EXECUTION_FAILED" 作为通用错误码
            const errorUpdates: Partial<TaskRecord> = {};
            const executionFailedErrorCode = "EXECUTION_FAILED";

            if (task.lastErrorCode === executionFailedErrorCode) {
                // 同一错误码，累加计数
                errorUpdates.sameErrorCodeStreakCount = (task.sameErrorCodeStreakCount ?? 0) + 1;
            } else {
                // 不同错误码，重置计数
                errorUpdates.sameErrorCodeStreakCount = 1;
                errorUpdates.lastErrorCode = executionFailedErrorCode;
            }

            // 应用错误码更新到任务
            await this.taskStore.updateTask(task.taskId, errorUpdates);

            // 标记任务为失败
            await this.updateTaskResult(task.taskId, {
                ok: false,
                status: "failed",
                errorCode: executionFailedErrorCode,
                errorMessage: errorMessage,
                checkpoint: this.buildFailureCheckpoint(task, executionFailedErrorCode, error),
            });
            run.finish({
                status: "failed",
                error: errorMessage,
            });
        }
    }

    private buildCheckpointFromTurn(
        task: TaskRecord,
        result: TaskTurnResult,
        currentPhase: "pending" | "blocked" | "completed"
    ): TaskCheckpoint {
        const lastFailedEntry = [...result.actionJournal]
            .reverse()
            .find((entry) => entry.ok === false && entry.errorCode);

        const nextAction = currentPhase === "completed"
            ? "核对交付并结束任务"
            : currentPhase === "blocked"
                ? (result.verifyResult?.failureReason || result.continuationReason || "等待人工接力后继续")
                : (result.continuationReason || "继续下一轮任务推进");

        return {
            currentPhase,
            summary: (result.answer || "").trim() || task.goal,
            nextAction,
            lastToolName: result.toolCall?.name,
            lastErrorCode: lastFailedEntry?.errorCode,
            verifyEvidence: result.verifyResult?.evidence,
            updatedAt: Date.now(),
        };
    }

    private buildFailureCheckpoint(
        task: TaskRecord,
        errorCode: string,
        error: unknown
    ): TaskCheckpoint {
        return {
            currentPhase: "failed",
            summary: task.checkpoint?.summary || task.goal,
            nextAction: "检查错误后决定是否重新发起任务",
            lastToolName: task.lastToolCall?.name,
            lastErrorCode: errorCode,
            updatedAt: Date.now(),
            verifyEvidence: error instanceof Error ? error.message : String(error),
        };
    }

    /**
     * P5.7-R12-T8: 检查总预算是否耗尽
     *
     * @param task 任务记录
     * @param result tool-loop 执行结果
     * @param actionJournal action journal（用于提取错误码）
     * @returns 是否耗尽及原因
     */
    private checkBudgetExhausted(
        task: TaskRecord,
        result: TaskTurnResult,
        actionJournal: TaskTurnResult["actionJournal"]
    ): { exhausted: boolean; reason?: string } {
        // 检查 1: 超过最大尝试次数
        if (task.attemptCount >= task.maxAttempts) {
            return {
                exhausted: true,
                reason: `超过最大尝试次数 (${task.attemptCount}/${task.maxAttempts})`,
            };
        }

        // 检查 2: 同工具同参数重试次数超限
        if (result.toolCall && task.lastToolCall) {
            const { name, args } = result.toolCall;
            const isSameTool = task.lastToolCall.name === name;
            const isSameArgs = JSON.stringify(task.lastToolCall.args) === JSON.stringify(args);

            if (isSameTool && isSameArgs) {
                const nextRetryCount = (task.sameToolSameArgsRetryCount ?? 0) + 1;
                if (nextRetryCount >= this.SAME_TOOL_SAME_ARGS_RETRY_LIMIT) {
                    return {
                        exhausted: true,
                        reason: `同工具同参数重试次数超限 (${nextRetryCount}/${this.SAME_TOOL_SAME_ARGS_RETRY_LIMIT})`,
                    };
                }
            }
        }

        // 检查 3: 同错误码连续失败次数（P5.7-R12-T8: 已实现）
        // 从 actionJournal 中提取最后一个错误码
        if (actionJournal.length > 0) {
            // 从后往前找第一个失败的 entry
            for (let i = actionJournal.length - 1; i >= 0; i--) {
                const entry = actionJournal[i];
                if (entry.ok === false && entry.errorCode) {
                    // 找到一个错误码
                    const lastErrorCode = entry.errorCode;

                    // 检查是否与上次错误码相同
                    if (task.lastErrorCode === lastErrorCode) {
                        const nextStreakCount = (task.sameErrorCodeStreakCount ?? 0) + 1;
                        if (nextStreakCount >= this.SAME_ERROR_CODE_STREAK_LIMIT) {
                            return {
                                exhausted: true,
                                reason: `同错误码连续失败次数超限 (${nextStreakCount}/${this.SAME_ERROR_CODE_STREAK_LIMIT}, 错误码: ${lastErrorCode})`,
                            };
                        }
                    }

                    // 错误码不同，重置计数（不在续跑阶段处理，这里只检查）
                    break;
                }
            }
        }

        return { exhausted: false };
    }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建任务监督器实例
 */
export function createTaskSupervisor(config: TaskSupervisorConfig): TaskSupervisor {
    return new TaskSupervisor(config);
}

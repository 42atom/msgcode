/**
 * msgcode: 任务控制命令实现（P5.7-R12 Agent Relentless Task Closure）
 *
 * 职责：
 * - /task run <goal> 创建任务
 * - /task status 查看任务状态
 * - /task cancel 取消任务
 * - /task resume 恢复 blocked 任务
 *
 * 约束：
 * - 单 chat 单活跃任务
 * - 只有显式 /task run 创建任务
 * - 重复创建必须拒绝
 */

import type { RouteEntry } from "./store.js";
import type { TaskSupervisor } from "../runtime/task-supervisor.js";
import type { TaskDiagnostics } from "../runtime/task-types.js";
import { logger } from "../logger/index.js";

// ============================================
// 命令执行结果
// ============================================

export interface TaskCommandResult {
    /** 是否成功 */
    ok: boolean;
    /** 返回消息 */
    message: string;
    /** 任务诊断信息（如果有） */
    task?: TaskDiagnostics;
}

// ============================================
// 命令处理函数
// ============================================

/**
 * 处理 /task run <goal> 命令
 *
 * 创建新任务
 *
 * @param goal 任务目标描述
 * @param route 路由信息
 * @param supervisor 任务监督器
 * @returns 命令执行结果
 */
export async function handleTaskRun(
    goal: string,
    route: RouteEntry,
    supervisor: TaskSupervisor
): Promise<TaskCommandResult> {
    if (!goal || goal.trim().length === 0) {
        return {
            ok: false,
            message: "任务目标不能空\n用法: /task run <目标描述>",
        };
    }

    try {
        const result = await supervisor.createTask(route.chatGuid, route.workspacePath, goal.trim());

        if (!result.ok) {
            return {
                ok: false,
                message: `创建任务失败: ${result.error}`,
            };
        }

        const task = result.task;
        return {
            ok: true,
            message: `任务已创建\n- 任务 ID: ${task.taskId}\n- 目标: ${task.goal}\n- 状态: ${task.status}`,
            task,
        };
    } catch (error) {
        logger.error("创建任务失败", {
            module: "cmd-task",
            chatId: route.chatGuid,
            goal,
            error: error instanceof Error ? error.message : String(error),
        });

        return {
            ok: false,
            message: `创建任务失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * 处理 /task status 命令
 *
 * 查看当前任务状态
 *
 * @param route 路由信息
 * @param supervisor 任务监督器
 * @returns 命令执行结果
 */
export async function handleTaskStatus(
    route: RouteEntry,
    supervisor: TaskSupervisor
): Promise<TaskCommandResult> {
    try {
        const task = await supervisor.getActiveTask(route.chatGuid);

        if (!task) {
            return {
                ok: true,
                message: "当前没有活跃任务",
            };
        }

        // 构建状态诊断信息
        const diagnostics = [
            `任务状态`,
            `- 任务 ID: ${task.taskId}`,
            `- 目标: ${task.goal}`,
            `- 状态: ${task.status}`,
            `- 重试次数: ${task.attemptCount}/${task.maxAttempts}`,
        ];

        if (task.nextWakeAtMs) {
            const nextWakeDate = new Date(task.nextWakeAtMs);
            diagnostics.push(`- 下次唤醒: ${nextWakeDate.toLocaleString("zh-CN")}`);
        }

        if (task.lastErrorCode) {
            diagnostics.push(`- 上次错误码: ${task.lastErrorCode}`);
        }

        if (task.lastErrorMessage) {
            diagnostics.push(`- 上次错误: ${task.lastErrorMessage.slice(0, 100)}`);
        }

        if (task.blockedReason) {
            diagnostics.push(`- 阻塞原因: ${task.blockedReason}`);
        }

        if (task.checkpoint?.currentPhase) {
            diagnostics.push(`- 当前阶段: ${task.checkpoint.currentPhase}`);
        }

        if (task.checkpoint?.nextAction) {
            diagnostics.push(`- 下一步: ${task.checkpoint.nextAction.slice(0, 120)}`);
        }

        if (task.checkpoint?.summary) {
            diagnostics.push(`- 检查点摘要: ${task.checkpoint.summary.slice(0, 120)}`);
        }

        if (task.verifyEvidence) {
            diagnostics.push(`- 验证证据: ${task.verifyEvidence.slice(0, 100)}`);
        }

        return {
            ok: true,
            message: diagnostics.join("\n"),
            task,
        };
    } catch (error) {
        logger.error("查询任务状态失败", {
            module: "cmd-task",
            chatId: route.chatGuid,
            error: error instanceof Error ? error.message : String(error),
        });

        return {
            ok: false,
            message: `查询任务状态失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * 处理 /task cancel 命令
 *
 * 取消当前任务
 *
 * @param route 路由信息
 * @param supervisor 任务监督器
 * @returns 命令执行结果
 */
export async function handleTaskCancel(
    route: RouteEntry,
    supervisor: TaskSupervisor
): Promise<TaskCommandResult> {
    try {
        const task = await supervisor.getActiveTask(route.chatGuid);

        if (!task) {
            return {
                ok: false,
                message: "当前没有活跃任务",
            };
        }

        const result = await supervisor.cancelTask(task.taskId);

        if (!result.ok) {
            return {
                ok: false,
                message: `取消任务失败: ${result.error}`,
            };
        }

        return {
            ok: true,
            message: `任务已取消\n- 任务 ID: ${task.taskId}\n- 原状态: ${task.status}\n- 新状态: cancelled`,
            task: result.task,
        };
    } catch (error) {
        logger.error("取消任务失败", {
            module: "cmd-task",
            chatId: route.chatGuid,
            error: error instanceof Error ? error.message : String(error),
        });

        return {
            ok: false,
            message: `取消任务失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * 处理 /task resume 命令
 *
 * 恢复 blocked 任务
 *
 * @param route 路由信息
 * @param supervisor 任务监督器
 * @returns 命令执行结果
 */
export async function handleTaskResume(
    route: RouteEntry,
    supervisor: TaskSupervisor
): Promise<TaskCommandResult> {
    try {
        const task = await supervisor.getActiveTask(route.chatGuid);

        if (!task) {
            return {
                ok: false,
                message: "当前没有活跃任务",
            };
        }

        if (task.status !== "blocked") {
            return {
                ok: false,
                message: `只能恢复 blocked 状态的任务\n当前状态: ${task.status}`,
            };
        }

        const result = await supervisor.resumeTask(task.taskId);

        if (!result.ok) {
            return {
                ok: false,
                message: `恢复任务失败: ${result.error}`,
            };
        }

        return {
            ok: true,
            message: `任务已恢复\n- 任务 ID: ${task.taskId}\n- 原状态: blocked\n- 新状态: running\n- 重试次数: ${result.task.attemptCount}`,
            task: result.task,
        };
    } catch (error) {
        logger.error("恢复任务失败", {
            module: "cmd-task",
            chatId: route.chatGuid,
            error: error instanceof Error ? error.message : String(error),
        });

        return {
            ok: false,
            message: `恢复任务失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

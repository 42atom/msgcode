/**
 * msgcode: 任务控制命令（P5.7-R12 Agent Relentless Task Closure）
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

import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";
import type { TaskSupervisor } from "../runtime/task-supervisor.js";
import { getTaskSupervisor as getGlobalTaskSupervisor } from "../commands.js";
import {
    handleTaskRun,
    handleTaskStatus,
    handleTaskCancel,
    handleTaskResume,
} from "./cmd-task-impl.js";

// ============================================
// 获取 Task Supervisor 实例
// ============================================

/**
 * 获取 Task Supervisor 实例
 *
 * 从全局状态获取实例（commands.ts）
 */
function getTaskSupervisor(): TaskSupervisor | null {
    return getGlobalTaskSupervisor();
}

// ============================================
// 主命令处理函数
// ============================================

/**
 * 处理 /task 命令
 *
 * 支持的子命令：
 * - /task run <goal>
 * - /task status
 * - /task cancel
 * - /task resume
 */
export async function handleTaskCommand(options: CommandHandlerOptions): Promise<CommandResult> {
    const { chatId, args } = options;

    // 检查工作区绑定
    const entry = getRouteByChatId(chatId);
    if (!entry) {
        return {
            success: false,
            message: `未绑定工作区\n\n请先使用 /bind <dir> 绑定工作空间`,
        };
    }

    // 获取 Task Supervisor
    const supervisor = getTaskSupervisor();
    if (!supervisor) {
        return {
            success: false,
            message: `任务监督器未启动`,
        };
    }

    // 解析子命令
    const subcommand = args[0] || "";
    const validSubcommands = ["run", "status", "cancel", "resume"];

    if (!validSubcommands.includes(subcommand)) {
        return {
            success: false,
            message: `无效的子命令: ${subcommand}\n\n` +
            `可用子命令:\n` +
            `  run     创建新任务\n` +
            `  status  查看当前任务状态\n` +
            `  cancel  取消当前任务\n` +
            `  resume  恢复 blocked 任务`,
        };
    }

    // 分发到子命令处理器
    let result;
    switch (subcommand) {
        case "run":
            // /task run <goal>
            const goal = args.slice(1).join(" ");
            result = await handleTaskRun(goal, entry, supervisor);
            break;

        case "status":
            // /task status
            result = await handleTaskStatus(entry, supervisor);
            break;

        case "cancel":
            // /task cancel
            result = await handleTaskCancel(entry, supervisor);
            break;

        case "resume":
            // /task resume
            result = await handleTaskResume(entry, supervisor);
            break;

        default:
            return {
                success: false,
                message: `未实现的子命令: ${subcommand}`,
            };
    }

    return {
        success: result.ok,
        message: result.message,
    };
}

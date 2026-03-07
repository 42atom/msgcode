/**
 * msgcode: 任务持久化存储（P5.7-R12 Agent Relentless Task Closure）
 *
 * 职责：
 * - 任务的持久化存储与加载
 * - 任务状态转换验证
 * - 单 chat 单活跃任务约束
 * - 重启恢复
 *
 * 存储格式：
 * - <taskDir>/<chatId>.json: 按 chatId 分组的任务文件
 * - 每个 chat 只保留最新活跃任务（终态任务可归档）
 */

import fs from "node:fs";
import path from "node:path";
import type { TaskRecord, TaskStatus } from "./task-types.js";
import { isLegalTransition } from "./task-types.js";
import { logger } from "../logger/index.js";

// ============================================
// 任务存储配置
// ============================================

export interface TaskStoreConfig {
    /** 任务目录路径 */
    taskDir: string;
}

// ============================================
// 任务存储类
// ============================================

export class TaskStore {
    private taskDir: string;

    constructor(config: TaskStoreConfig) {
        this.taskDir = config.taskDir;
        this.ensureDir();
    }

    /**
     * 确保任务目录存在
     */
    private ensureDir(): void {
        if (!fs.existsSync(this.taskDir)) {
            fs.mkdirSync(this.taskDir, { recursive: true });
            logger.info("任务存储目录已创建", {
                module: "task-store",
                taskDir: this.taskDir,
            });
        }
    }

    /**
     * 获取任务文件路径
     */
    private getTaskFilePath(chatId: string): string {
        // 使用 chatId 作为文件名，替换特殊字符
        const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
        return path.join(this.taskDir, `${safeChatId}.json`);
    }

    /**
     * 创建任务
     *
     * 约束：单 chat 单活跃任务
     * - 若该 chat 已有非终态任务，拒绝创建
     * - 终态任务（completed/failed/cancelled）可覆盖
     */
    async createTask(task: TaskRecord): Promise<{ ok: true; task: TaskRecord } | { ok: false; error: string }> {
        const existing = await this.getActiveTask(task.chatId);

        if (existing) {
            // 已有活跃任务，拒绝创建
            return {
                ok: false,
                error: `该会话已有活跃任务 (taskId=${existing.taskId}, status=${existing.status})，请先使用 /task status 查看或 /task cancel 取消`,
            };
        }

        // 持久化任务
        await this.saveTask(task);

        logger.info("任务已创建", {
            module: "task-store",
            taskId: task.taskId,
            chatId: task.chatId,
            goal: task.goal,
        });

        return { ok: true, task };
    }

    /**
     * 更新任务
     *
     * 自动验证状态转换合法性
     */
    async updateTask(
        taskId: string,
        updates: Partial<Omit<TaskRecord, "taskId" | "chatId" | "workspacePath" | "goal" | "createdAt">>
    ): Promise<{ ok: true; task: TaskRecord } | { ok: false; error: string }> {
        const existing = await this.getTaskById(taskId);
        if (!existing) {
            return { ok: false, error: `任务不存在: ${taskId}` };
        }

        // 验证状态转换
        if (updates.status && !isLegalTransition(existing.status, updates.status)) {
            return {
                ok: false,
                error: `非法状态转换: ${existing.status} -> ${updates.status}`,
            };
        }

        // 应用更新
        const updated: TaskRecord = {
            ...existing,
            ...updates,
            updatedAt: Date.now(),
        };

        // 持久化
        await this.saveTask(updated);

        logger.info("任务已更新", {
            module: "task-store",
            taskId,
            status: updates.status,
        });

        return { ok: true, task: updated };
    }

    /**
     * 根据 ID 获取任务
     */
    async getTaskById(taskId: string): Promise<TaskRecord | null> {
        // 遍历所有 chat 任务文件（效率较低，但当前 MVP 可接受）
        const files = fs.readdirSync(this.taskDir);
        for (const file of files) {
            if (!file.endsWith(".json")) continue;

            const filePath = path.join(this.taskDir, file);
            try {
                const content = fs.readFileSync(filePath, "utf-8");
                const task = JSON.parse(content) as TaskRecord;
                if (task.taskId === taskId) {
                    return task;
                }
            } catch (error) {
                logger.warn("读取任务文件失败", {
                    module: "task-store",
                    file,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return null;
    }

    /**
     * 获取指定 chat 的活跃任务
     *
     * 活跃任务：pending | running | blocked
     */
    async getActiveTask(chatId: string): Promise<TaskRecord | null> {
        const filePath = this.getTaskFilePath(chatId);
        if (!fs.existsSync(filePath)) {
            return null;
        }

        try {
            const content = fs.readFileSync(filePath, "utf-8");
            const task = JSON.parse(content) as TaskRecord;

            // 检查是否为活跃状态
            const isActive = task.status === "pending" || task.status === "running" || task.status === "blocked";
            return isActive ? task : null;
        } catch (error) {
            logger.warn("读取任务文件失败", {
                module: "task-store",
                chatId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * 获取指定 chat 的最新任务（包括终态）
     */
    async getLatestTask(chatId: string): Promise<TaskRecord | null> {
        const filePath = this.getTaskFilePath(chatId);
        if (!fs.existsSync(filePath)) {
            return null;
        }

        try {
            const content = fs.readFileSync(filePath, "utf-8");
            return JSON.parse(content) as TaskRecord;
        } catch (error) {
            logger.warn("读取任务文件失败", {
                module: "task-store",
                chatId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * 获取所有活跃任务
     *
     * 用于 supervisor 扫描
     */
    async getAllActiveTasks(): Promise<TaskRecord[]> {
        const files = fs.readdirSync(this.taskDir);
        const activeTasks: TaskRecord[] = [];

        for (const file of files) {
            if (!file.endsWith(".json")) continue;

            const filePath = path.join(this.taskDir, file);
            try {
                const content = fs.readFileSync(filePath, "utf-8");
                const task = JSON.parse(content) as TaskRecord;

                const isActive = task.status === "pending" || task.status === "running" || task.status === "blocked";
                if (isActive) {
                    activeTasks.push(task);
                }
            } catch (error) {
                logger.warn("读取任务文件失败", {
                    module: "task-store",
                    file,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return activeTasks;
    }

    /**
     * 删除任务
     */
    async deleteTask(taskId: string): Promise<{ ok: true; deleted: TaskRecord } | { ok: false; error: string }> {
        const task = await this.getTaskById(taskId);
        if (!task) {
            return { ok: false, error: `任务不存在: ${taskId}` };
        }

        const filePath = this.getTaskFilePath(task.chatId);
        fs.unlinkSync(filePath);

        logger.info("任务已删除", {
            module: "task-store",
            taskId,
            chatId: task.chatId,
        });

        return { ok: true, deleted: task };
    }

    /**
     * 持久化任务到文件
     */
    private async saveTask(task: TaskRecord): Promise<void> {
        const filePath = this.getTaskFilePath(task.chatId);
        const content = JSON.stringify(task, null, 2);
        fs.writeFileSync(filePath, content, "utf-8");
    }

    /**
     * 启动时恢复所有活跃任务
     *
     * 用于重启恢复
     */
    async recoverActiveTasks(): Promise<TaskRecord[]> {
        const activeTasks = await this.getAllActiveTasks();

        logger.info("活跃任务恢复", {
            module: "task-store",
            count: activeTasks.length,
        });

        return activeTasks;
    }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建任务存储实例
 */
export function createTaskStore(config: TaskStoreConfig): TaskStore {
    return new TaskStore(config);
}

/**
 * P5.7-R12: Agent Relentless Task Closure 回归锁测试
 *
 * 验收：
 * 1. 任务状态机与持久化
 * 2. 事件队列持久化与重启恢复
 * 3. task-supervisor 续跑逻辑
 * 4. verify gate（无 verify 不得 completed）
 * 5. 控制面命令
 * 6. 单 chat 单活跃任务约束
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
    type TaskRecord,
    type TaskStatus,
    isLegalTransition,
    createTaskRecord,
    formatTaskCheckpointAsContext,
} from "../src/runtime/task-types.js";
import { TaskStore } from "../src/runtime/task-store.js";
import { EventQueueStore } from "../src/runtime/event-queue-store.js";
import { TaskSupervisor } from "../src/runtime/task-supervisor.js";
import { handleTaskStatus } from "../src/routes/cmd-task-impl.js";

// ============================================
// 测试工具函数
// ============================================

function createTempDir(): string {
    const tmpDir = path.join(tmpdir(), `msgcode-test-${randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
}

function cleanupTempDir(tmpDir: string): void {
    if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// ============================================
// 测试套件
// ============================================

describe("P5.7-R12: Agent Relentless Task Closure", () => {
    describe("任务状态机", () => {
        it("状态转换合法：pending -> running", () => {
            expect(isLegalTransition("pending", "running")).toBe(true);
        });

        it("状态转换合法：running -> completed", () => {
            expect(isLegalTransition("running", "completed")).toBe(true);
        });

        it("状态转换合法：running -> blocked", () => {
            expect(isLegalTransition("running", "blocked")).toBe(true);
        });

        it("状态转换非法：completed -> running", () => {
            expect(isLegalTransition("completed", "running")).toBe(false);
        });

        it("状态转换非法：pending -> blocked", () => {
            expect(isLegalTransition("pending", "blocked")).toBe(false);
        });
    });

    describe("任务持久化存储", () => {
        let tmpDir: string;
        let taskStore: TaskStore;

        beforeEach(() => {
            tmpDir = createTempDir();
            taskStore = new TaskStore({ taskDir: tmpDir });
        });

        afterEach(() => {
            cleanupTempDir(tmpDir);
        });

        it("创建任务并持久化", async () => {
            const task = createTaskRecord({
                chatId: "test-chat-1",
                workspacePath: "/tmp/workspace",
                goal: "测试任务",
            });

            const result = await taskStore.createTask(task);
            expect(result.ok).toBe(true);
            expect(result.task.checkpoint?.summary).toBe("测试任务");
            expect(result.task.checkpoint?.nextAction).toBe("开始执行当前任务");

            // 验证文件存在
            const filePath = path.join(tmpDir, "test-chat-1.json");
            expect(fs.existsSync(filePath)).toBe(true);
        });

        it("单 chat 单活跃任务约束：拒绝创建第二个任务", async () => {
            const task1 = createTaskRecord({
                chatId: "test-chat-2",
                workspacePath: "/tmp/workspace",
                goal: "任务1",
            });

            const result1 = await taskStore.createTask(task1);
            expect(result1.ok).toBe(true);

            const task2 = createTaskRecord({
                chatId: "test-chat-2",
                workspacePath: "/tmp/workspace",
                goal: "任务2",
            });

            const result2 = await taskStore.createTask(task2);
            expect(result2.ok).toBe(false);
            expect(result2.error).toContain("已有活跃任务");
        });

        it("重启恢复：获取活跃任务", async () => {
            const task = createTaskRecord({
                chatId: "test-chat-3",
                workspacePath: "/tmp/workspace",
                goal: "待恢复任务",
            });

            await taskStore.createTask(task);

            // 手动更新状态为 running（pending -> running 是合法转换）
            await taskStore.updateTask(task.taskId, { status: "running" });

            // 模拟重启：创建新的 TaskStore 实例
            const newTaskStore = new TaskStore({ taskDir: tmpDir });
            const recovered = await newTaskStore.getActiveTask("test-chat-3");

            expect(recovered).not.toBeNull();
            expect(recovered?.taskId).toBe(task.taskId);
            expect(recovered?.status).toBe("running");
        });
    });

    describe("事件队列持久化", () => {
        let tmpDir: string;
        let eventQueueStore: EventQueueStore;

        beforeEach(() => {
            tmpDir = createTempDir();
            eventQueueStore = new EventQueueStore({ eventQueueDir: tmpDir });
        });

        afterEach(() => {
            cleanupTempDir(tmpDir);
        });

        it("事件入队并持久化", async () => {
            const event = {
                eventId: randomUUID(),
                taskId: randomUUID(),
                chatId: "test-chat-1",
                type: "task_start" as const,
                status: "queued" as const,
                createdAt: Date.now(),
            };

            await eventQueueStore.pushEvent(event);

            // 验证文件存在
            const filePath = path.join(tmpDir, "test-chat-1.jsonl");
            expect(fs.existsSync(filePath)).toBe(true);
        });

        it("重启恢复：获取未完成事件", async () => {
            const event1 = {
                eventId: randomUUID(),
                taskId: randomUUID(),
                chatId: "test-chat-2",
                type: "task_start" as const,
                status: "queued" as const,
                createdAt: Date.now(),
            };

            const event2 = {
                eventId: randomUUID(),
                taskId: randomUUID(),
                chatId: "test-chat-2",
                type: "tool_call" as const,
                status: "processing" as const,
                createdAt: Date.now(),
            };

            await eventQueueStore.pushEvent(event1);
            await eventQueueStore.pushEvent(event2);

            // 模拟重启：创建新的 EventQueueStore 实例
            const newStore = new EventQueueStore({ eventQueueDir: tmpDir });
            const pending = await newStore.getPendingEvents("test-chat-2");

            expect(pending.length).toBe(2);
        });
    });

    describe("task-supervisor", () => {
        let tmpDir: string;
        let supervisor: TaskSupervisor;

        beforeEach(() => {
            tmpDir = createTempDir();
            supervisor = new TaskSupervisor({
                taskDir: path.join(tmpDir, "tasks"),
                eventQueueDir: path.join(tmpDir, "events"),
                heartbeatIntervalMs: 1000,
            });
        });

        afterEach(() => {
            cleanupTempDir(tmpDir);
        });

        it("创建任务并返回诊断信息", async () => {
            const result = await supervisor.createTask(
                "test-chat-1",
                "/tmp/workspace",
                "测试任务"
            );

            expect(result.ok).toBe(true);
            expect(result.task).toBeDefined();
            expect(result.task.status).toBe("pending");
            expect(result.task.goal).toBe("测试任务");
            expect(result.task.checkpoint?.summary).toBe("测试任务");
        });

        it("单 chat 单活跃任务：重复创建拒绝", async () => {
            const result1 = await supervisor.createTask(
                "test-chat-2",
                "/tmp/workspace",
                "任务1"
            );

            expect(result1.ok).toBe(true);

            const result2 = await supervisor.createTask(
                "test-chat-2",
                "/tmp/workspace",
                "任务2"
            );

            expect(result2.ok).toBe(false);
            expect(result2.error).toContain("已有活跃任务");
        });

        it("取消任务", async () => {
            const createResult = await supervisor.createTask(
                "test-chat-3",
                "/tmp/workspace",
                "待取消任务"
            );

            expect(createResult.ok).toBe(true);

            const cancelResult = await supervisor.cancelTask(createResult.task!.taskId);

            expect(cancelResult.ok).toBe(true);
            expect(cancelResult.task?.status).toBe("cancelled");
        });

        it("恢复 blocked 任务", async () => {
            // 先创建一个任务
            const createResult = await supervisor.createTask(
                "test-chat-4",
                "/tmp/workspace",
                "待恢复任务"
            );

            expect(createResult.ok).toBe(true);

            // 先将任务转为 running（pending -> running）
            const runningResult = await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: true,
                status: "running",
            });

            expect(runningResult.ok).toBe(true);

            // 模拟任务阻塞（running -> blocked）
            const updateResult = await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: false,
                status: "blocked",
                blockedReason: "需要人工确认",
                recoveryContext: "{}",
                checkpoint: {
                    currentPhase: "blocked",
                    summary: "任务卡在人工确认",
                    nextAction: "等用户确认后继续",
                    updatedAt: Date.now(),
                },
            });

            expect(updateResult.ok).toBe(true);
            expect(updateResult.task?.status).toBe("blocked");

            // 恢复任务
            const resumeResult = await supervisor.resumeTask(createResult.task!.taskId);

            expect(resumeResult.ok).toBe(true);
            expect(resumeResult.task?.status).toBe("running");
            expect(resumeResult.task?.attemptCount).toBe(0);
            expect(resumeResult.task?.checkpoint?.currentPhase).toBe("running");
            expect(resumeResult.task?.checkpoint?.nextAction).toContain("继续执行");
        });

        it("heartbeat 会继续推进 running 任务", async () => {
            const createResult = await supervisor.createTask(
                "test-chat-7",
                "/tmp/workspace",
                "待续跑任务"
            );

            expect(createResult.ok).toBe(true);

            const runningResult = await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: true,
                status: "running",
            });

            expect(runningResult.ok).toBe(true);

            const executedTaskIds: string[] = [];
            (supervisor as unknown as { executeTask: (task: TaskRecord) => Promise<void> }).executeTask = async (
                task: TaskRecord
            ) => {
                executedTaskIds.push(task.taskId);
            };

            await supervisor.start();
            await supervisor.handleHeartbeatTick({
                tickId: "tick1234",
                reason: "manual",
                startTime: Date.now(),
            });

            expect(executedTaskIds).toEqual([createResult.task!.taskId]);
            await supervisor.stop();
        });

        it("verify gate：无 verify 证据不得 completed", async () => {
            const createResult = await supervisor.createTask(
                "test-chat-8",
                "/tmp/workspace",
                "需验证任务"
            );

            expect(createResult.ok).toBe(true);

            // 尝试标记为完成，但没有 verify 证据
            const updateResult = await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: true,
                status: "completed",
            });

            expect(updateResult.ok).toBe(true);
            // 由于没有 verify 证据，状态应该是 running 而不是 completed
            expect(updateResult.task?.status).toBe("running");
            expect(updateResult.task?.checkpoint?.currentPhase).toBe("running");
            expect(updateResult.task?.checkpoint?.nextAction).toBe("补充验证证据后再结束任务");
        });

        it("verify gate：有 verify 证据可 completed", async () => {
            const createResult = await supervisor.createTask(
                "test-chat-9",
                "/tmp/workspace",
                "已验证任务"
            );

            expect(createResult.ok).toBe(true);

            // 先将任务转为 running（pending -> running）
            const runningResult = await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: true,
                status: "running",
            });

            expect(runningResult.ok).toBe(true);

            // 标记为完成，并提供 verify 证据（running -> completed）
            const updateResult = await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: true,
                status: "completed",
                verifyEvidence: JSON.stringify({ exitCode: 0 }),
                checkpoint: {
                    currentPhase: "completed",
                    summary: "任务已完成",
                    nextAction: "核对交付并结束任务",
                    updatedAt: Date.now(),
                },
            });

            expect(updateResult.ok).toBe(true);
            expect(updateResult.task?.status).toBe("completed");
            expect(updateResult.task?.verifyEvidence).toBeDefined();
            expect(updateResult.task?.checkpoint?.currentPhase).toBe("completed");
        });

        it("显式 failed 不得被 attemptCount 逻辑回退成 pending", async () => {
            const createResult = await supervisor.createTask(
                "test-chat-10",
                "/tmp/workspace",
                "应保持失败状态"
            );

            expect(createResult.ok).toBe(true);

            const runningResult = await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: true,
                status: "running",
            });
            expect(runningResult.ok).toBe(true);

            const failedResult = await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: false,
                status: "failed",
                errorCode: "BUDGET_EXHAUSTED",
                errorMessage: "same tool retry limit",
                checkpoint: {
                    currentPhase: "failed",
                    summary: "预算耗尽，无法继续",
                    nextAction: "检查预算后重新发起任务",
                    updatedAt: Date.now(),
                },
            });

            expect(failedResult.ok).toBe(true);
            expect(failedResult.task?.status).toBe("failed");
            expect(failedResult.task?.lastErrorCode).toBe("BUDGET_EXHAUSTED");
            expect(failedResult.task?.checkpoint?.currentPhase).toBe("failed");
        });

        it("任务状态输出应包含 checkpoint 阶段与下一步", async () => {
            const route = {
                chatGuid: "test-chat-status",
                workspacePath: "/tmp/workspace",
                status: "active" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                botType: "agent-backend" as const,
                label: "test",
            };

            const createResult = await supervisor.createTask(
                route.chatGuid,
                route.workspacePath,
                "查看 checkpoint 状态"
            );
            expect(createResult.ok).toBe(true);

            const runningResult = await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: true,
                status: "running",
            });
            expect(runningResult.ok).toBe(true);

            await supervisor.updateTaskResult(createResult.task!.taskId, {
                ok: false,
                status: "blocked",
                blockedReason: "等待人工确认",
                checkpoint: {
                    currentPhase: "blocked",
                    summary: "当前停在人工确认阶段",
                    nextAction: "等用户确认后继续执行",
                    updatedAt: Date.now(),
                },
            });

            const statusResult = await handleTaskStatus(route, supervisor);
            expect(statusResult.ok).toBe(true);
            expect(statusResult.message).toContain("当前阶段: blocked");
            expect(statusResult.message).toContain("下一步: 等用户确认后继续执行");
            expect(statusResult.message).toContain("检查点摘要: 当前停在人工确认阶段");
        });
    });

    describe("checkpoint 格式化", () => {
        it("formatTaskCheckpointAsContext 应输出结构化提示块", () => {
            const text = formatTaskCheckpointAsContext({
                currentPhase: "running",
                summary: "已经完成下载，准备验证结果",
                nextAction: "读取输出文件并核对关键字段",
                lastToolName: "read_file",
                lastErrorCode: "TOOL_TIMEOUT",
                verifyEvidence: '{"exitCode":0}',
                updatedAt: Date.now(),
            });

            expect(text).toContain("[任务检查点]");
            expect(text).toContain("当前阶段: running");
            expect(text).toContain("状态摘要: 已经完成下载");
            expect(text).toContain("下一步: 读取输出文件并核对关键字段");
            expect(text).toContain("最近工具: read_file");
            expect(text).toContain("最近错误码: TOOL_TIMEOUT");
        });

        it("commands.ts 的 executeTaskTurn 应注入 checkpoint + summary/window", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/commands.ts"),
                "utf-8"
            );

            expect(code).toContain("formatTaskCheckpointAsContext");
            expect(code).toContain("const checkpointContext = formatTaskCheckpointAsContext(task.checkpoint)");
            expect(code).toContain("loadWindow(task.workspacePath, task.chatId)");
            expect(code).toContain("loadSummary(task.workspacePath, task.chatId)");
            expect(code).toContain("summaryContext");
        });
    });
});

/**
 * P5.7-R12-T9: Tool Loop 配额续跑真实主流程 Smoke
 *
 * 目标链路（固定）：
 * 1. /task run 创建任务
 * 2. tool-loop 触顶返回 continuable=true
 * 3. heartbeat 下一轮继续执行
 * 4. 最终进入 completed 或 failed
 *
 * 说明：
 * - 本测试不启动真实定时器循环
 * - 通过 TaskSupervisor.handleHeartbeatTick() 驱动 heartbeat 主流程
 * - 通过注入 executeTaskTurn 控制任务执行返回序列
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { RouteEntry } from "../src/routes/store.js";
import { handleTaskRun } from "../src/routes/cmd-task-impl.js";
import { TaskSupervisor } from "../src/runtime/task-supervisor.js";
import type { TickContext } from "../src/runtime/heartbeat.js";

function createTempDir(): string {
    const dir = path.join(tmpdir(), `msgcode-smoke-${randomUUID()}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function cleanupTempDir(dir: string): void {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function makeRoute(workspacePath: string, chatGuid = `chat-${randomUUID()}`): RouteEntry {
    const now = new Date().toISOString();
    return {
        chatGuid,
        workspacePath,
        status: "active",
        createdAt: now,
        updatedAt: now,
        botType: "agent-backend",
        label: "smoke",
    };
}

function makeTick(reason: "manual" | "interval" = "manual"): TickContext {
    return {
        tickId: randomUUID().slice(0, 8),
        reason,
        startTime: Date.now(),
    };
}

describe("P5.7-R12-T9: mainline quota continuation smoke", () => {
    let tmpDir = "";

    beforeEach(() => {
        tmpDir = createTempDir();
    });

    afterEach(() => {
        cleanupTempDir(tmpDir);
    });

    it("/task run -> continuable -> heartbeat 下一轮 -> completed", async () => {
        let callCount = 0;
        const executeTaskTurn = async () => {
            callCount += 1;

            if (callCount === 1) {
                return {
                    answer: "本轮触顶，下一轮继续",
                    actionJournal: [],
                    continuable: true,
                    quotaProfile: "balanced" as const,
                    perTurnToolCallLimit: 16,
                    perTurnToolStepLimit: 48,
                    remainingToolCalls: 0,
                    remainingSteps: 12,
                    continuationReason: "reached_profile_limit_tool_calls_16_limit_16",
                    toolCall: {
                        name: "bash",
                        args: { command: "echo smoke" },
                        result: { exitCode: 0 },
                    },
                };
            }

            return {
                answer: "任务已完成",
                actionJournal: [],
                verifyResult: {
                    ok: true,
                    evidence: JSON.stringify({ exitCode: 0 }),
                },
            };
        };

        const workspacePath = path.join(tmpDir, "workspace");
        fs.mkdirSync(workspacePath, { recursive: true });
        const supervisor = new TaskSupervisor({
            taskDir: path.join(tmpDir, "tasks"),
            eventQueueDir: path.join(tmpDir, "events"),
            heartbeatIntervalMs: 0,
            defaultMaxAttempts: 5,
            executeTaskTurn,
        });
        await supervisor.start();

        const route = makeRoute(workspacePath);
        const runResult = await handleTaskRun("执行复杂任务", route, supervisor);

        expect(runResult.ok).toBe(true);
        expect(runResult.task).toBeDefined();

        const taskId = runResult.task!.taskId;
        const initial = await supervisor.getTaskStatus(taskId);
        expect(initial?.status).toBe("pending");
        expect(initial?.attemptCount).toBe(0);

        await supervisor.handleHeartbeatTick(makeTick("manual"));
        const afterFirstTick = await supervisor.getTaskStatus(taskId);
        expect(afterFirstTick?.status).toBe("pending");
        expect(afterFirstTick?.attemptCount).toBe(1);
        expect(afterFirstTick?.nextWakeAtMs).toBeDefined();
        expect(afterFirstTick?.checkpoint?.currentPhase).toBe("pending");
        expect(afterFirstTick?.checkpoint?.nextAction).toContain("reached_profile_limit");
        expect(afterFirstTick?.checkpoint?.lastToolName).toBe("bash");

        await supervisor.handleHeartbeatTick(makeTick("manual"));
        const afterSecondTick = await supervisor.getTaskStatus(taskId);
        expect(afterSecondTick?.status).toBe("completed");
        expect(afterSecondTick?.verifyEvidence).toBeDefined();
        expect(afterSecondTick?.checkpoint?.currentPhase).toBe("completed");
        expect(callCount).toBe(2);
    });

    it("/task run -> continuable -> heartbeat 下一轮 -> BUDGET_EXHAUSTED -> failed", async () => {
        let callCount = 0;
        const executeTaskTurn = async () => {
            callCount += 1;
            return {
                answer: "本轮触顶，下一轮继续",
                actionJournal: [],
                continuable: true,
                quotaProfile: "balanced" as const,
                perTurnToolCallLimit: 16,
                perTurnToolStepLimit: 48,
                remainingToolCalls: 0,
                remainingSteps: 12,
                continuationReason: "reached_profile_limit_tool_calls_16_limit_16",
                toolCall: {
                    name: "bash",
                    args: { command: "echo budget" },
                    result: { exitCode: 0 },
                },
            };
        };

        const workspacePath = path.join(tmpDir, "workspace");
        fs.mkdirSync(workspacePath, { recursive: true });
        const supervisor = new TaskSupervisor({
            taskDir: path.join(tmpDir, "tasks"),
            eventQueueDir: path.join(tmpDir, "events"),
            heartbeatIntervalMs: 0,
            defaultMaxAttempts: 1,
            executeTaskTurn,
        });
        await supervisor.start();

        const route = makeRoute(workspacePath);
        const runResult = await handleTaskRun("执行会耗尽预算的任务", route, supervisor);

        expect(runResult.ok).toBe(true);
        expect(runResult.task).toBeDefined();

        const taskId = runResult.task!.taskId;

        await supervisor.handleHeartbeatTick(makeTick("manual"));
        const afterFirstTick = await supervisor.getTaskStatus(taskId);
        expect(afterFirstTick?.status).toBe("pending");
        expect(afterFirstTick?.attemptCount).toBe(1);
        expect(afterFirstTick?.checkpoint?.currentPhase).toBe("pending");

        await supervisor.handleHeartbeatTick(makeTick("manual"));
        const afterSecondTick = await supervisor.getTaskStatus(taskId);
        expect(afterSecondTick?.status).toBe("failed");
        expect(afterSecondTick?.lastErrorCode).toBe("BUDGET_EXHAUSTED");
        expect(afterSecondTick?.checkpoint?.currentPhase).toBe("failed");
        expect(callCount).toBe(2);
    });
});

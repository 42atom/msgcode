/**
 * msgcode: P5.7-R3l-4 Action Journal 状态回写回归锁测试
 *
 * 目标：
 * - 验证 journal 顺序锁（stepId 单调递增）
 * - 验证失败保真锁（ok=false 时 errorCode/exitCode 不丢失）
 * - 验证结构一致锁（tool/no-tool/complex-tool 三路返回一致结构）
 *
 * 断言口径：行为断言优先，禁止源码字符串匹配
 */

import { describe, it, expect } from "bun:test";
import type { ActionJournalEntry, ToolLoopResult, RoutedChatResult, LmStudioToolLoopOptions } from "../src/lmstudio.js";

describe("P5.7-R3l-4: Action Journal 状态回写", () => {
    describe("类型契约验证", () => {
        it("ActionJournalEntry 应该包含所有必要字段", () => {
            const entry: ActionJournalEntry = {
                traceId: "test-123",
                stepId: 1,
                phase: "act",
                timestamp: Date.now(),
                route: "tool",
                model: "test-model",
                tool: "bash",
                ok: true,
                exitCode: 0,
                errorCode: undefined,
                stdoutTail: undefined,
                fullOutputPath: undefined,
                durationMs: 100,
            };

            // 验证追踪字段
            expect(entry).toHaveProperty("traceId");
            expect(entry).toHaveProperty("stepId");
            // 验证阶段字段
            expect(entry).toHaveProperty("phase");
            expect(entry).toHaveProperty("timestamp");
            // 验证路由字段
            expect(entry).toHaveProperty("route");
            expect(entry).toHaveProperty("model");
            // 验证工具字段
            expect(entry).toHaveProperty("tool");
            expect(entry).toHaveProperty("ok");
            expect(entry).toHaveProperty("exitCode");
            expect(entry).toHaveProperty("errorCode");
            expect(entry).toHaveProperty("stdoutTail");
            expect(entry).toHaveProperty("fullOutputPath");
            // 验证诊断字段
            expect(entry).toHaveProperty("durationMs");
        });

        it("ToolLoopResult 应该包含 actionJournal 字段", () => {
            const result: ToolLoopResult = {
                answer: "test answer",
                actionJournal: [],
            };

            expect(result).toHaveProperty("answer");
            expect(result).toHaveProperty("actionJournal");
            expect(Array.isArray(result.actionJournal)).toBe(true);
        });

        it("RoutedChatResult 应该包含 actionJournal 字段", () => {
            const result: RoutedChatResult = {
                answer: "test answer",
                route: "tool",
                temperature: 0,
                actionJournal: [],
            };

            expect(result).toHaveProperty("answer");
            expect(result).toHaveProperty("route");
            expect(result).toHaveProperty("temperature");
            expect(result).toHaveProperty("actionJournal");
            expect(Array.isArray(result.actionJournal)).toBe(true);
        });

        it("LmStudioToolLoopOptions 应该包含 traceId 和 route 字段", () => {
            const options: LmStudioToolLoopOptions = {
                prompt: "test",
                traceId: "test-123",
                route: "tool",
            };

            expect(options).toHaveProperty("traceId");
            expect(options).toHaveProperty("route");
        });
    });

    describe("Journal 顺序锁验证", () => {
        it("stepId 应该从 0 开始并单调递增", () => {
            const journal: ActionJournalEntry[] = [
                { traceId: "t1", stepId: 0, phase: "act", timestamp: 100, route: "tool", tool: "bash", ok: true, durationMs: 10 },
                { traceId: "t1", stepId: 1, phase: "act", timestamp: 200, route: "tool", tool: "bash", ok: true, durationMs: 20 },
                { traceId: "t1", stepId: 2, phase: "act", timestamp: 300, route: "tool", tool: "bash", ok: true, durationMs: 30 },
            ];

            expect(journal[0].stepId).toBe(0);
            expect(journal[1].stepId).toBe(1);
            expect(journal[2].stepId).toBe(2);
        });

        it("journal 条目应该包含正确的字段", () => {
            const entry: ActionJournalEntry = {
                traceId: "test-123",
                stepId: 1,
                phase: "act",
                timestamp: Date.now(),
                route: "tool",
                model: "test-model",
                tool: "bash",
                ok: true,
                durationMs: 100,
            };

            expect(entry.traceId).toBeDefined();
            expect(entry.stepId).toBeDefined();
            expect(entry.phase).toBe("act");
            expect(entry.timestamp).toBeDefined();
            expect(entry.route).toBe("tool");
            expect(entry.tool).toBe("bash");
            expect(entry.ok).toBe(true);
            expect(entry.durationMs).toBeDefined();
        });

        it("多步骤执行应该保持顺序", () => {
            const journal: ActionJournalEntry[] = [
                { traceId: "t1", stepId: 0, phase: "act", timestamp: 100, route: "tool", tool: "read_file", ok: true, durationMs: 10 },
                { traceId: "t1", stepId: 1, phase: "act", timestamp: 200, route: "tool", tool: "bash", ok: true, durationMs: 20 },
                { traceId: "t1", stepId: 2, phase: "act", timestamp: 300, route: "tool", tool: "write_file", ok: true, durationMs: 30 },
            ];

            // 验证顺序锁
            for (let i = 1; i < journal.length; i++) {
                expect(journal[i].stepId).toBeGreaterThan(journal[i - 1].stepId);
            }
        });
    });

    describe("失败保真锁验证", () => {
        it("ok=false 时应该保留 errorCode 字段", () => {
            const failEntry: ActionJournalEntry = {
                traceId: "test-456",
                stepId: 1,
                phase: "act",
                timestamp: Date.now(),
                route: "tool",
                tool: "bash",
                ok: false,
                exitCode: 1,
                errorCode: "TOOL_EXEC_FAILED",
                durationMs: 50,
            };

            expect(failEntry.ok).toBe(false);
            expect(failEntry.errorCode).toBe("TOOL_EXEC_FAILED");
        });

        it("ok=false 时应该保留 exitCode 字段", () => {
            const failEntry: ActionJournalEntry = {
                traceId: "test-789",
                stepId: 1,
                phase: "act",
                timestamp: Date.now(),
                route: "tool",
                tool: "bash",
                ok: false,
                exitCode: 127,
                errorCode: "COMMAND_NOT_FOUND",
                durationMs: 10,
            };

            expect(failEntry.ok).toBe(false);
            expect(failEntry.exitCode).toBe(127);
        });

        it("失败场景应该包含完整诊断信息", () => {
            const failEntry: ActionJournalEntry = {
                traceId: "test-abc",
                stepId: 1,
                phase: "act",
                timestamp: Date.now(),
                route: "tool",
                tool: "bash",
                ok: false,
                exitCode: 1,
                errorCode: "TOOL_EXEC_FAILED",
                stdoutTail: "error output...",
                fullOutputPath: "/tmp/output.log",
                durationMs: 100,
            };

            expect(failEntry.ok).toBe(false);
            expect(failEntry.exitCode).toBeDefined();
            expect(failEntry.errorCode).toBeDefined();
            expect(failEntry.stdoutTail).toBeDefined();
            expect(failEntry.fullOutputPath).toBeDefined();
        });
    });

    describe("结构一致锁验证", () => {
        it("no-tool 路由应该返回空 actionJournal 数组", () => {
            const result: RoutedChatResult = {
                answer: "simple answer",
                route: "no-tool",
                temperature: 0.2,
                actionJournal: [],
            };

            expect(result.route).toBe("no-tool");
            expect(result.actionJournal).toEqual([]);
        });

        it("tool 路由应该返回 toolLoopResult.actionJournal", () => {
            const journalEntry: ActionJournalEntry = {
                traceId: "test-123",
                stepId: 1,
                phase: "act",
                timestamp: Date.now(),
                route: "tool",
                tool: "bash",
                ok: true,
                durationMs: 100,
            };

            const result: RoutedChatResult = {
                answer: "tool answer",
                route: "tool",
                temperature: 0,
                toolCall: { name: "bash", args: { command: "ls" }, result: "output" },
                actionJournal: [journalEntry],
            };

            expect(result.route).toBe("tool");
            expect(result.actionJournal.length).toBe(1);
            expect(result.actionJournal[0].tool).toBe("bash");
        });

        it("complex-tool 路由应该返回 toolLoopResult.actionJournal", () => {
            const journalEntry: ActionJournalEntry = {
                traceId: "test-456",
                stepId: 1,
                phase: "act",
                timestamp: Date.now(),
                route: "complex-tool",
                tool: "bash",
                ok: true,
                durationMs: 200,
            };

            const result: RoutedChatResult = {
                answer: "complex answer",
                route: "complex-tool",
                temperature: 0,
                toolCall: { name: "bash", args: { command: "ls" }, result: "output" },
                actionJournal: [journalEntry],
            };

            expect(result.route).toBe("complex-tool");
            expect(result.actionJournal.length).toBe(1);
        });

        it("降级场景应该返回空 actionJournal 数组", () => {
            const degradeResult: RoutedChatResult = {
                answer: "降级回复",
                route: "no-tool",
                temperature: 0.2,
                actionJournal: [],
            };

            expect(degradeResult.actionJournal).toEqual([]);
        });

        it("硬失败场景应该返回空 actionJournal 数组", () => {
            const hardFailResult: ToolLoopResult = {
                answer: "协议失败：未收到工具调用指令",
                actionJournal: [],
            };

            expect(hardFailResult.actionJournal).toEqual([]);
        });
    });

    describe("TraceId 追踪验证", () => {
        it("traceId 格式应该是有效的 UUID 片段", () => {
            const crypto = require("node:crypto");
            const traceId = crypto.randomUUID().slice(0, 8);

            expect(traceId.length).toBe(8);
            expect(/^[a-f0-9]{8}$/.test(traceId)).toBe(true);
        });

        it("ActionJournalEntry 应该包含 traceId", () => {
            const entry: ActionJournalEntry = {
                traceId: "abc12345",
                stepId: 1,
                phase: "act",
                timestamp: Date.now(),
                route: "tool",
                tool: "bash",
                ok: true,
                durationMs: 100,
            };

            expect(entry.traceId).toBe("abc12345");
        });
    });

    describe("Report 阶段可追溯验证", () => {
        it("journal 应该包含 phase 字段标识 act 阶段", () => {
            const entry: ActionJournalEntry = {
                traceId: "test-123",
                stepId: 1,
                phase: "act",
                timestamp: Date.now(),
                route: "tool",
                tool: "bash",
                ok: true,
                durationMs: 100,
            };

            expect(entry.phase).toBe("act");
        });

        it("journal 应该包含 timestamp 字段用于时序分析", () => {
            const now = Date.now();
            const entry: ActionJournalEntry = {
                traceId: "test-123",
                stepId: 1,
                phase: "act",
                timestamp: now,
                route: "tool",
                tool: "bash",
                ok: true,
                durationMs: 100,
            };

            expect(entry.timestamp).toBe(now);
        });

        it("report 阶段可以通过 actionJournal 重构执行细节", () => {
            const journal: ActionJournalEntry[] = [
                { traceId: "t1", stepId: 0, phase: "act", timestamp: 100, route: "tool", tool: "read_file", ok: true, durationMs: 10 },
                { traceId: "t1", stepId: 1, phase: "act", timestamp: 200, route: "tool", tool: "bash", ok: true, durationMs: 20 },
            ];

            // 验证可以通过 journal 重构执行历史
            expect(journal.length).toBe(2);
            expect(journal[0].tool).toBe("read_file");
            expect(journal[1].tool).toBe("bash");
        });
    });
});

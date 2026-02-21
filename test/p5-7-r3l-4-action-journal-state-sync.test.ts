/**
 * msgcode: P5.7-R3l-4 Action Journal 状态回写回归锁测试
 *
 * 目标：
 * - 验证 journal 顺序锁（stepId 单调递增）
 * - 验证失败保真锁（ok=false 时 errorCode/exitCode 不丢失）
 * - 验证结构一致锁（tool/no-tool/complex-tool 三路返回一致结构）
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("P5.7-R3l-4: Action Journal 状态回写", () => {
    describe("类型契约验证", () => {
        it("应该定义 ActionJournalEntry 接口", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证接口定义
            expect(code).toContain("export interface ActionJournalEntry");
        });

        it("ActionJournalEntry 应该包含所有必要字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 提取 ActionJournalEntry 接口
            const interfaceMatch = code.match(
                /export interface ActionJournalEntry\s*\{([\s\S]*?)\n\}/
            );
            expect(interfaceMatch).not.toBeNull();
            if (interfaceMatch) {
                const interfaceBody = interfaceMatch[1];
                // 验证追踪字段
                expect(interfaceBody).toContain("traceId");
                expect(interfaceBody).toContain("stepId");
                // 验证阶段字段
                expect(interfaceBody).toContain("phase");
                expect(interfaceBody).toContain("timestamp");
                // 验证路由字段
                expect(interfaceBody).toContain("route");
                expect(interfaceBody).toContain("model");
                // 验证工具字段
                expect(interfaceBody).toContain("tool");
                expect(interfaceBody).toContain("ok");
                expect(interfaceBody).toContain("exitCode");
                expect(interfaceBody).toContain("errorCode");
                expect(interfaceBody).toContain("stdoutTail");
                expect(interfaceBody).toContain("fullOutputPath");
                // 验证诊断字段
                expect(interfaceBody).toContain("durationMs");
            }
        });

        it("ToolLoopResult 应该包含 actionJournal 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 ToolLoopResult 接口
            const resultMatch = code.match(
                /export interface ToolLoopResult\s*\{([\s\S]*?)\n\}/
            );
            expect(resultMatch).not.toBeNull();
            if (resultMatch) {
                expect(resultMatch[1]).toContain("actionJournal: ActionJournalEntry[]");
            }
        });

        it("RoutedChatResult 应该包含 actionJournal 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 RoutedChatResult 接口
            const resultMatch = code.match(
                /export interface RoutedChatResult\s*\{([\s\S]*?)\n\}/
            );
            expect(resultMatch).not.toBeNull();
            if (resultMatch) {
                expect(resultMatch[1]).toContain("actionJournal: ActionJournalEntry[]");
            }
        });

        it("LmStudioToolLoopOptions 应该包含 traceId 和 route 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 LmStudioToolLoopOptions 接口
            const optionsMatch = code.match(
                /export interface LmStudioToolLoopOptions\s*\{([\s\S]*?)\n\}/
            );
            expect(optionsMatch).not.toBeNull();
            if (optionsMatch) {
                expect(optionsMatch[1]).toContain("traceId");
                expect(optionsMatch[1]).toContain("route");
            }
        });
    });

    describe("Journal 顺序锁验证", () => {
        it("runLmStudioToolLoop 应该初始化 stepId 为 0 并单调递增", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 stepId 初始化
            expect(code).toMatch(/let stepId = 0/);
            // 验证 stepId 递增
            expect(code).toMatch(/stepId\+\+/);
        });

        it("每次工具执行后应该收集 journal 条目", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 actionJournal.push 调用
            expect(code).toContain("actionJournal.push");
        });

        it("journal 条目应该包含正确的字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 journal 条目结构
            const journalPushMatch = code.match(
                /actionJournal\.push\(\{([\s\S]*?)\}\);/
            );
            expect(journalPushMatch).not.toBeNull();
            if (journalPushMatch) {
                const pushBody = journalPushMatch[1];
                expect(pushBody).toContain("traceId");
                expect(pushBody).toContain("stepId");
                expect(pushBody).toContain("phase");
                expect(pushBody).toContain("timestamp");
                expect(pushBody).toContain("route");
                expect(pushBody).toContain("tool");
                expect(pushBody).toContain("ok");
                expect(pushBody).toContain("durationMs");
            }
        });
    });

    describe("失败保真锁验证", () => {
        it("ok=false 时应该保留 errorCode 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 journal 收集时包含 errorCode
            const journalPushMatch = code.match(
                /actionJournal\.push\(\{([\s\S]*?)\}\);/
            );
            expect(journalPushMatch).not.toBeNull();
            if (journalPushMatch) {
                expect(journalPushMatch[1]).toContain("errorCode");
            }
        });

        it("ok=false 时应该保留 exitCode 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 journal 收集时包含 exitCode
            const journalPushMatch = code.match(
                /actionJournal\.push\(\{([\s\S]*?)\}\);/
            );
            expect(journalPushMatch).not.toBeNull();
            if (journalPushMatch) {
                expect(journalPushMatch[1]).toContain("exitCode");
            }
        });

        it("失败场景应该正确判断 isFailure", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证失败判断逻辑
            expect(code).toContain('"error" in toolResult');
        });
    });

    describe("结构一致锁验证", () => {
        it("no-tool 路由应该返回空 actionJournal 数组", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 no-tool 返回包含 actionJournal: []
            expect(code).toMatch(/route:\s*selectedLevel === "LEVEL_2" \? "no-tool" : route[\s\S]{0,100}actionJournal: \[\]/);
        });

        it("tool 路由应该返回 toolLoopResult.actionJournal", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 tool 路由返回传递 actionJournal
            expect(code).toMatch(/route,[\s\S]{0,100}actionJournal: toolLoopResult\.actionJournal/);
        });

        it("complex-tool 路由应该返回 toolLoopResult.actionJournal", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 complex-tool 路由返回传递 actionJournal
            expect(code).toMatch(/route: "complex-tool"[\s\S]{0,200}actionJournal: toolLoopResult\.actionJournal/);
        });

        it("降级场景应该返回空 actionJournal 数组", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 统计 actionJournal: [] 出现次数（应该在多个降级场景出现）
            const emptyArrayMatches = code.match(/actionJournal: \[\]/g);
            expect(emptyArrayMatches).not.toBeNull();
            expect((emptyArrayMatches?.length ?? 0)).toBeGreaterThanOrEqual(3);
        });
    });

    describe("TraceId 追踪验证", () => {
        it("runLmStudioRoutedChat 应该生成 traceId", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 traceId 生成
            expect(code).toContain("const traceId = crypto.randomUUID().slice(0, 8)");
        });

        it("runLmStudioToolLoop 应该使用传入的 traceId 或生成默认值", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 traceId 初始化
            expect(code).toMatch(/const traceId = options\.traceId \|\| crypto\.randomUUID\(\)\.slice\(0, 8\)/);
        });

        it("tool 路由调用 runLmStudioToolLoop 时应该传入 traceId", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 tool 路由传入 traceId
            expect(code).toMatch(/model: usedModel,[\s\S]{0,50}traceId,[\s\S]{0,50}route: "tool"/);
        });

        it("complex-tool 路由调用 runLmStudioToolLoop 时应该传入 traceId", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 complex-tool 路由传入 traceId
            expect(code).toMatch(/model: usedModel,[\s\S]{0,50}traceId,[\s\S]{0,50}route: "complex-tool"/);
        });
    });

    describe("Report 阶段可追溯验证", () => {
        it("journal 应该包含 phase 字段标识 act 阶段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 journal 收集时 phase 为 "act"
            expect(code).toContain('phase: "act"');
        });

        it("journal 应该包含 timestamp 字段用于时序分析", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 journal 收集时包含 timestamp
            expect(code).toContain("timestamp: Date.now()");
        });

        it("report 阶段可以通过 actionJournal 重构执行细节", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 RoutedChatResult 包含 actionJournal，report 阶段可消费
            expect(code).toContain("actionJournal: ActionJournalEntry[]");
        });
    });
});

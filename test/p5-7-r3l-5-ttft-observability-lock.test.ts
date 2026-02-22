/**
 * msgcode: P5.7-R3l-5 TTFT 补偿 + 可观测锁回归测试
 *
 * 目标：
 * - 验证 plan/act 阶段有短回执日志（pipeline phase started）
 * - 验证日志字段完整性（traceId, route, phase, kernel, soulInjected）
 * - 禁止 .only/.skip 新增
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("P5.7-R3l-5: TTFT 补偿 + 可观测锁", () => {
    describe("短回执验证", () => {
        it("complex-tool 路由应该在 plan 阶段入口发送短回执", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 plan 阶段入口日志存在
            expect(code).toContain('phase: "plan"');
            expect(code).toContain('status: "processing"');
            expect(code).toContain("pipeline phase started");
        });

        it("complex-tool 路由应该在 act 阶段入口发送短回执", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 act 阶段入口日志存在
            expect(code).toContain('phase: "act"');
            expect(code).toContain('status: "processing"');
        });

        it("tool 路由应该在 plan 阶段入口发送短回执", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 tool 路由有 plan 阶段短回执（分开验证）
            expect(code).toContain('route: "tool"');
            expect(code).toContain('phase: "plan"');
            expect(code).toContain('status: "processing"');
            // 验证它们在同一个 logger.info 调用中
            const toolPlanSection = code.match(/logger\.info\("pipeline phase started"[\s\S]{0,500}route:\s*"tool"[\s\S]{0,300}phase:\s*"plan"/);
            expect(toolPlanSection).not.toBeNull();
        });

        it("tool 路由应该在 act 阶段入口发送短回执", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 tool 路由有 act 阶段短回执
            expect(code).toContain('route: "tool"');
            expect(code).toContain('phase: "act"');
            expect(code).toContain('status: "processing"');
            // 验证它们在同一个 logger.info 调用中
            const toolActSection = code.match(/logger\.info\("pipeline phase started"[\s\S]{0,500}route:\s*"tool"[\s\S]{0,300}phase:\s*"act"/);
            expect(toolActSection).not.toBeNull();
        });
    });

    describe("观测字段完整性验证", () => {
        it("入口日志应该包含所有必要字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证入口日志包含五个关键字段
            const startLogMatch = code.match(
                /routed chat started[\s\S]{0,500}traceId[\s\S]{0,50}route[\s\S]{0,50}phase[\s\S]{0,50}kernel[\s\S]{0,50}soulInjected/
            );
            expect(startLogMatch).not.toBeNull();
        });

        it("plan 阶段日志应该包含 soulInjected 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 plan 阶段日志包含 soulInjected
            const planLogMatch = code.match(
                /phase:\s*"plan"[\s\S]{0,200}soulInjected/
            );
            expect(planLogMatch).not.toBeNull();
        });

        it("act 阶段日志应该包含 soulInjected 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 act 阶段日志包含 soulInjected
            const actLogMatch = code.match(
                /phase:\s*"act"[\s\S]{0,200}soulInjected/
            );
            expect(actLogMatch).not.toBeNull();
        });

        it("report 阶段日志应该包含 soulInjected 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 report 阶段日志包含 soulInjected
            const reportLogMatch = code.match(
                /phase:\s*"report"[\s\S]{0,200}soulInjected/
            );
            expect(reportLogMatch).not.toBeNull();
        });

        it("soulInjected 字段应该基于 soulContext 计算", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 soul 注入计算逻辑存在（dialog/exec 分离）
            expect(code).toContain("const dialogSoulInjected");
            expect(code).toContain("options.soulContext");
            expect(code).toContain("const execSoulInjected = false");
        });
    });

    describe("测试规范验证", () => {
        it("不应该新增 .only 修饰符", () => {
            const testDir = path.join(process.cwd(), "test");
            const files = fs.readdirSync(testDir).filter(f => f.endsWith(".test.ts"));

            for (const file of files) {
                const content = fs.readFileSync(path.join(testDir, file), "utf-8");
                // 允许在注释中出现 .only，但不能在实际代码中使用
                const lines = content.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    // 跳过注释行
                    if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
                        continue;
                    }
                    // 检查是否有 .only（排除 it.only、describe.only、test.only）
                    if (/\b(it|describe|test)\.only\s*\(/.test(line)) {
                        throw new Error(`${file}:${i + 1} 发现 .only 修饰符，请移除`);
                    }
                }
            }
        });

        it("不应该新增 .skip 修饰符", () => {
            const testDir = path.join(process.cwd(), "test");
            const files = fs.readdirSync(testDir).filter(f => f.endsWith(".test.ts"));

            for (const file of files) {
                const content = fs.readFileSync(path.join(testDir, file), "utf-8");
                // 允许在注释中出现 .skip，但不能在实际代码中使用
                const lines = content.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    // 跳过注释行
                    if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
                        continue;
                    }
                    // 检查是否有 .skip（排除 it.skip、describe.skip、test.skip）
                    if (/\b(it|describe|test)\.skip\s*\(/.test(line)) {
                        throw new Error(`${file}:${i + 1} 发现 .skip 修饰符，请移除`);
                    }
                }
            }
        });
    });

    describe("日志结构一致性验证", () => {
        it("所有 pipeline phase started 日志应该包含相同的基础字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 统计 pipeline phase started 日志数量
            const startedLogs = code.match(/"pipeline phase started"/g);
            expect(startedLogs).not.toBeNull();
            expect(startedLogs?.length).toBeGreaterThanOrEqual(4); // tool:2 + complex-tool:2

            // 验证每个 started 日志都包含必要字段
            const startedMatches = code.matchAll(
                /"pipeline phase started"[\s\S]{0,300}?}/g
            );
            for (const match of startedMatches) {
                const log = match[0];
                expect(log).toContain("traceId");
                expect(log).toContain("route:");
                expect(log).toContain("phase:");
                expect(log).toContain("kernel:");
                expect(log).toContain("soulInjected");
            }
        });

        it("所有 pipeline phase completed 日志应该包含 soulInjected 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 统计 pipeline phase completed 日志数量
            const completedLogs = code.match(/"pipeline phase completed"/g);
            expect(completedLogs).not.toBeNull();
            expect(completedLogs?.length).toBeGreaterThanOrEqual(4); // tool:2 + complex-tool:2

            // 验证每个 completed 日志都包含 soulInjected
            const completedMatches = code.matchAll(
                /"pipeline phase completed"[\s\S]{0,500}?}/g
            );
            for (const match of completedMatches) {
                const log = match[0];
                expect(log).toContain("soulInjected");
            }
        });
    });
});

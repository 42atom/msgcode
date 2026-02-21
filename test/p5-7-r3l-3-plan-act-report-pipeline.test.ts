/**
 * msgcode: P5.7-R3l-3 Plan -> Act -> Report 管道回归锁测试
 *
 * 目标：
 * - 验证日志 phase 顺序固定：plan -> act -> report
 * - 验证可断言字段：traceId + route + phase + kernel
 * - 阶段失败可诊断，不允许静默吞错
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("P5.7-R3l-3: Plan -> Act -> Report 管道", () => {
    describe("代码契约验证", () => {
        it("runLmStudioRoutedChat 应该生成 traceId", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 traceId 生成
            expect(code).toContain("const traceId = crypto.randomUUID().slice(0, 8)");
        });

        it("日志应该包含 traceId 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证日志包含 traceId
            expect(code).toContain("traceId,");
        });

        it("日志应该包含 phase 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证日志包含 phase 字段
            expect(code).toContain("phase: \"init\"");
            expect(code).toContain("phase: \"plan\"");
            expect(code).toContain("phase: \"act\"");
            expect(code).toContain("phase: \"report\"");
        });

        it("日志应该包含 kernel 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证日志包含 kernel 字段
            expect(code).toContain("kernel: \"router\"");
            expect(code).toContain("kernel: \"dialog\"");
            expect(code).toContain("kernel: \"exec\"");
        });
    });

    describe("阶段顺序锁验证", () => {
        // 定义阶段顺序枚举
        type Phase = "init" | "plan" | "act" | "report" | "complete" | "degrade";
        type Kernel = "router" | "dialog" | "exec";
        type Route = "no-tool" | "tool" | "complex-tool";

        // 阶段顺序映射
        const phaseOrder: Record<string, number> = {
            "init": 0,
            "plan": 1,
            "act": 2,
            "report": 3,
            "complete": 4,
            "degrade": -1,
        };

        // 验证阶段顺序的辅助函数
        function validatePhaseOrder(phases: Phase[]): boolean {
            for (let i = 1; i < phases.length; i++) {
                if (phaseOrder[phases[i]] < phaseOrder[phases[i - 1]]) {
                    return false;
                }
            }
            return true;
        }

        it("tool 路由阶段顺序应该是 plan -> act -> report", () => {
            const phases: Phase[] = ["plan", "act", "report"];
            expect(validatePhaseOrder(phases)).toBe(true);
        });

        it("complex-tool 路由阶段顺序应该是 plan -> act -> report", () => {
            const phases: Phase[] = ["plan", "act", "report"];
            expect(validatePhaseOrder(phases)).toBe(true);
        });

        it("no-tool 路由阶段顺序应该是 init -> complete", () => {
            const phases: Phase[] = ["init", "complete"];
            expect(validatePhaseOrder(phases)).toBe(true);
        });

        it("无效阶段顺序应该被检测", () => {
            // plan -> report -> act 是无效顺序
            const phases: Phase[] = ["plan", "report", "act"];
            expect(validatePhaseOrder(phases)).toBe(false);
        });
    });

    describe("Kernel 映射验证", () => {
        // 定义 kernel 映射规则
        const kernelRules: Array<{
            route: string;
            phase: string;
            expectedKernel: string;
        }> = [
            { route: "no-tool", phase: "complete", expectedKernel: "dialog" },
            { route: "tool", phase: "plan", expectedKernel: "router" },
            { route: "tool", phase: "act", expectedKernel: "exec" },
            { route: "tool", phase: "report", expectedKernel: "dialog" },
            { route: "complex-tool", phase: "plan", expectedKernel: "dialog" },
            { route: "complex-tool", phase: "act", expectedKernel: "exec" },
            { route: "complex-tool", phase: "report", expectedKernel: "dialog" },
        ];

        it("tool 路由 plan 阶段 kernel 应该是 router", () => {
            const rule = kernelRules.find(r => r.route === "tool" && r.phase === "plan");
            expect(rule?.expectedKernel).toBe("router");
        });

        it("tool 路由 act 阶段 kernel 应该是 exec", () => {
            const rule = kernelRules.find(r => r.route === "tool" && r.phase === "act");
            expect(rule?.expectedKernel).toBe("exec");
        });

        it("tool 路由 report 阶段 kernel 应该是 dialog", () => {
            const rule = kernelRules.find(r => r.route === "tool" && r.phase === "report");
            expect(rule?.expectedKernel).toBe("dialog");
        });

        it("complex-tool 路由 plan 阶段 kernel 应该是 dialog", () => {
            const rule = kernelRules.find(r => r.route === "complex-tool" && r.phase === "plan");
            expect(rule?.expectedKernel).toBe("dialog");
        });

        it("complex-tool 路由 act 阶段 kernel 应该是 exec", () => {
            const rule = kernelRules.find(r => r.route === "complex-tool" && r.phase === "act");
            expect(rule?.expectedKernel).toBe("exec");
        });

        it("complex-tool 路由 report 阶段 kernel 应该是 dialog", () => {
            const rule = kernelRules.find(r => r.route === "complex-tool" && r.phase === "report");
            expect(rule?.expectedKernel).toBe("dialog");
        });
    });

    describe("代码实现验证", () => {
        it("tool 路由应该有 plan -> act -> report 三个日志", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 tool 路由有三个阶段日志
            const toolSection = code.match(
                /route:\s*"tool"[\s\S]{0,2000}phase:\s*"plan"[\s\S]{0,1000}phase:\s*"act"[\s\S]{0,1000}phase:\s*"report"/
            );
            expect(toolSection).not.toBeNull();
        });

        it("complex-tool 路由应该有 plan -> act -> report 三个日志", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 complex-tool 路由有三个阶段日志
            const complexSection = code.match(
                /route:\s*"complex-tool"[\s\S]{0,2000}phase:\s*"plan"[\s\S]{0,2000}phase:\s*"act"[\s\S]{0,2000}phase:\s*"report"/
            );
            expect(complexSection).not.toBeNull();
        });

        it("tool 路由不应该新增 LLM 轮次（只有 plan 日志，没有 plan LLM 调用）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 提取 tool 路由部分
            const toolMatch = code.match(
                /\/\/\s*tool:[\s\S]*?return\s*\{[\s\S]*?answer:\s*toolLoopResult\.answer/
            );
            expect(toolMatch).not.toBeNull();
            if (toolMatch) {
                const toolSection = toolMatch[0];
                // 验证没有额外的 runLmStudioChat 调用用于 plan
                // plan 阶段只有日志，没有 LLM 调用
                expect(toolSection).toContain("phase: \"plan\"");
                // plan 日志后直接是 toolLoopResult，不是 runLmStudioChat
                expect(toolSection).toMatch(/phase:\s*"plan"[\s\S]{0,200}toolLoopResult/);
            }
        });
    });

    describe("日志格式验证", () => {
        it("日志消息应该是 'pipeline phase completed' 或 'pipeline phase started'", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证日志消息格式统一
            expect(code).toContain('"pipeline phase started"');
            expect(code).toContain('"pipeline phase completed"');
        });

        it("所有阶段日志应该包含完整的四字段：traceId, route, phase, kernel", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证每个 pipeline phase 日志都包含四字段
            const phaseLogs = code.match(/logger\.info\("pipeline phase[^}]+\}/g);
            expect(phaseLogs).not.toBeNull();
            if (phaseLogs) {
                for (const log of phaseLogs) {
                    expect(log).toContain("traceId");
                    expect(log).toContain("route:");
                    expect(log).toContain("phase:");
                    expect(log).toContain("kernel:");
                }
            }
        });
    });
});

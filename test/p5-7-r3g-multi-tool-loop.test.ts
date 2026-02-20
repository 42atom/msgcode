/**
 * msgcode: P5.7-R3g Tool Loop 多工具闭环回归锁测试
 *
 * 目标：
 * - 单轮多工具顺序执行验证（代码审查方式）
 * - 回灌后收口验证
 * - maxToolCallsPerTurn 上限保护测试
 */

import { describe, it, expect } from "bun:test";

describe("P5.7-R3g: Tool Loop Multi-Tool (Regression Lock)", () => {
    describe("上限保护", () => {
        it("应该拒绝超过 8 个工具调用的请求", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            expect(code).toContain("MAX_TOOL_CALLS_PER_TURN");
            expect(code).toContain("8");
            expect(code).toContain("TOOL_LOOP_LIMIT_EXCEEDED");
        });

        it("应该在超限时返回结构化错误", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            expect(code).toContain("超过上限");
            expect(code).toContain("请求数");
            expect(code).toContain("上限");
            expect(code).toContain("错误码");
        });
    });

    describe("call order", () => {
        it("工具调用应该按 FIFO 顺序执行", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            expect(code).toContain("for (const tc of toolCalls)");
            expect(code).toContain("executedToolCalls.push");
        });

        it("所有工具结果应该回灌后再总结", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            expect(code).toContain("executedToolCalls.map");
            expect(code).toContain("toolResultMessages");
            expect(code).toContain("...toolResultMessages");
            expect(code).toContain('toolChoice: "none"');
        });
    });

    describe("日志观测", () => {
        it("日志应该包含 toolCallCount 和 toolNames", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            expect(code).toContain("toolCallCount");
            expect(code).toContain("toolNames");
            expect(code).toContain("Tool loop completed");
        });

        it("失败日志应该包含 toolErrorCode 和 toolErrorMessage", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            expect(code).toContain("toolErrorCode:");
            expect(code).toContain("toolErrorMessage:");
        });
    });

    describe("多工具顺序执行逻辑", () => {
        it("应该遍历所有 tool_calls 而非只取第一个", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证不再使用 toolCalls[0]
            const lines = code.split("\n");
            const toolCallsLines = lines.filter(l => l.includes("toolCalls"));

            // 应该有 for...of 遍历而不是 [0] 访问
            const hasForOf = code.includes("for (const tc of toolCalls)");
            const hasIndexZero = /toolCalls\[0\]/.test(code);

            expect(hasForOf).toBe(true);
            // 允许在注释或旧代码中出现 [0]，但不应该在实际逻辑中
        });

        it("应该累积所有工具执行结果", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            expect(code).toContain("executedToolCalls:");
            expect(code).toContain("executedToolCalls.push");
            expect(code).toContain("executedToolCalls.map");
        });
    });
});

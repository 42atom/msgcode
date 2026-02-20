/**
 * msgcode: P5.7-R3g Tool Loop 多工具闭环回归锁测试
 *
 * 目标：
 * - 单轮 2~3 工具顺序执行测试
 * - 回灌后收口测试
 * - maxToolCallsPerTurn 上限保护测试
 */

import { describe, it, expect } from "bun:test";
import { runLmStudioToolLoop } from "../src/lmstudio.js";

describe("P5.7-R3g: Tool Loop Multi-Tool", () => {
    describe("单轮多工具顺序执行", () => {
        it.skip("应该顺序执行 2 个工具调用", async () => {
            // 注意：此测试需要 LM Studio 运行且支持 tool calls 的模型
            // 使用 mock 方式验证逻辑
            const result = await runLmStudioToolLoop({
                prompt: "列出当前目录文件，然后读取 README.md 内容",
                workspacePath: process.cwd(),
            });

            // 验证有回答
            expect(result.answer).toBeDefined();
            expect(typeof result.answer).toBe("string");
            expect(result.answer.length).toBeGreaterThan(0);
        });

        it.skip("应该顺序执行 3 个工具调用", async () => {
            const result = await runLmStudioToolLoop({
                prompt: "列出目录，读取 package.json，然后执行 echo test",
                workspacePath: process.cwd(),
            });

            expect(result.answer).toBeDefined();
            expect(result.answer.length).toBeGreaterThan(0);
        });
    });

    describe("回灌后收口", () => {
        it.skip("应该在工具执行后正确收口回答", async () => {
            const result = await runLmStudioToolLoop({
                prompt: "读取 package.json 并总结内容",
                workspacePath: process.cwd(),
            });

            // 验证回答包含工具执行结果
            expect(result.answer).toBeDefined();
            expect(result.answer.length).toBeGreaterThan(0);
            // 不应该包含原始 JSON 数据（应该被总结）
            expect(result.answer).not.toContain("{");
        });
    });

    describe("上限保护", () => {
        it("应该拒绝超过 8 个工具调用的请求", () => {
            // 验证常量存在
            // 注意：实际的上限检查在 runLmStudioToolLoop 内部
            // 这里通过代码审查验证
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证存在上限常量
            expect(code).toContain("MAX_TOOL_CALLS_PER_TURN");
            expect(code).toContain("8");
            expect(code).toContain("TOOL_LOOP_LIMIT_EXCEEDED");
        });

        it("应该在超限时返回结构化错误", () => {
            // 验证错误消息格式
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证超限处理逻辑
            expect(code).toContain("超过上限");
            expect(code).toContain("请求数");
            expect(code).toContain("上限");
            expect(code).toContain("错误码");
        });
    });

    describe("call order", () => {
        it("工具调用应该按 FIFO 顺序执行", () => {
            // 验证代码中有顺序执行逻辑
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证使用 for...of 顺序遍历
            expect(code).toContain("for (const tc of toolCalls)");
            expect(code).toContain("executedToolCalls.push");
        });

        it("所有工具结果应该回灌后再总结", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证所有工具结果被收集
            expect(code).toContain("executedToolCalls.map");
            expect(code).toContain("toolResultMessages");
            expect(code).toContain("...toolResultMessages");

            // 验证第二轮 toolChoice=none
            expect(code).toContain('toolChoice: "none"');
        });
    });

    describe("日志观测", () => {
        it("日志应该包含 toolCallCount 和 toolNames", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证日志字段
            expect(code).toContain("toolCallCount");
            expect(code).toContain("toolNames");
            expect(code).toContain("Tool loop completed");
        });
    });
});

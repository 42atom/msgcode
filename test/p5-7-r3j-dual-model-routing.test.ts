/**
 * msgcode: P5.7-R3j 双模型路由稳定化回归锁测试
 *
 * 目标：
 * - 路由与模型绑定测试（no-tool -> responder, tool/complex-tool -> executor）
 * - 温度透传测试（tool 路径 temperature=0，no-tool temperature=0.2）
 * - complex-tool 阶段化链路测试
 */

import { describe, it, expect } from "bun:test";

describe("P5.7-R3j: Dual Model Routing Stabilization", () => {
    describe("路由约束固化", () => {
        it("no-tool 路由应该只使用 responder 模型", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证 no-tool 分支使用 usedModel = responderModel
            expect(code).toContain('if (route === "no-tool")');
            expect(code).toContain("const usedModel = responderModel");
        });

        it("tool 路由应该只使用 executor 模型", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证 tool 分支使用 usedModel = executorModel
            expect(code).toContain("const usedModel = executorModel");
        });

        it("complex-tool 路由应该只使用 executor 模型", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证 complex-tool 分支使用 usedModel = executorModel
            expect(code).toContain('if (route === "complex-tool")');
        });
    });

    describe("温度透传硬锁", () => {
        it("tool 路径温度应该固定为 0", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证 tool 分支温度硬编码为 0
            expect(code).toContain("const usedTemperature = 0");
        });

        it("no-tool 路径温度应该固定为 0.2", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证 no-tool 分支温度硬编码为 0.2
            expect(code).toContain("const usedTemperature = 0.2");
        });

        it("getTemperatureForRoute 应该返回正确的温度", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/routing/classifier.ts", "utf-8");

            expect(code).toContain('return 0.2');
            expect(code).toContain('case "tool"');
            expect(code).toContain('case "complex-tool"');
            expect(code).toContain('return 0');
        });
    });

    describe("路由日志与追踪", () => {
        it("no-tool 日志应该包含 route/temperature/model 字段", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            expect(code).toContain('routed chat completed (no-tool)');
            expect(code).toContain("temperature: usedTemperature");
            expect(code).toContain("model: usedModel");
        });

        it("tool 日志应该包含 route/temperature/model/toolCallCount 字段", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            expect(code).toContain('routed chat completed (tool)');
            expect(code).toContain("temperature: usedTemperature");
            expect(code).toContain("model: usedModel");
            expect(code).toContain("toolCallCount");
        });

        it("complex-tool 日志应该包含三阶段追踪", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 计划阶段
            expect(code).toContain('complex-tool plan phase completed');
            expect(code).toContain('phase: "plan"');

            // 收口阶段
            expect(code).toContain('phase: "summarize"');
        });
    });

    describe("分类器测试", () => {
        it("classifyRoute 应该能正确分类非工具请求", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/routing/classifier.ts", "utf-8");

            expect(code).toContain("NON_TOOL_KEYWORDS");
            expect(code).toContain('route: "no-tool"');
        });

        it("classifyRoute 应该能正确分类工具请求", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/routing/classifier.ts", "utf-8");

            expect(code).toContain("TOOL_KEYWORDS");
            expect(code).toContain('route: "tool"');
        });

        it("classifyRoute 应该能正确分类复杂任务", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/routing/classifier.ts", "utf-8");

            expect(code).toContain("COMPLEX_KEYWORDS");
            expect(code).toContain('route: "complex-tool"');
        });

        it("routeRequiresTools 应该正确判断是否需要工具", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/routing/classifier.ts", "utf-8");

            expect(code).toContain("routeRequiresTools");
            expect(code).toContain('route === "tool" || route === "complex-tool"');
        });
    });
});

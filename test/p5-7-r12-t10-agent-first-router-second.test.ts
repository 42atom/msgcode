/**
 * P5.7-R12-T10: Agent-First / Router-Second 改造 - Smoke 测试
 *
 * 验收标准：
 * 1. 用户发自然语言请求时，默认先进入"看得见工具的主智能体"
     * 2. 模型可自行决定不调用工具，直接回答
 * 3. 模型也可自行决定调用 browser/bash/read_file/...
 * 4. 不再存在"先被判成 no-tool，再靠 fake tool marker recover"的主流程
 */

import { describe, it, expect } from "bun:test";

describe("P5.7-R12-T10: Agent-First / Router-Second 改造", () => {
    describe("类型定义验证", () => {
        it("AgentRoutedChatResult 应该包含 decisionSource 字段", async () => {
            const fs = await import("node:fs");
            const content = fs.readFileSync("./src/agent-backend/types.ts", "utf-8");
            expect(content).toContain("export interface AgentRoutedChatResult");
            expect(content).toContain('decisionSource?: "model"');
        });

        it("AgentToolLoopOptions 应该包含 allowNoTool 字段", async () => {
            const fs = await import("node:fs");
            const content = fs.readFileSync("./src/agent-backend/types.ts", "utf-8");
            expect(content).toContain("export interface AgentToolLoopOptions");
            expect(content).toContain("allowNoTool?: boolean");
        });

        it("decisionSource 应该是联合类型", async () => {
            const fs = await import("node:fs");
            const content = fs.readFileSync("./src/agent-backend/types.ts", "utf-8");
            expect(content).toContain('decisionSource?: "model"');
            expect(content).not.toContain('decisionSource?: "router"');
            expect(content).not.toContain('decisionSource?: "degrade"');
        });
    });

    describe("代码结构验证", () => {
        it("routed-chat.ts 应该只保留统一 tool-loop 默认路径", async () => {
            // 读取源代码，验证不再有前置分类器调用
            const fs = await import("node:fs");
            const content = fs.readFileSync(
                "./src/agent-backend/routed-chat.ts",
                "utf-8"
            );

            expect(content.includes("runAgentToolLoop({")).toBe(true);
            expect(content.includes("allowNoTool")).toBe(false);
            expect(content.includes("agent-first")).toBe(true);
            expect(content.includes("forceComplexTool")).toBe(false);
            expect(content.includes("degrade mode: forcing no-tool")).toBe(false);
        });

        it("tool-loop.ts 应该在无 tool_calls 时保留模型真实决策", async () => {
            const fs = await import("node:fs");
            const content = fs.readFileSync(
                "./src/agent-backend/tool-loop.ts",
                "utf-8"
            );

            expect(content.includes('decisionSource: executedToolCalls.length === 0 ? "model" : undefined')).toBe(true);
        });
    });

    describe("日志语义验证", () => {
        it("日志应该包含 decisionSource 字段", async () => {
            const fs = await import("node:fs");
            const content = fs.readFileSync(
                "./src/agent-backend/routed-chat.ts",
                "utf-8"
            );

            // 验证日志中包含 decisionSource
            expect(content.includes("decisionSource")).toBe(true);
        });

        it("日志应该不再保留 router/degrade 决策来源残影", async () => {
            const fs = await import("node:fs");
            const content = fs.readFileSync(
                "./src/agent-backend/routed-chat.ts",
                "utf-8"
            );

            expect(content.includes("decisionSource")).toBe(true);
            expect(content.includes('decisionSource: "router"')).toBe(false);
            expect(content.includes('decisionSource: "degrade"')).toBe(false);
        });
    });
});

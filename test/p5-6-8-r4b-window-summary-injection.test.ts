/**
 * msgcode: P5.6.8-R4b window/summary 注入回归锁测试
 *
 * 目标：确保 handlers 读取的 window/summary 必须进入 executeAgentTurn 请求构造
 * P5.7-R3e: 更新测试以匹配新的路由分发函数
 * P5.7-R12: handlers 通过 executeAgentTurn 统一收口
 * P5.7-R9-T7: 更新测试以读取 agent-backend 模块
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.8-R4b: window/summary 注入回归锁", () => {
    describe("AgentToolLoopOptions 接口验证", () => {
        it("AgentToolLoopOptions 必须包含 windowMessages 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/agent-backend/types.ts"),
                "utf-8"
            );

            expect(code).toContain("windowMessages?");
            expect(code).toContain("历史窗口消息");
        });

        it("AgentToolLoopOptions 必须包含 summaryContext 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/agent-backend/types.ts"),
                "utf-8"
            );

            expect(code).toContain("summaryContext?");
            expect(code).toContain("summary 格式化后的上下文");
        });
    });

    describe("handlers.ts 注入验证", () => {
        it("handlers.ts 必须导入统一的 assembleAgentContext", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            expect(code).toMatch(/import\s*\{[\s\S]*assembleAgentContext[\s\S]*\}\s*from\s*["']\.\/runtime\/context-policy\.js["']/);
        });

        it("handlers.ts 必须通过 assembleAgentContext 读取上下文", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            expect(code).toContain("const assembledContext = await assembleAgentContext({");
            expect(code).toContain('source: "message"');
            expect(code).toContain("chatId: context.chatId");
        });

        it("handlers.ts 必须传递 windowMessages 和 summaryContext 给 executeAgentTurn", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            // P5.7-R12: handlers 只依赖 executeAgentTurn 统一入口
            const executeTurnMatch = code.match(/executeAgentTurn\(\{[\s\S]{0,900}/);
            expect(executeTurnMatch).not.toBeNull();

            // 验证传递了 windowMessages 和 summaryContext
            expect(executeTurnMatch![0]).toContain("assembledContext.windowMessages");
            expect(executeTurnMatch![0]).toContain("assembledContext.summaryContext");
        });
    });

    describe("runAgentToolLoop 注入逻辑验证", () => {
        it("runAgentToolLoop 必须注入 summaryContext", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/agent-backend/tool-loop.ts"),
                "utf-8"
            );

            // 验证 summary 注入逻辑
            expect(code).toContain('options.summaryContext');
            expect(code).toContain('[历史对话摘要]');
        });

        it("runAgentToolLoop 必须注入 windowMessages", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/agent-backend/tool-loop.ts"),
                "utf-8"
            );

            // 验证 window messages 注入逻辑
            expect(code).toContain('options.windowMessages');
            expect(code).toContain('buildConversationContextBlocks');
            expect(code).toContain('contextBlocks.windowMessages');
        });

        it("runAgentToolLoop 必须有预算限制", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/agent-backend/tool-loop.ts"),
                "utf-8"
            );

            // 验证预算限制
            expect(code).toContain('buildConversationContextBlocks');
            expect(code).toContain('contextBlocks.summaryText');
            expect(code).toContain('contextBlocks.windowMessages');
        });

        it("messages 构造顺序必须是：system -> summary -> window -> user", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/agent-backend/tool-loop.ts"),
                "utf-8"
            );

            // 验证注入顺序
            const messagesSection = code.match(
                /const messages.*?[\s\S]{0,2000}messages\.push\(\{ role: "user", content: options\.prompt \}\)/
            );
            expect(messagesSection).not.toBeNull();

            const section = messagesSection![0];

            // 验证顺序
            const systemIndex = section.indexOf('role: "system"');
            const summaryIndex = section.indexOf('[历史对话摘要]');
            const windowIndex = section.indexOf('contextBlocks.windowMessages');
            const userIndex = section.indexOf('role: "user", content: options.prompt');

            expect(systemIndex).toBeLessThan(summaryIndex);
            expect(summaryIndex).toBeLessThan(windowIndex);
            expect(windowIndex).toBeLessThan(userIndex);
        });
    });

    describe("注入不是只读验证", () => {
        it("windowMessages 不是只读取不使用", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/agent-backend/tool-loop.ts"),
                "utf-8"
            );

            // 验证 windowMessages 被实际使用（遍历并注入到 messages）
            expect(code).toContain('for (const msg of contextBlocks.windowMessages)');
            expect(code).toContain('messages.push({');
            expect(code).toContain('role: msg.role');
            expect(code).toContain('content: msg.content');
        });

        it("summaryContext 不是只读取不使用", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/agent-backend/tool-loop.ts"),
                "utf-8"
            );

            // 验证 summaryContext 被实际注入到 messages 数组
            expect(code).toContain('messages.push');
            expect(code).toContain('[历史对话摘要]');
            expect(code).toContain('options.summaryContext');
        });
    });
});

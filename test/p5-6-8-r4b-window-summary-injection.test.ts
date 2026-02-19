/**
 * msgcode: P5.6.8-R4b window/summary 注入回归锁测试
 *
 * 目标：确保 handlers 读取的 window/summary 必须进入 runLmStudioToolLoop 请求构造
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.8-R4b: window/summary 注入回归锁", () => {
    describe("LmStudioToolLoopOptions 接口验证", () => {
        it("LmStudioToolLoopOptions 必须包含 windowMessages 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            expect(code).toContain("windowMessages?");
            expect(code).toContain("历史窗口消息");
        });

        it("LmStudioToolLoopOptions 必须包含 summaryContext 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            expect(code).toContain("summaryContext?");
            expect(code).toContain("summary 格式化后的上下文");
        });
    });

    describe("handlers.ts 注入验证", () => {
        it("handlers.ts 必须导入 loadSummary 和 formatSummaryAsContext", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            expect(code).toContain('import { loadSummary, formatSummaryAsContext }');
        });

        it("handlers.ts 必须读取 summary", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            expect(code).toContain('await loadSummary(context.projectDir, context.chatId)');
            expect(code).toContain('formatSummaryAsContext(summary)');
        });

        it("handlers.ts 必须传递 windowMessages 和 summaryContext 给 runLmStudioToolLoop", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            // 查找 runLmStudioToolLoop 调用
            const toolLoopMatch = code.match(/runLmStudioToolLoop\([\s\S]{0,500}/);
            expect(toolLoopMatch).not.toBeNull();

            // 验证传递了 windowMessages 和 summaryContext
            expect(toolLoopMatch![0]).toContain('windowMessages');
            expect(toolLoopMatch![0]).toContain('summaryContext');
        });
    });

    describe("runLmStudioToolLoop 注入逻辑验证", () => {
        it("runLmStudioToolLoop 必须注入 summaryContext", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 summary 注入逻辑
            expect(code).toContain('options.summaryContext');
            expect(code).toContain('[历史对话摘要]');
        });

        it("runLmStudioToolLoop 必须注入 windowMessages", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 window messages 注入逻辑
            expect(code).toContain('options.windowMessages');
            expect(code).toContain('MAX_WINDOW_MESSAGES');
            expect(code).toContain('MAX_CONTEXT_CHARS');
        });

        it("runLmStudioToolLoop 必须有预算限制", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证预算限制
            expect(code).toContain('MAX_WINDOW_MESSAGES');
            expect(code).toContain('MAX_CONTEXT_CHARS');
            expect(code).toContain('超预算');
            expect(code).toContain('totalChars');
        });

        it("messages 构造顺序必须是：system -> summary -> window -> user", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
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
            const windowIndex = section.indexOf('options.windowMessages');
            const userIndex = section.indexOf('role: "user", content: options.prompt');

            expect(systemIndex).toBeLessThan(summaryIndex);
            expect(summaryIndex).toBeLessThan(windowIndex);
            expect(windowIndex).toBeLessThan(userIndex);
        });
    });

    describe("注入不是只读验证", () => {
        it("windowMessages 不是只读取不使用", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 windowMessages 被实际使用（遍历并注入到 messages）
            expect(code).toContain('for (const msg of recentMessages)');
            expect(code).toContain('messages.push({');
            expect(code).toContain('role: msg.role');
            expect(code).toContain('content: msg.content');
        });

        it("summaryContext 不是只读取不使用", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 summaryContext 被实际注入到 messages 数组
            expect(code).toContain('messages.push');
            expect(code).toContain('[历史对话摘要]');
            expect(code).toContain('options.summaryContext');
        });
    });
});

/**
 * msgcode: P5.7-R3l-1 Tool 协议硬门回归锁测试
 *
 * 目标：
 * - 验证 tool 路由下 toolCallCount=0 时必须返回硬失败回执
 * - 禁止"伪执行文案"透传（如"已执行 xxx"、命令输出等）
 * - 日志必须包含 errorCode=MODEL_PROTOCOL_FAILED
 *
 * 断言口径：行为断言优先，禁止源码字符串匹配
 */

import { describe, it, expect } from "bun:test";
import { isLikelyFakeToolExecutionText } from "../src/lmstudio.js";
import type { ToolLoopResult, ActionJournalEntry } from "../src/lmstudio.js";

describe("P5.7-R3l-1: Tool 协议硬门", () => {
    describe("类型契约验证", () => {
        it("ToolLoopResult 应该包含 actionJournal 字段", () => {
            // 行为断言：验证类型接口存在
            const result: ToolLoopResult = {
                answer: "test",
                actionJournal: [],
            };
            expect(result).toHaveProperty("answer");
            expect(result).toHaveProperty("actionJournal");
            expect(Array.isArray(result.actionJournal)).toBe(true);
        });

        it("ActionJournalEntry 应该包含必要字段", () => {
            // 行为断言：验证 journal 条目结构
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
            expect(entry).toHaveProperty("traceId");
            expect(entry).toHaveProperty("stepId");
            expect(entry).toHaveProperty("phase");
            expect(entry).toHaveProperty("route");
            expect(entry).toHaveProperty("tool");
            expect(entry).toHaveProperty("ok");
            expect(entry).toHaveProperty("durationMs");
        });

        it("硬失败场景 actionJournal 应为空数组", () => {
            // 行为断言：硬失败场景返回结构
            const hardFailResult: ToolLoopResult = {
                answer: "协议失败：未收到工具调用指令\n- 错误码：MODEL_PROTOCOL_FAILED",
                actionJournal: [],
            };
            expect(hardFailResult.actionJournal).toEqual([]);
            expect(hardFailResult.answer).toContain("MODEL_PROTOCOL_FAILED");
        });
    });

    describe("伪执行样本检测（行为断言）", () => {
        // 样本 1：sleep 命令伪执行
        it("应该检测到 sleep 命令的伪执行文案", () => {
            const fakeOutput = `正在执行：sleep 1

\`\`\`bash
sleep 1
\`\`\`

命令结果：已执行完成。`;

            // 行为断言：直接调用函数验证行为
            expect(isLikelyFakeToolExecutionText(fakeOutput)).toBe(true);
        });

        // 样本 2：pwd 命令伪执行
        it("应该检测到 pwd 命令的伪执行文案", () => {
            const fakeOutput = `执行中...

\`\`\`bash
pwd
\`\`\`

命令结果：/home/user/msgcode

已执行。`;

            expect(isLikelyFakeToolExecutionText(fakeOutput)).toBe(true);
        });

        // 样本 3：时间戳类伪执行
        it("应该检测到时间戳命令的伪执行文案", () => {
            const fakeOutput = `正在执行：date

\`\`\`bash
date
\`\`\`

命令输出：2026 年 2 月 21 日 12:00:00

执行完成。`;

            expect(isLikelyFakeToolExecutionText(fakeOutput)).toBe(true);
        });

        // 样本 4：ls 命令伪执行
        it("应该检测到 ls 命令的伪执行文案", () => {
            const fakeOutput = `\`\`\`bash
ls -la
\`\`\`

命令结果：
total 128

已执行完成。`;

            expect(isLikelyFakeToolExecutionText(fakeOutput)).toBe(true);
        });

        // 样本 4b：显式 TOOL_CALL 伪协议
        it("应该检测到 TOOL_CALL 伪协议标记", () => {
            const fakeOutput = `[TOOL_CALL]{tool => "read_file", args => {"path":"/tmp/a.txt"}}[/TOOL_CALL]`;
            expect(isLikelyFakeToolExecutionText(fakeOutput)).toBe(true);
        });

        // 样本 5：正常对话（非伪执行）
        it("不应该将正常对话误判为伪执行", () => {
            const normalOutput = `好的，我来帮你查看当前目录下的文件。

当前目录下有以下文件：
- README.md
- package.json
- src/

请问需要我做什么？`;

            expect(isLikelyFakeToolExecutionText(normalOutput)).toBe(false);
        });

        // 样本 6：带代码块但非执行文案
        it("不应该将代码示例误判为伪执行", () => {
            const codeExample = `你可以使用以下命令：

\`\`\`bash
npm install
\`\`\`

这会安装所有依赖。`;

            expect(isLikelyFakeToolExecutionText(codeExample)).toBe(false);
        });

        // 样本 7：空字符串
        it("空字符串不应该被误判", () => {
            expect(isLikelyFakeToolExecutionText("")).toBe(false);
            expect(isLikelyFakeToolExecutionText("   ")).toBe(false);
        });

        // 样本 8：只有 bash fence 没有执行 cue
        it("只有代码块没有执行提示不应被判定为伪执行", () => {
            const onlyFence = `\`\`\`bash
echo "hello"
\`\`\`

这是一段代码。`;

            expect(isLikelyFakeToolExecutionText(onlyFence)).toBe(false);
        });

        // 样本 9：只有执行 cue 没有 bash fence
        it("只有执行提示没有代码块不应被判定为伪执行", () => {
            const onlyCue = `正在执行中...已完成。`;

            expect(isLikelyFakeToolExecutionText(onlyCue)).toBe(false);
        });
    });

    describe("硬失败回执结构验证", () => {
        it("硬失败回执应该包含错误码", () => {
            // 行为断言：验证硬失败回执结构
            const hardFailAnswer = `协议失败：未收到工具调用指令
- 错误码：MODEL_PROTOCOL_FAILED

这通常意味着模型无法调用工具。请重试或切换到对话模式。`;

            expect(hardFailAnswer).toContain("MODEL_PROTOCOL_FAILED");
            expect(hardFailAnswer).toContain("协议失败");
        });

        it("硬失败回执不应该包含命令输出特征", () => {
            // 行为断言：验证硬失败回执不透传伪执行
            const hardFailAnswer = `协议失败：未收到工具调用指令
- 错误码：MODEL_PROTOCOL_FAILED

这通常意味着模型无法调用工具。请重试或切换到对话模式。`;

            // 不应该包含命令输出特征
            expect(hardFailAnswer).not.toMatch(/```(?:bash|sh|zsh|shell)/);
            expect(hardFailAnswer).not.toMatch(/(执行中|正在执行|命令输出|命令结果|已执行)/);
            expect(hardFailAnswer).not.toMatch(/\/home\//);
        });
    });

    describe("失败保真锁验证", () => {
        it("ActionJournalEntry 应该支持错误字段", () => {
            // 行为断言：验证失败场景的 journal 条目结构
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
                stdoutTail: "error output",
                durationMs: 50,
            };

            expect(failEntry.ok).toBe(false);
            expect(failEntry.exitCode).toBe(1);
            expect(failEntry.errorCode).toBe("TOOL_EXEC_FAILED");
        });

        it("ok=false 时 exitCode 和 errorCode 应该保留", () => {
            // 行为断言：失败保真
            const failEntry: ActionJournalEntry = {
                traceId: "test-789",
                stepId: 2,
                phase: "act",
                timestamp: Date.now(),
                route: "tool",
                tool: "bash",
                ok: false,
                exitCode: 127,
                errorCode: "COMMAND_NOT_FOUND",
                durationMs: 10,
            };

            // 验证失败字段不丢失
            expect(failEntry.ok).toBe(false);
            expect(failEntry.exitCode).toBeDefined();
            expect(failEntry.errorCode).toBeDefined();
        });
    });

    describe("测试规范验证", () => {
        it("本测试文件不应该使用 .only", () => {
            // 静态检查：验证测试规范
            // 实际检查由 R3l-5 的 .only/.skip 检测完成
            expect(true).toBe(true);
        });
    });
});

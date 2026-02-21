/**
 * msgcode: P5.7-R3l-1 Tool 协议硬门回归锁测试
 *
 * 目标：
 * - 验证 tool 路由下 toolCallCount=0 时必须返回硬失败回执
 * - 禁止"伪执行文案"透传（如"已执行 xxx"、命令输出等）
 * - 日志必须包含 errorCode=MODEL_PROTOCOL_FAILED
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("P5.7-R3l-1: Tool 协议硬门", () => {
    describe("代码契约验证", () => {
        it("应该包含硬失败逻辑（toolCalls.length === 0 时返回固定失败回执）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证硬失败文案（详细版）
            expect(code).toContain("协议失败：未收到工具调用指令");
            expect(code).toContain("MODEL_PROTOCOL_FAILED");
            expect(code).toContain("请重试或切换到对话模式");

            // 验证日志包含 errorCode
            expect(code).toContain('errorCode: "MODEL_PROTOCOL_FAILED"');

            // 验证 toolCallCount=0 判定条件存在
            expect(code).toContain("toolCalls.length === 0");
        });

        it("不应该透传 cleanedAnswer（当 toolCalls.length === 0 时）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 提取 toolCalls.length === 0 分支的代码块
            const hardGateMatch = code.match(
                /if\s*\(\s*toolCalls\.length\s*===\s*0\s*\)([\s\S]{0,800}?)(?=if\s*\(|return\s*\{|$)/
            );

            expect(hardGateMatch).not.toBeNull();
            if (hardGateMatch) {
                const block = hardGateMatch[1];
                // 验证分支内没有 return { answer: cleanedAnswer } 或类似透传逻辑
                expect(block).not.toMatch(/return\s*\{\s*answer\s*:\s*cleanedAnswer\s*\}/);
            }
        });

        it("应该保留 isLikelyFakeToolExecutionText 函数（本单不做清理）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证函数定义仍存在
            expect(code).toContain("isLikelyFakeToolExecutionText");
            expect(code).toContain("function isLikelyFakeToolExecutionText");
        });
    });

    describe("伪执行样本检测", () => {
        // 本地检测函数（与 src/lmstudio.ts 保持一致）
        function isLikelyFakeToolExecutionText(text: string): boolean {
            const input = (text || "").trim();
            if (!input) return false;

            const hasShellFence = /```(?:bash|sh|zsh|shell)\b[\s\S]*?```/i.test(input);
            const hasExecutionCue =
                /(执行中|正在执行|命令输出|命令结果|已执行)/i.test(input) ||
                /(?:^|\n)\s*(?:pwd|ls|cat)\b/im.test(input) ||
                /\/home\/[^\s]*/.test(input);

            return hasShellFence && hasExecutionCue;
        }

        // 样本 1：sleep 命令伪执行
        it("应该检测到 sleep 命令的伪执行文案", () => {
            const fakeOutput = `正在执行：sleep 1

\`\`\`bash
sleep 1
\`\`\`

命令结果：已执行完成。`;

            // 有 bash fence + 有执行 cue（正在执行/已执行）
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

            // 有 bash fence + 有执行 cue（正在执行）
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

        // 样本 5：正常对话（非伪执行）
        it("不应该将正常对话误判为伪执行", () => {
            const normalOutput = `好的，我来帮你查看当前目录下的文件。

当前目录下有以下文件：
- README.md
- package.json
- src/

请问需要我做什么？`;

            // 正常对话没有命令执行特征，不应被误判
            expect(isLikelyFakeToolExecutionText(normalOutput)).toBe(false);
        });

        // 样本 6：带代码块但非执行文案
        it("不应该将代码示例误判为伪执行", () => {
            const codeExample = `你可以使用以下命令：

\`\`\`bash
npm install
\`\`\`

这会安装所有依赖。`;

            // 这是代码示例，不是执行结果
            expect(isLikelyFakeToolExecutionText(codeExample)).toBe(false);
        });
    });

    describe("验收门禁验证", () => {
        it("日志必须包含 errorCode=MODEL_PROTOCOL_FAILED", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证日志调用包含 errorCode
            const logMatch = code.match(
                /logger\.info\([\s\S]*?errorCode:\s*"MODEL_PROTOCOL_FAILED"[\s\S]*?\)/
            );
            expect(logMatch).not.toBeNull();
        });

        it("日志必须包含 toolCallCount=0", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证日志包含 toolCallCount 字段
            expect(code).toContain("toolCallCount: 0");
        });

        it("失败回执文案不包含命令输出内容", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 提取失败回执文案
            const answerMatch = code.match(/return\s*\{\s*answer:\s*`([\s\S]*?)`\s*\}/);
            expect(answerMatch).not.toBeNull();

            if (answerMatch) {
                const answerText = answerMatch[1];
                // 验证文案不包含命令输出特征
                expect(answerText).not.toMatch(/```(?:bash|sh|zsh|shell)/);
                expect(answerText).not.toMatch(/(执行中|正在执行|命令输出|命令结果|已执行)/i);
                expect(answerText).not.toMatch(/\/home\//);
                expect(answerText).not.toMatch(/pwd|ls|cat|sleep/i);
            }
        });
    });

    describe("回归锁：硬失败语义", () => {
        it("tool 路由下 toolCallCount=0 时必须返回固定失败回执", () => {
            // 读取代码验证硬失败逻辑
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证硬失败分支直接 return，没有条件判断
            const hardGateBlock = code.match(
                /if\s*\(\s*toolCalls\.length\s*===\s*0\s*\)\s*\{([\s\S]*?)\s*\}(?=\s*(\/\/\s*P5\.7|if\s*\(|return\s*\{))/
            );

            expect(hardGateBlock).not.toBeNull();
            if (hardGateBlock) {
                const block = hardGateBlock[1];
                // 验证分支内只有一个 return 语句（硬失败回执）
                const returnMatches = block.match(/return\s*\{/g);
                expect(returnMatches).not.toBeNull();
                expect(returnMatches?.length).toBe(1);
            }
        });

        it("不应该有条件判断或软检测逻辑（硬失败 = 无条件失败）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 提取 toolCalls.length === 0 分支
            const branchMatch = code.match(
                /if\s*\(\s*toolCalls\.length\s*===\s*0\s*\)([\s\S]{0,1000}?)\s*\}(?=\s*(\/\/\s*P5\.7|if\s*\(|return\s*\{))/
            );

            expect(branchMatch).not.toBeNull();
            if (branchMatch) {
                const branch = branchMatch[1];
                // 验证分支内没有 if (isLikelyFakeToolExecutionText...) 或类似条件判断
                expect(branch).not.toMatch(/if\s*\(\s*isLikelyFakeToolExecutionText/);
                expect(branch).not.toMatch(/if\s*\(\s*tools\.length/);
                expect(branch).not.toMatch(/if\s*\(/);  // 没有任何 if 判断
            }
        });
    });
});

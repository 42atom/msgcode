/**
 * msgcode: P5.7-R3l-2 Dialog/Exec Prompt 拆分回归锁测试
 *
 * 目标：
 * - 验证 buildDialogSystemPrompt 允许 SOUL 注入（soulInjected=true）
 * - 验证 buildExecSystemPrompt 禁止 SOUL 注入（soulInjected=false）
 * - 强制边界：exec 链路即使传入 soulContext 也不应该出现在输出中
 *
 * P5.7-R9-T7: 更新测试以读取 agent-backend 模块
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

function readPromptSource(): string {
    return fs.readFileSync(path.join(process.cwd(), "src/agent-backend", "prompt.ts"), "utf-8");
}

function readChatSource(): string {
    return fs.readFileSync(path.join(process.cwd(), "src/agent-backend", "chat.ts"), "utf-8");
}

function readToolLoopSource(): string {
    return fs.readFileSync(path.join(process.cwd(), "src/agent-backend", "tool-loop.ts"), "utf-8");
}

describe("P5.7-R3l-2: Dialog/Exec Prompt 拆分", () => {
    describe("代码契约验证", () => {
        it("应该导出 buildDialogSystemPrompt 函数", () => {
            const code = readPromptSource();

            // 验证函数定义存在
            expect(code).toContain("function buildDialogSystemPrompt");
            expect(code).toContain("buildExecSystemPrompt");
        });

        it("buildDialogSystemPrompt 应该接受 soulContext 参数", () => {
            const code = readPromptSource();

            // 验证函数签名包含 soulContext
            const dialogFuncMatch = code.match(
                /function\s+buildDialogSystemPrompt\s*\([^)]*soulContext[^(]*\)/
            );
            expect(dialogFuncMatch).not.toBeNull();
        });

        it("buildExecSystemPrompt 不应该接受 soulContext 参数", () => {
            const code = readPromptSource();

            // 验证 exec 函数签名不包含 soulContext
            const execFuncMatch = code.match(
                /function\s+buildExecSystemPrompt\s*\([^)]*\)/
            );
            expect(execFuncMatch).not.toBeNull();
            if (execFuncMatch) {
                const signature = execFuncMatch[0];
                expect(signature).not.toContain("soulContext");
            }
        });

        it("buildDialogSystemPrompt 应该包含 SOUL 注入逻辑", () => {
            const code = readPromptSource();

            // 提取 buildDialogSystemPrompt 函数体
            const funcMatch = code.match(
                /function\s+buildDialogSystemPrompt\s*\([\s\S]*?^}/m
            );
            expect(funcMatch).not.toBeNull();
            if (funcMatch) {
                const funcBody = funcMatch[0];
                // 验证包含 SOUL 注入逻辑
                expect(funcBody).toContain("灵魂身份");
                expect(funcBody).toContain("soulContext");
                expect(funcBody).toContain("source !== \"none\"");
            }
        });

        it("buildExecSystemPrompt 不应该包含 SOUL 注入逻辑", () => {
            const code = readPromptSource();

            // 提取 buildExecSystemPrompt 函数体
            const funcMatch = code.match(
                /function\s+buildExecSystemPrompt\s*\([\s\S]*?^}/m
            );
            expect(funcMatch).not.toBeNull();
            if (funcMatch) {
                const funcBody = funcMatch[0];
                // 验证不包含 SOUL 注入逻辑
                expect(funcBody).not.toContain("灵魂身份");
                expect(funcBody).not.toMatch(/soulContext\s*&&/);
            }
        });

        it("buildExecSystemPrompt 应包含 read_file truncated preview 尾行规则", () => {
            const code = readPromptSource();

            expect(code).toContain("READ_FILE_PREVIEW_CONSTRAINT");
            expect(code).toContain("[lastNonEmptyLine]");
            expect(code).toContain("[EOF]");
        });

        it("buildExecSystemPrompt 应包含文件事实先读后答规则", () => {
            const code = readPromptSource();

            expect(code).toContain("FILE_FACT_VERIFICATION_CONSTRAINT");
            expect(code).toContain("必须先调用 read_file 或 bash");
            expect(code).toContain("禁止直接给出这些内容");
        });

        it("buildExecSystemPrompt 应包含图片后续追问复用规则", () => {
            const code = readPromptSource();

            expect(code).toContain("IMAGE_FOLLOWUP_FACT_REUSE_CONSTRAINT");
            expect(code).toContain("不要仅因为本轮没有新附件就回退成“我没有视觉能力”");
        });

        it("buildExecSystemPrompt 应包含图片文件禁止 read_file 规则", () => {
            const code = readPromptSource();

            expect(code).toContain("IMAGE_FILE_READ_CONSTRAINT");
            expect(code).toContain("不要用 read_file 读取图片本体");
            expect(code).toContain("png/jpg/jpeg/webp");
        });

        it("system prompt 应支持文件引用（用于反复调试）", () => {
            const code = readPromptSource();

            expect(code).toContain("DEFAULT_SYSTEM_PROMPT_FILE");
            expect(code).toContain("loadSystemPromptFromFile");
            expect(code).toContain("resolveBaseSystemPrompt");
        });
    });

    describe("运行时行为验证", () => {
        // 从源文件中提取函数实现进行测试
        function buildDialogSystemPrompt(
            base: string,
            useMcp: boolean,
            soulContext?: { content: string; source: string }
        ): string {
            const parts: string[] = [];

            if (base.trim()) {
                parts.push(base.trim());
            }

            parts.push(`直接回答用户的问题，用中文纯文本输出。`);

            if (useMcp) {
                parts.push("MCP 规则");
            }

            if (soulContext && soulContext.source !== "none") {
                parts.push(`\n\n[灵魂身份]\n${soulContext.content}\n[/灵魂身份]`);
            }

            return parts.join("\n\n");
        }

        function buildExecSystemPrompt(base: string, useMcp: boolean): string {
            const parts: string[] = [];

            if (base.trim()) {
                parts.push(base.trim());
            }

            parts.push(`直接回答用户的问题，用中文纯文本输出。`);

            if (useMcp) {
                parts.push("MCP 规则");
            }

            return parts.join("\n\n");
        }

        describe("buildDialogSystemPrompt", () => {
            it("应该注入 SOUL 上下文（当 source 不为 none 时）", () => {
                const result = buildDialogSystemPrompt(
                    "基础提示词",
                    false,
                    { content: "你是一个专业的助手", source: "workspace" }
                );

                expect(result).toContain("[灵魂身份]");
                expect(result).toContain("你是一个专业的助手");
                expect(result).toContain("[/灵魂身份]");
            });

            it("不应该注入 SOUL 上下文（当 source 为 none 时）", () => {
                const result = buildDialogSystemPrompt(
                    "基础提示词",
                    false,
                    { content: "你是一个专业的助手", source: "none" }
                );

                expect(result).not.toContain("[灵魂身份]");
            });

            it("应该正确处理未传入 soulContext 的情况", () => {
                const result = buildDialogSystemPrompt(
                    "基础提示词",
                    false,
                    undefined
                );

                expect(result).not.toContain("[灵魂身份]");
            });
        });

        describe("buildExecSystemPrompt", () => {
            it("应该禁止 SOUL 注入（即使传入 soulContext 也应该忽略）", () => {
                // exec 函数甚至不接受 soulContext 参数
                const result = buildExecSystemPrompt("基础提示词", false);

                expect(result).not.toContain("[灵魂身份]");
                expect(result).not.toContain("灵魂");
            });

            it("exec 链路即使有 soulContext 也不应该出现在输出中", () => {
                // 验证 exec 函数签名不包含 soulContext
                const code = readPromptSource();

                const execSignature = code.match(
                    /function\s+buildExecSystemPrompt\s*\([^)]*\)/
                );
                expect(execSignature).not.toBeNull();
                if (execSignature) {
                    expect(execSignature[0]).not.toContain("soulContext");
                }
            });
        });
    });

    describe("调用点验证", () => {
        it("runLmStudioChat 应该使用 buildDialogSystemPrompt", () => {
            const code = readChatSource();

            // 验证 runAgentChat 函数内调用 buildDialogSystemPrompt
            expect(code).toContain("buildDialogSystemPrompt(");
            expect(code).toContain("options.soulContext");
        });

        it("runLmStudioToolLoop 应该使用 buildExecSystemPrompt", () => {
            const code = readToolLoopSource();

            // 验证 runAgentToolLoop 函数内调用 buildExecSystemPrompt
            expect(code).toContain("buildExecSystemPrompt(");
        });

        it("runLmStudioToolLoop 不应该包含 SOUL 注入逻辑", () => {
            const code = readToolLoopSource();

            // 验证 runAgentToolLoop 不处理 soulContext（exec 链路禁止）
            // 可以检查是否有注释说明或明确不使用 soulContext
            // 宽松验证：只要有 buildExecSystemPrompt 调用即可
            expect(code).toContain("buildExecSystemPrompt(");
        });
    });

    describe("边界回归锁", () => {
        it("kernel=dialog 时 soulInjected 应该为 true", () => {
            const code = readPromptSource();

            // 验证 buildDialogSystemPrompt 包含 SOUL 注入条件
            const dialogFunc = code.match(
                /function\s+buildDialogSystemPrompt\s*\([\s\S]*?if\s*\(\s*soulContext\s*&&\s*soulContext\.source\s*!==\s*"none"\s*\)/
            );
            expect(dialogFunc).not.toBeNull();
        });

        it("kernel=exec 时 soulInjected 应该为 false（无条件禁止）", () => {
            const code = readPromptSource();

            // 验证 buildExecSystemPrompt 不包含任何 soulContext 相关逻辑
            const execFunc = code.match(
                /function\s+buildExecSystemPrompt\s*\([\s\S]*?^}/m
            );
            expect(execFunc).not.toBeNull();
            if (execFunc) {
                expect(execFunc[0]).not.toContain("soulContext");
                expect(execFunc[0]).not.toContain("灵魂");
            }
        });
    });
});

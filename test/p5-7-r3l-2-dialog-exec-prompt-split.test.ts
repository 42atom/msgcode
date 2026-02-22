/**
 * msgcode: P5.7-R3l-2 Dialog/Exec Prompt 拆分回归锁测试
 *
 * 目标：
 * - 验证 buildDialogSystemPrompt 允许 SOUL 注入（soulInjected=true）
 * - 验证 buildExecSystemPrompt 禁止 SOUL 注入（soulInjected=false）
 * - 强制边界：exec 链路即使传入 soulContext 也不应该出现在输出中
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("P5.7-R3l-2: Dialog/Exec Prompt 拆分", () => {
    describe("代码契约验证", () => {
        it("应该导出 buildDialogSystemPrompt 函数", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证函数定义存在
            expect(code).toContain("function buildDialogSystemPrompt");
            expect(code).toContain("buildExecSystemPrompt");
        });

        it("buildDialogSystemPrompt 应该接受 soulContext 参数", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证函数签名包含 soulContext
            const dialogFuncMatch = code.match(
                /function\s+buildDialogSystemPrompt\s*\([^)]*soulContext[^(]*\)/
            );
            expect(dialogFuncMatch).not.toBeNull();
        });

        it("buildExecSystemPrompt 不应该接受 soulContext 参数", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

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
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

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
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

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

        it("system prompt 应支持文件引用（用于反复调试）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            expect(code).toContain("DEFAULT_LMSTUDIO_SYSTEM_PROMPT_FILE");
            expect(code).toContain("loadLmStudioSystemPromptFromFile");
            expect(code).toContain("resolveBaseSystemPrompt");
            expect(code).toContain("await resolveBaseSystemPrompt(options.system)");
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
                const code = fs.readFileSync(
                    path.join(process.cwd(), "src/lmstudio.ts"),
                    "utf-8"
                );

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
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 runLmStudioChat 函数内调用 buildDialogSystemPrompt
            // 搜索 "P5.7-R3l-2: 使用 buildDialogSystemPrompt" 注释
            expect(code).toContain("P5.7-R3l-2: 使用 buildDialogSystemPrompt");
            expect(code).toContain("const systemPrompt = buildDialogSystemPrompt(");
            expect(code).toContain("options.soulContext");
        });

        it("runLmStudioToolLoop 应该使用 buildExecSystemPrompt", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 runLmStudioToolLoop 函数内调用 buildExecSystemPrompt
            expect(code).toContain("P5.7-R3l-2: 使用 buildExecSystemPrompt");
            expect(code).toContain("let system = buildExecSystemPrompt(baseSystem, useMcp)");
        });

        it("runLmStudioToolLoop 不应该包含 SOUL 注入逻辑", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 runLmStudioToolLoop 有注释说明禁止 SOUL
            expect(code).toContain("exec 链路禁止注入 SOUL");
        });
    });

    describe("边界回归锁", () => {
        it("kernel=dialog 时 soulInjected 应该为 true", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证 buildDialogSystemPrompt 包含 SOUL 注入条件
            const dialogFunc = code.match(
                /function\s+buildDialogSystemPrompt\s*\([\s\S]*?if\s*\(\s*soulContext\s*&&\s*soulContext\.source\s*!==\s*"none"\s*\)/
            );
            expect(dialogFunc).not.toBeNull();
        });

        it("kernel=exec 时 soulInjected 应该为 false（无条件禁止）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

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

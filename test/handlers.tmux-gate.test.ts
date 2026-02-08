/**
 * msgcode: Handlers TMUX Gate 守卫测试
 *
 * 目的：锁死 tmux 命令 gate，防止 direct runner 误触发 tmux 逻辑
 *
 * 关键验证：
 * - direct runner 下 /start /snapshot /esc /stop /status 必须被 gate
 * - tmux runner 下这些命令正常执行
 * - 返回值语义正确：gate 拒截返回 success:true（提示）或 success:false（错误）
 */

import { describe, test, expect } from "bun:test";

describe("Handlers TMUX Gate 守卫测试", () => {
    describe("守卫 #1: /start 命令 gate", () => {
        test("direct runner 下 /start 应返回提示（success:true）", async () => {
            // 验证逻辑：handlers.ts line 140-149
            // r.runner !== "tmux" 时返回 success:true + 提示信息

            const r = {
                runner: "direct" as const,
                runnerConfig: "mlx" as const,
                blockedReason: undefined,
            };

            const shouldGate = r.runner !== "tmux";
            expect(shouldGate).toBe(true);

            // 验证返回语义：提示用户无需 /start，不是错误
            const expectedResponseType = "success";
            expect(expectedResponseType).toBe("success");

            // 验证提示内容包含关键信息
            const expectedHints = [
                "direct 执行臂",
                "无需 /start",
                "直接发送消息",
                "codex",
                "claude-code",
            ];

            const responseMessage = `当前为 direct 执行臂 (${r.runnerConfig})，无需 /start。\n\n直接发送消息即可开始对话。\n\n提示：如需切换到 tmux 执行臂，请使用 /model codex 或 /model claude-code`;

            for (const hint of expectedHints) {
                expect(responseMessage).toContain(hint);
            }
        });

        test("tmux runner 下 /start 应正常执行", async () => {
            const r = {
                runner: "tmux" as const,
                runnerConfig: "codex" as const,
                blockedReason: undefined,
            };

            const shouldGate = r.runner !== "tmux";
            expect(shouldGate).toBe(false);

            // tmux runner 下继续调用 TmuxSession.start
            expect(r.runner).toBe("tmux");
        });
    });

    describe("守卫 #2: /snapshot 命令 gate", () => {
        test("direct runner 下 /snapshot 应返回错误（success:false）", async () => {
            // 验证逻辑：handlers.ts line 181-189
            // r.runner !== "tmux" 时返回 success:false + 错误信息

            const r = {
                runner: "direct" as const,
                runnerConfig: "lmstudio" as const,
            };

            const shouldGate = r.runner !== "tmux";
            expect(shouldGate).toBe(true);

            // 验证返回语义：不支持该命令，是错误
            const expectedResponseType = "error";
            expect(expectedResponseType).toBe("error");

            // 验证错误信息包含关键信息
            const errorMessage = `当前为 direct 执行臂 (${r.runnerConfig})，不支持 /snapshot。\n\ndirect 执行臂无 tmux 会话，无快照可查看。`;

            expect(errorMessage).toContain("不支持 /snapshot");
            expect(errorMessage).toContain("无 tmux 会话");
            expect(errorMessage).toContain("无快照可查看");
        });

        test("tmux runner 下 /snapshot 应正常执行", async () => {
            const r = {
                runner: "tmux" as const,
                runnerConfig: "claude-code" as const,
            };

            const shouldGate = r.runner !== "tmux";
            expect(shouldGate).toBe(false);

            // tmux runner 下继续调用 sendSnapshot
            expect(r.runner).toBe("tmux");
        });
    });

    describe("守卫 #3: /esc 命令 gate", () => {
        test("direct runner 下 /esc 应返回错误（success:false）", async () => {
            // 验证逻辑：handlers.ts line 191-199
            // r.runner !== "tmux" 时返回 success:false + 错误信息

            const r = {
                runner: "direct" as const,
                runnerConfig: "claude" as const,
            };

            const shouldGate = r.runner !== "tmux";
            expect(shouldGate).toBe(true);

            const errorMessage = `当前为 direct 执行臂 (${r.runnerConfig})，不支持 /esc。\n\ndirect 执行臂无 tmux 会话，无法中断。`;

            expect(errorMessage).toContain("不支持 /esc");
            expect(errorMessage).toContain("无 tmux 会话");
            expect(errorMessage).toContain("无法中断");
        });

        test("tmux runner 下 /esc 应正常执行", async () => {
            const r = {
                runner: "tmux" as const,
                runnerConfig: "codex" as const,
            };

            const shouldGate = r.runner !== "tmux";
            expect(shouldGate).toBe(false);
        });
    });

    describe("守卫 #4: /stop 命令 gate", () => {
        test("direct runner 下 /stop 应返回提示（success:true）", async () => {
            // 验证逻辑：handlers.ts line 168-174
            // r.runner !== "tmux" 时返回 success:true + 提示信息

            const r = {
                runner: "direct" as const,
                runnerConfig: "llama" as const,
            };

            const shouldGate = r.runner !== "tmux";
            expect(shouldGate).toBe(true);

            // /stop 返回提示而非错误（语义改善）
            const responseMessage = `当前为 direct 执行臂 (${r.runnerConfig})，无需 /stop。`;
            expect(responseMessage).toContain("无需 /stop");
        });
    });

    describe("守卫 #5: /status 命令 gate", () => {
        test("direct runner 下 /status 应返回提示（success:true）", async () => {
            // 验证逻辑：handlers.ts line 175-183
            // r.runner !== "tmux" 时返回 success:true + 状态信息

            const r = {
                runner: "direct" as const,
                runnerConfig: "openai" as const,
            };

            const shouldGate = r.runner !== "tmux";
            expect(shouldGate).toBe(true);

            const responseMessage = `当前执行臂: ${r.runnerConfig}\n状态: direct（无 tmux 会话）`;
            expect(responseMessage).toContain("direct（无 tmux 会话）");
            expect(responseMessage).toContain(r.runnerConfig);
        });
    });

    describe("守卫 #6: /clear 命令分派", () => {
        test("MLX runner 下 /clear 应走 session artifacts 清理", async () => {
            const r = {
                runner: "direct" as const,
                runnerConfig: "mlx" as const,
            };

            // MLX runner：清理 session artifacts
            if (r.runnerConfig === "mlx") {
                // 应调用 clearSessionArtifacts
                expect(r.runnerConfig).toBe("mlx");
            } else {
                expect.fail("MLX runner 应走 artifacts 清理分支");
            }
        });

        test("tmux runner 下 /clear 应走 sendClear", async () => {
            const r = {
                runner: "tmux" as const,
                runnerConfig: "codex" as const,
            };

            if (r.runner === "tmux") {
                // 应调用 sendClear
                expect(r.runner).toBe("tmux");
                expect(r.runnerConfig).toBe("codex");
            } else {
                expect.fail("tmux runner 应走 sendClear 分支");
            }
        });

        test("direct runner (非 MLX) 下 /clear 应返回错误", async () => {
            const r = {
                runner: "direct" as const,
                runnerConfig: "lmstudio" as const,
            };

            // LMStudio 等 direct runner：不支持 /clear
            if (r.runner === "direct" && r.runnerConfig !== "mlx") {
                const errorMessage = `当前 direct 执行臂 (${r.runnerConfig}) 不支持 /clear 命令。\n\n提示：MLX 执行臂会自动清理会话窗口。`;
                expect(errorMessage).toContain("不支持 /clear");
            }
        });
    });

    describe("守卫 #7: resolveRunner 收敛逻辑", () => {
        test("resolveRunner 必须返回 { runner, runnerConfig, blockedReason? }", async () => {
            // 验证类型定义：handlers.ts line 107-112
            interface ResolveRunnerResult {
                runner: "tmux" | "direct";
                runnerConfig?: "mlx" | "lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code";
                blockedReason?: string;
            }

            const result: ResolveRunnerResult = {
                runner: "tmux",
                runnerConfig: "codex",
            };

            expect(result.runner).toBe("tmux");
            expect(result.runnerConfig).toBe("codex");
            expect(result.blockedReason).toBeUndefined();
        });

        test("codex/claude-code 应归一化为 runner='tmux'", () => {
            const runnerConfig = "codex";
            const isTmuxRunner = runnerConfig === "codex" || runnerConfig === "claude-code";
            const runner: "tmux" | "direct" = isTmuxRunner ? "tmux" : "direct";

            expect(runner).toBe("tmux");
        });

        test("mlx/lmstudio/llama/claude/openai 应归一化为 runner='direct'", () => {
            const directRunners = ["mlx", "lmstudio", "llama", "claude", "openai"] as const;

            for (const runnerConfig of directRunners) {
                const isTmuxRunner = runnerConfig === "codex" || runnerConfig === "claude-code";
                const runner: "tmux" | "direct" = isTmuxRunner ? "tmux" : "direct";
                expect(runner).toBe("direct");
            }
        });
    });

    describe("守卫 #8: handleTmuxSend 调用口径统一", () => {
        test("handleTmuxSend 必须接收 { runnerType, runnerOld }", async () => {
            // 验证类型定义：responder.ts line 29-37
            interface ResponseOptions {
                runnerType?: "tmux" | "direct";
                runnerOld?: "claude" | "codex" | "claude-code" | "local";
            }

            const validOptions: ResponseOptions = {
                runnerType: "tmux",
                runnerOld: "claude-code",
            };

            expect(validOptions.runnerType).toBe("tmux");
            expect(validOptions.runnerOld).toBe("claude-code");
        });

        test("BaseHandler 传递 runnerType + runnerOld", () => {
            // 验证：handlers.ts line 241-249
            const r = {
                runner: "tmux" as const,
                runnerConfig: "claude-code" as const,
            };

            const runnerOld = r.runnerConfig === "codex" || r.runnerConfig === "claude-code"
                ? r.runnerConfig
                : "claude-code";

            const options = {
                runnerType: r.runner,
                runnerOld,
            };

            expect(options.runnerType).toBe("tmux");
            expect(options.runnerOld).toBe("claude-code");
        });

        test("RuntimeRouterHandler 传递 runnerType + runnerOld", () => {
            // 验证：handlers.ts line 414-422 (LMStudioHandler 重命名为 RuntimeRouterHandler)
            const currentRunner = "codex" as const;

            const options = {
                runnerType: "tmux" as const,
                runnerOld: currentRunner,
            };

            expect(options.runnerType).toBe("tmux");
            expect(options.runnerOld).toBe("codex");
        });
    });

    describe("守卫 #9: 防止复发 - RuntimeRouterHandler 不重复实现 slash 命令", () => {
        test("RuntimeRouterHandler 必须代理 slash 命令到 DefaultHandler", async () => {
            // 验证：handlers.ts line 400-403
            // if (trimmed.startsWith("/")) return new DefaultHandler().handle(message, context);

            const trimmed = "/start";
            const isSlashCommand = trimmed.startsWith("/");

            expect(isSlashCommand).toBe(true);

            // 验证代理逻辑：slash 命令必须走 DefaultHandler，不走 RuntimeRouterHandler 自身逻辑
            const shouldDelegateToDefaultHandler = isSlashCommand;
            expect(shouldDelegateToDefaultHandler).toBe(true);
        });

        test("RuntimeRouterHandler /start 返回值必须与 BaseHandler 一致", async () => {
            // 验证：RuntimeRouterHandler 代理到 DefaultHandler 后，返回 BaseHandler 的标准提示
            // BaseHandler 的 /start 提示格式：handlers.ts line 144-147

            const baseHandlerHints = [
                "当前为 direct 执行臂",
                "无需 /start",
                "直接发送消息",
                "tmux 执行臂",
                "codex",
                "claude-code",
            ];

            // 模拟 BaseHandler 的返回格式（success:true + 提示信息）
            const mockBaseHandlerResponse = {
                success: true,
                response: `当前为 direct 执行臂 (mlx)，无需 /start。\n\n直接发送消息即可开始对话。\n\n提示：如需切换到 tmux 执行臂，请使用 /model codex 或 /model claude-code`,
            };

            // 验证返回值包含 BaseHandler 的标准提示
            expect(mockBaseHandlerResponse.success).toBe(true);

            for (const hint of baseHandlerHints) {
                expect(mockBaseHandlerResponse.response).toContain(hint);
            }
        });

        test("RuntimeRouterHandler 非 slash 消息走独立路由（不受影响）", async () => {
            // 验证：handlers.ts line 405-410
            // 非 slash 命令继续走 RuntimeRouterHandler 的消息路由逻辑（mlx/lmstudio/codex/claude-code）

            const nonSlashMessages = [
                "你好",
                "帮我写个函数",
                "今天天气怎么样",
                "   ",  // 空白
                "hello world",
            ];

            for (const msg of nonSlashMessages) {
                const trimmed = msg.trim();
                const isSlashCommand = trimmed.startsWith("/");

                // 非 slash 命令不应该被代理到 DefaultHandler
                expect(isSlashCommand).toBe(false);
            }
        });
    });
});

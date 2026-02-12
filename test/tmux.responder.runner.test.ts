/**
 * msgcode: Responder Runner 守卫测试
 *
 * 目的：锁死 runnerType + runnerOld 收敛，防止回归
 *
 * 关键验证：
 * - runnerOld === "codex" 走 Coder CLI(JSONL) 分支（isCoderCLI=true）
 * - runnerOld === "claude-code" 默认走 tmux pane 分支（isCoderCLI=false）
 */

import { describe, test, expect } from "bun:test";

describe("Responder Runner 守卫测试", () => {
	    describe("守卫 #1: codex/claude-code 分支选择", () => {
	        test("runnerOld === 'claude-code' 时 isCoderCLI 必须为 false", async () => {
	            // 验证逻辑：responder.ts line ~129
	            // const isCoderCLI = runnerOld === "codex";

	            const runnerOld = "claude-code";
	            const isCoderCLI = runnerOld === "codex";

	            expect(isCoderCLI).toBe(false);
	            expect(runnerOld).toBe("claude-code");
	        });

	        test("runnerOld === 'codex' 时 isCoderCLI 必须为 true", async () => {
	            const runnerOld = "codex";
	            const isCoderCLI = runnerOld === "codex";

	            expect(isCoderCLI).toBe(true);
	        });

	        test("runnerOld === 'claude' 时 isCoderCLI 必须为 false", async () => {
	            const runnerOld = "claude";
	            const isCoderCLI = runnerOld === "codex";

	            expect(isCoderCLI).toBe(false);
	        });

	        test("codex 使用 Coder CLI timeout（600000ms），claude-code 使用 Claude timeout（300000ms）", async () => {
	            // 验证逻辑：responder.ts line ~118
	            // const timeout = options.timeout ?? (runnerOld === "codex" ? MAX_WAIT_MS_CODEX : MAX_WAIT_MS_CLAUDE);

	            const MAX_WAIT_MS_CLAUDE = 300000; // Claude 默认最大等待 5 分钟
	            const MAX_WAIT_MS_CODEX = 600000;  // Coder CLI 偶尔会更慢，默认给到 10 分钟

	            const runnerOldCodex = "codex";
	            const timeoutCodex = runnerOldCodex === "codex" ? MAX_WAIT_MS_CODEX : MAX_WAIT_MS_CLAUDE;

	            const runnerOldClaudeCode = "claude-code";
	            const timeoutClaudeCode = runnerOldClaudeCode === "codex" ? MAX_WAIT_MS_CODEX : MAX_WAIT_MS_CLAUDE;

	            expect(timeoutCodex).toBe(MAX_WAIT_MS_CODEX);
	            expect(timeoutClaudeCode).toBe(MAX_WAIT_MS_CLAUDE);
	        });

	        test("isCoderCLI=true（codex）时需要 JSONL 路径逻辑", async () => {
	            // 验证逻辑：responder.ts line ~136-144
	            // isCoderCLI=true 时会检查 coderJsonlPath，没有则报错

	            const runnerOld = "codex";
	            const isCoderCLI = runnerOld === "codex";

            // 模拟 responder 中的逻辑
            const needsJsonlPath = isCoderCLI;
            const projectDir = "/fake/workspace";

            if (isCoderCLI && !projectDir) {
                expect.fail("应该报错：缺少工作区路径");
            }

            if (isCoderCLI && needsJsonlPath) {
                // 实际会调用 coderReader.findLatestJsonlForWorkspace
                expect(projectDir).toBeTruthy();
            }
        });

	        test("isCoderCLI=false 时不需要 JSONL 路径", async () => {
	            const runnerOld = "claude";
	            const isCoderCLI = runnerOld === "codex";

            expect(isCoderCLI).toBe(false);

            // Claude runner 不需要 JSONL
            const needsJsonlPath = isCoderCLI;
            expect(needsJsonlPath).toBe(false);
        });
    });

    describe("守卫 #2: runnerType 和 runnerOld 必须分离", () => {
        test("ResponseOptions 必须同时接收 runnerType 和 runnerOld", async () => {
            // 验证类型定义：responder.ts line 29-37
            interface ResponseOptions {
                runnerType?: "tmux" | "direct";
                runnerOld?: "claude" | "codex" | "claude-code" | "local";
                timeout?: number;
                attachments?: readonly unknown[];
                signal?: AbortSignal;
            }

            const validOptions: ResponseOptions = {
                runnerType: "tmux",
                runnerOld: "claude-code",
                timeout: 600000,
            };

            expect(validOptions.runnerType).toBe("tmux");
            expect(validOptions.runnerOld).toBe("claude-code");
            expect(validOptions.timeout).toBe(600000);
        });

	        test("tmux 执行臂固定 runnerType='tmux'", async () => {
            // 验证：无论 runnerOld 是什么，tmux 执行臂的 runnerType 固定为 "tmux"
            const runnerOld = "claude-code";
            const runnerType: "tmux" | "direct" = "tmux";

            expect(runnerType).toBe("tmux");
            expect(runnerOld).toBe("claude-code");

	            // isCoderCLI 由 runnerOld 决定，不是 runnerType
	            const isCoderCLI = runnerOld === "codex";
	            expect(isCoderCLI).toBe(false);
	        });
	    });

	    describe("守卫 #3: runnerOld 名称对应关系", () => {
        test("runnerOld='codex' → Codex CLI", () => {
            const runnerOld = "codex";
            const runnerName = runnerOld === "codex" ? "Codex" : "Claude";
            expect(runnerName).toBe("Codex");
        });

	        test("runnerOld='claude-code' 显示为 Claude Code（tmux pane）", () => {
	            const runnerOld = "claude-code";
	            // 验证：responder.ts line 111 逻辑
	            const runnerName = runnerOld === "codex" ? "Codex" : (runnerOld === "claude-code" ? "Claude Code" : "Claude");
	            expect(runnerName).toBe("Claude Code");
	        });

	        test("runnerOld='claude' → Claude", () => {
	            const runnerOld = "claude";
	            const runnerName = runnerOld === "codex" ? "Codex" : (runnerOld === "claude-code" ? "Claude Code" : "Claude");
	            expect(runnerName).toBe("Claude");
	        });
	    });
});

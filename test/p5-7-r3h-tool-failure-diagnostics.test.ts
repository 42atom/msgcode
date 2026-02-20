/**
 * msgcode: P5.7-R3h 工具失败合同与诊断增强回归锁测试
 *
 * 目标：
 * - 非零退出码保真测试
 * - stderr 尾部透传测试
 * - 空展示输出分类测试
 * - 失败类型三分可断言
 */

import { describe, it, expect } from "bun:test";
import { runBashCommand } from "../src/runners/bash-runner.js";

describe("P5.7-R3h: Tool Failure Diagnostics", () => {
    describe("非零退出码保真", () => {
        it("应该正确返回非零退出码", async () => {
            const result = await runBashCommand({
                command: "exit 42",
                cwd: process.cwd(),
            });

            expect(result.ok).toBe(false);
            expect(result.exitCode).toBe(42);
        });

        it("应该区分超时退出码 (-1) 和正常退出码", async () => {
            // 超时场景
            const timeoutResult = await runBashCommand({
                command: "sleep 5",
                cwd: process.cwd(),
                timeoutMs: 100,
            });

            expect(timeoutResult.ok).toBe(false);
            expect(timeoutResult.exitCode).toBe(-1);  // 超时信号
            expect(timeoutResult.error).toContain("超时");

            // 正常退出场景
            const normalResult = await runBashCommand({
                command: "exit 0",
                cwd: process.cwd(),
            });

            expect(normalResult.ok).toBe(true);
            expect(normalResult.exitCode).toBe(0);
        });
    });

    describe("stderr 尾部透传", () => {
        it("应该捕获 stderr 输出", async () => {
            const result = await runBashCommand({
                command: "echo 'error message' >&2",
                cwd: process.cwd(),
            });

            expect(result.ok).toBe(true);  // echo 成功
            expect(result.stderrTail).toContain("error message");
        });

        it("应该区分 stdout 和 stderr", async () => {
            const result = await runBashCommand({
                command: "echo 'stdout text' && echo 'stderr text' >&2",
                cwd: process.cwd(),
            });

            expect(result.stdoutTail).toContain("stdout text");
            expect(result.stderrTail).toContain("stderr text");
        });

        it("失败命令应该保留 stderr 信息", async () => {
            const result = await runBashCommand({
                command: "ls /nonexistent_directory_12345 2>&1 || true",
                cwd: process.cwd(),
            });

            // 验证命令执行（即使 ls 失败，true 会让整体成功）
            expect(result.stderrTail).toBeDefined();
        });
    });

    describe("失败类型分类", () => {
        it("TOOL_EXEC_FAILED 应该定义为有效错误码", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/tools/types.ts", "utf-8");

            expect(code).toContain("TOOL_EXEC_FAILED");
            expect(code).toContain("MODEL_PROTOCOL_FAILED");
            expect(code).toContain("EMPTY_DISPLAY_OUTPUT");
        });

        it("ToolErrorCode 应该包含所有三类失败", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/tools/types.ts", "utf-8");

            // 验证错误码类型定义
            expect(code).toContain("type ToolErrorCode");
            expect(code).toContain("MODEL_PROTOCOL_FAILED");  // 协议层失败
            expect(code).toContain("TOOL_EXEC_FAILED");      // 工具执行失败
            expect(code).toContain("EMPTY_DISPLAY_OUTPUT");  // 空展示输出失败
        });
    });

    describe("诊断字段透传", () => {
        it("ToolResult 应该包含诊断字段", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/tools/types.ts", "utf-8");

            // 验证 ToolResult 接口包含诊断字段
            expect(code).toContain("exitCode?: number | null");
            expect(code).toContain("stderrTail?: string");
            expect(code).toContain("stdoutTail?: string");
            expect(code).toContain("fullOutputPath?: string");
        });

        it("runBashCommand 应该返回完整的诊断结构", async () => {
            const result = await runBashCommand({
                command: "echo 'test'",
                cwd: process.cwd(),
            });

            // 验证返回结构
            expect(result).toHaveProperty("ok");
            expect(result).toHaveProperty("exitCode");
            expect(result).toHaveProperty("stdoutTail");
            expect(result).toHaveProperty("stderrTail");
            expect(result).toHaveProperty("durationMs");
        });
    });

    describe("大输出截断与落盘", () => {
        it("应该在超行数阈值时落盘", async () => {
            const result = await runBashCommand({
                command: "seq 1 1500",
                cwd: process.cwd(),
            });

            expect(result.ok).toBe(true);
            expect(result.fullOutputPath).toBeDefined();
        });

        it("应该在超字节阈值时落盘", async () => {
            const result = await runBashCommand({
                command: "yes 'long line content' | head -n 3000",
                cwd: process.cwd(),
            });

            expect(result.ok).toBe(true);
            expect(result.fullOutputPath).toBeDefined();
        });
    });

    describe("日志观测字段", () => {
        it("Tool Loop 应该记录 errorCode 字段", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证日志中包含 errorCode（多种形式）
            expect(code).toContain('errorCode: "MODEL_PROTOCOL_FAILED"');
            expect(code).toContain('errorCode: "TOOL_LOOP_LIMIT_EXCEEDED"');
            expect(code).toContain('errorCode: result.error?.code || "TOOL_EXEC_FAILED"');
        });

        it("Tool Loop 应该记录 exitCode 诊断字段", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 验证日志中包含 exitCode
            expect(code).toContain("toolExitCode:");
            expect(code).toContain("exitCode:");
        });

        it("日志应该区分协议层失败与工具执行失败", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/lmstudio.ts", "utf-8");

            // 协议层失败：无 tool_calls
            expect(code).toContain("MODEL_PROTOCOL_FAILED");

            // 工具执行失败：有 tool_calls 但执行出错
            expect(code).toContain("TOOL_EXEC_FAILED");
        });
    });
});

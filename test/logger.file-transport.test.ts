/**
 * msgcode: File Transport Logger BDD 测试
 *
 * 测试场景：
 * - Scenario A: error/reason/retry 字段可见性
 * - Scenario B: 其他错误字段输出
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";

describe("File Transport Logger", () => {
    let tempWorkspace: string;
    let logFilePath: string;
    let prevPlaintextInputEnv: string | undefined;

    beforeEach(() => {
        tempWorkspace = join(tmpdir(), `msgcode-log-test-${randomUUID()}`);
        mkdirSync(tempWorkspace, { recursive: true });
        logFilePath = join(tempWorkspace, "test.log");
        prevPlaintextInputEnv = process.env.MSGCODE_LOG_PLAINTEXT_INPUT;
    });

    afterEach(() => {
        if (prevPlaintextInputEnv === undefined) {
            delete process.env.MSGCODE_LOG_PLAINTEXT_INPUT;
        } else {
            process.env.MSGCODE_LOG_PLAINTEXT_INPUT = prevPlaintextInputEnv;
        }
        if (existsSync(tempWorkspace)) {
            rmSync(tempWorkspace, { recursive: true, force: true });
        }
    });

    describe("Scenario A: error/reason/retry 字段可见性", () => {
        test("应该输出 meta.error 字段到文件日志", async () => {
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            // 写入包含 error 的日志
            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "error",
                message: "MLX provider failed",
                module: "mlx",
                meta: {
                    error: "MLX_HTTP_ERROR: HTTP 404",
                },
            });

            // 等待流刷新
            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            // 读取日志文件并验证
            const logContent = readFileSync(logFilePath, "utf-8");
            expect(logContent).toContain("error=MLX_HTTP_ERROR: HTTP 404");
        });

        test("应该输出 meta.reason 字段到文件日志", async () => {
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            // 写入包含 reason 的日志
            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "warn",
                message: "404 error, will retry",
                module: "mlx",
                meta: {
                    reason: "mlx_404_fallback",
                },
            });

            // 等待流刷新
            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            // 读取日志文件并验证
            const logContent = readFileSync(logFilePath, "utf-8");
            expect(logContent).toContain("reason=mlx_404_fallback");
        });

        test("应该输出 meta.retry 字段到文件日志", async () => {
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            // 写入包含 retry 的日志
            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "warn",
                message: "Retrying with minimal context",
                module: "mlx",
                meta: {
                    retry: 1,
                },
            });

            // 等待流刷新
            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            // 读取日志文件并验证
            const logContent = readFileSync(logFilePath, "utf-8");
            expect(logContent).toContain("retry=1");
        });

        test("应该同时输出多个错误字段", async () => {
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            // 写入包含多个错误字段的日志
            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "warn",
                message: "MLX 404 fallback",
                module: "mlx",
                meta: {
                    chatId: "test-chat-id",
                    error: "MLX_HTTP_ERROR: HTTP 404",
                    reason: "mlx_404_fallback",
                    retry: 1,
                },
            });

            // 等待流刷新
            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            // 读取日志文件并验证所有字段都存在
            const logContent = readFileSync(logFilePath, "utf-8");
            expect(logContent).toContain("chatId=");
            expect(logContent).toContain("error=MLX_HTTP_ERROR: HTTP 404");
            expect(logContent).toContain("reason=mlx_404_fallback");
            expect(logContent).toContain("retry=1");
        });
    });

    describe("Scenario B: 其他错误字段输出", () => {
        test("应该输出 meta.status 字段", async () => {
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            // 写入包含 status 的日志
            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "info",
                message: "Request status",
                module: "http",
                meta: {
                    status: 404,
                },
            });

            // 等待流刷新
            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            // 读取日志文件并验证
            const logContent = readFileSync(logFilePath, "utf-8");
            expect(logContent).toContain("status=404");
        });

        test("长 error 字段应该被截断到 200 字符", async () => {
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            // 创建一个超过 200 字符的 error
            const longError = "E".repeat(300);

            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "error",
                message: "Long error test",
                module: "test",
                meta: {
                    error: longError,
                },
            });

            // 等待流刷新
            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            // 读取日志文件并验证截断
            const logContent = readFileSync(logFilePath, "utf-8");
            const errorMatch = logContent.match(/error=(.{200})/);
            expect(errorMatch).toBeTruthy();
            expect(errorMatch?.[1]).toHaveLength(200);
        });

        test("开启明文开关时应该输出 inboundText", async () => {
            process.env.MSGCODE_LOG_PLAINTEXT_INPUT = "1";
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "info",
                message: "收到消息",
                module: "listener",
                meta: {
                    inboundText: "请执行 pwd",
                },
            });

            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            const logContent = readFileSync(logFilePath, "utf-8");
            expect(logContent).toContain('inboundText="请执行 pwd"');
        });

        test("关闭明文开关时不应该输出 inboundText", async () => {
            process.env.MSGCODE_LOG_PLAINTEXT_INPUT = "0";
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "info",
                message: "收到消息",
                module: "listener",
                meta: {
                    inboundText: "请执行 pwd",
                },
            });

            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            const logContent = readFileSync(logFilePath, "utf-8");
            expect(logContent).not.toContain('inboundText="请执行 pwd"');
        });

        test("应该输出 toolCallCount 和 toolName 字段", async () => {
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "info",
                message: "LM Studio 请求完成",
                module: "handlers",
                meta: {
                    toolCallCount: 1,
                    toolName: "bash",
                },
            });

            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            const logContent = readFileSync(logFilePath, "utf-8");
            expect(logContent).toContain("toolCallCount=1");
            expect(logContent).toContain("toolName=bash");
        });

        test("应该输出 SOUL 注入观测字段", async () => {
            const { FileTransport } = await import("../src/logger/file-transport.js");

            const transport = new FileTransport({
                filename: logFilePath,
                maxSize: 1024 * 1024,
            });

            transport.write({
                timestamp: "2025-02-06 12:00:00",
                level: "info",
                message: "LM Studio 请求开始",
                module: "handlers",
                meta: {
                    soulInjected: true,
                    soulSource: "workspace",
                    soulPath: "/tmp/workspace/.msgcode/SOUL.md",
                    soulChars: 1024,
                },
            });

            await new Promise(resolve => setTimeout(resolve, 100));
            transport.close();

            const logContent = readFileSync(logFilePath, "utf-8");
            expect(logContent).toContain("soulInjected=true");
            expect(logContent).toContain("soulSource=workspace");
            expect(logContent).toContain("soulPath=/tmp/workspace/.msgcode/SOUL.md");
            expect(logContent).toContain("soulChars=1024");
        });
    });
});

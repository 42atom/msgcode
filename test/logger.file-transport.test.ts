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

    beforeEach(() => {
        tempWorkspace = join(tmpdir(), `msgcode-log-test-${randomUUID()}`);
        mkdirSync(tempWorkspace, { recursive: true });
        logFilePath = join(tempWorkspace, "test.log");
    });

    afterEach(() => {
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
    });
});

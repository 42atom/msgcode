/**
 * msgcode: 主入口（2.0）
 *
 * 原则：
 * - iMessage I/O 统一走 imsg RPC
 * - 无 iMessage SDK / 无 AppleScript
 * - 单例锁：防止多个实例同时订阅 iMessage 导致重复回复
 */

import http from "node:http";
import { config } from "./config.js";
import { logger } from "./logger/index.js";
import { ImsgRpcClient } from "./imsg/rpc-client.js";
import type { InboundMessage } from "./imsg/types.js";
import { handleMessage } from "./listener.js";
import { getActiveRoutes } from "./routes/store.js";
import { getVersion } from "./version.js";
import { acquireSingletonLock } from "./runtime/singleton.js";

function printBanner(): void {
    const version = getVersion();
    console.log(`
msgcode v${version}
`);
    console.log(`配置:`);
    console.log(`  日志级别: ${config.logLevel}`);
    console.log(`  白名单电话: ${config.whitelist.phones.length} 个`);
    console.log(`  白名单邮箱: ${config.whitelist.emails.length} 个`);
    console.log(`  WORKSPACE_ROOT: ${config.workspaceRoot}`);
    console.log("");
}

async function main(): Promise<void> {
    // 单例锁：防止多个 msgcode 实例同时运行
    const lock = await acquireSingletonLock("msgcode");
    if (!lock.acquired) {
        console.error(`[msgcode] 已有实例在运行 (pid=${lock.pid ?? "unknown"})，本次启动取消`);
        console.error(`如需重启，请先运行: kill ${lock.pid ?? "<pid>"}`);
        process.exit(1);
    }

    printBanner();

    logger.info("msgcode 启动", {
        module: "main",
        logLevel: config.logLevel,
        whitelistPhones: config.whitelist.phones.length,
        whitelistEmails: config.whitelist.emails.length,
    });

    const imsgClient = new ImsgRpcClient(config.imsgPath);
    await imsgClient.start();
    await imsgClient.subscribe();

    logger.info("imsg RPC 客户端已启动", {
        module: "main",
        imsgPath: config.imsgPath,
    });

    // P0: 自动管理 MLX server（如果启用）
    // 统一基座管理，避免手动启动导致多进程问题
    const autoManageMlx = process.env.MLX_AUTO_MANAGE !== "0";
    if (autoManageMlx) {
        try {
            const { MlxServer } = await import("./runners/mlx.js");
            const status = await MlxServer.getStatus();

            if (!status.running) {
                // 使用默认配置启动
                logger.info("MLX server 未运行，自动启动中...", { module: "main" });

                try {
                    const result = await MlxServer.start({
                        modelPath: process.env.MLX_MODEL_PATH,
                        host: "127.0.0.1",
                        port: 18000,
                        maxTokens: 2048,
                    });
                    logger.info(`MLX server 已自动启动: ${result}`, { module: "main" });
                } catch (err) {
                    logger.warn("MLX server 自动启动失败", {
                        module: "main",
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            } else {
                logger.info(`MLX server 已运行 (PID: ${status.pid})`, { module: "main" });
            }
        } catch (err) {
            logger.warn("MLX server 检查失败", {
                module: "main",
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // 崩溃/异常通知（最佳努力，无路由则静默）
    async function sendAlert(text: string): Promise<void> {
        try {
            const routes = getActiveRoutes();
            const target = routes[0];
            if (!target) return;
            await imsgClient.send({ chat_guid: target.chatGuid, text });
        } catch {
            // ignore
        }
    }

    process.on("uncaughtException", (error) => {
        logger.error("未捕获的异常", {
            module: "main",
            error: error instanceof Error ? error.message : String(error),
        });
        void sendAlert(`msgcode 崩溃: ${String(error).slice(0, 160)}`);
        setTimeout(() => process.exit(1), 500);
    });

    process.on("unhandledRejection", (reason) => {
        logger.error("未处理的 Promise rejection", {
            module: "main",
            reason: String(reason),
        });
        void sendAlert(`msgcode Promise 未处理: ${String(reason).slice(0, 160)}`);
    });

    // 可选 healthz HTTP 接口
    const healthPort = Number(process.env.HEALTH_PORT);
    if (!Number.isNaN(healthPort) && healthPort > 0) {
        const server = http.createServer((_req, res) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
        });
        server.listen(healthPort, () => {
            logger.info("healthz HTTP 已启动", { module: "main", port: healthPort });
        });
        process.on("exit", () => server.close());
    }

    // 收消息（imsg watch 推送）
    imsgClient.on("message", async (message: InboundMessage) => {
        await handleMessage(message, { imsgClient, debug: config.logLevel === "debug" });
    });

    imsgClient.on("error", (error: Error) => {
        logger.error("imsg RPC 错误", { module: "main", error: error.message });
    });

    imsgClient.on("close", () => {
        logger.warn("imsg RPC 连接已关闭", { module: "main" });
    });

    // 优雅关闭
    process.on("SIGINT", async () => {
        logger.info("收到 SIGINT，正在关闭", { module: "main" });

        // 停止 MLX server（如果是由 msgcode 管理的）
        if (autoManageMlx) {
            try {
                const { MlxServer } = await import("./runners/mlx.js");
                await MlxServer.stop();
                logger.info("MLX server 已停止", { module: "main" });
            } catch (err) {
                logger.warn("停止 MLX server 失败", {
                    module: "main",
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        await imsgClient.stop();
        logger.close();
        process.exit(0);
    });

    await new Promise<void>(() => {});
}

void main();

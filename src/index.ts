/**
 * msgcode: 主入口
 *
 * iMessage Bot 系统主程序
 */

import { IMessageSDK } from "@photon-ai/imessage-kit";
import { config } from "./config.js";
import { startListener } from "./listener.js";
import { getAllRoutes } from "./router.js";
import { logger } from "./logger/index.js";

/**
 * 打印启动信息
 */
function printBanner() {
    console.log(`
╔════════════════════════════════════════╗
║         msgcode v0.4.0            ║
║     iMessage-based AI Bot System      ║
╚════════════════════════════════════════╝
`);

    console.log(`📋 配置:`);
    console.log(`   日志级别: ${config.logLevel}`);
    console.log(`   白名单电话: ${config.whitelist.phones.length} 个`);
    console.log(`   白名单邮箱: ${config.whitelist.emails.length} 个`);

    const routes = getAllRoutes();
    console.log(`   群组路由: ${routes.length} 个`);
    routes.forEach((route) => {
        const dirInfo = route.projectDir ? ` (${route.projectDir})` : "";
        console.log(`      • ${route.groupName}${dirInfo} → ${route.botType || "default"} bot`);
    });
    console.log("");
}

/**
 * 主函数
 */
async function main() {
    printBanner();

    // 记录启动信息到日志文件
    logger.info("msgcode v0.4.0 启动", {
        module: "main",
        logLevel: config.logLevel,
        whitelistPhones: config.whitelist.phones.length,
        whitelistEmails: config.whitelist.emails.length,
        groupRoutes: getAllRoutes().length,
    });

    // 全局未捕获的异常处理
    process.on("uncaughtException", (error) => {
        console.error("💥 未捕获的异常:", error);
        logger.error("未捕获的异常", { module: "main", error: error.message, stack: error.stack });
        // 不立即退出，给日志系统时间写入
        setTimeout(() => process.exit(1), 1000);
    });

    // 全局未处理的 Promise rejection 处理
    process.on("unhandledRejection", (reason, promise) => {
        console.error("💥 未处理的 Promise rejection:", reason);
        logger.error("未处理的 Promise rejection", {
            module: "main",
            reason: String(reason),
            promise: String(promise)
        });
        // 不退出进程，继续运行
    });

    // 创建 SDK
    const sdk = new IMessageSDK({
        debug: config.logLevel === "debug",
    });

    // 启动消息监听
    const watcher = await startListener(sdk, config.logLevel === "debug", config.useFileWatcher);

    // 优雅关闭
    process.on("SIGINT", async () => {
        console.log("\n\n👋 正在关闭...");
        logger.info("正在关闭 msgcode", { module: "main" });
        if (watcher) {
            watcher.stop();
        }
        await sdk.close();
        logger.close();
        process.exit(0);
    });
}

// 启动
main().catch((error) => {
    console.error("💥 未处理的错误:", error);
    logger.error("未处理的错误", { module: "main", error });
    process.exit(1);
});

/**
 * msgcode: 主入口
 *
 * iMessage Bot 系统主程序
 */

import { IMessageSDK } from "@photon-ai/imessage-kit";
import { config } from "./config.js";
import { startListener } from "./listener.js";
import { getAllRoutes } from "./router.js";

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

    // 创建 SDK
    const sdk = new IMessageSDK({
        debug: config.logLevel === "debug",
    });

    // 启动消息监听
    const watcher = await startListener(sdk, config.logLevel === "debug", config.useFileWatcher);

    // 优雅关闭
    process.on("SIGINT", async () => {
        console.log("\n\n👋 正在关闭...");
        if (watcher) {
            watcher.stop();
        }
        await sdk.close();
        process.exit(0);
    });
}

// 启动
main().catch((error) => {
    console.error("💥 未处理的错误:", error);
    process.exit(1);
});

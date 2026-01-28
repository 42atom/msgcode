/**
 * msgcode: 守护进程入口
 *
 * 供 `msgcode start` 后台模式启动时调用，复用 commands.startBot 的启动逻辑。
 */

import { startBot } from "./commands.js";

startBot().catch((error) => {
    console.error("[Daemon] 启动失败:", error);
    process.exit(1);
});

/**
 * msgcode: 守护进程入口
 *
 * 供 `msgcode start` 后台模式启动时调用，复用 commands.startBot 的启动逻辑。
 *
 * 注意：使用与 index.ts 相同的锁名 "msgcode"，确保 daemon 和 index.ts 不能同时运行。
 */

import { startBot } from "./commands.js";
import { acquireSingletonLock } from "./runtime/singleton.js";

(async () => {
    const lock = await acquireSingletonLock("msgcode");
    if (!lock.acquired) {
        // 已有实例在跑：静默退出，避免重复订阅导致重复回复
        console.error(`[msgcode] 已有实例在运行 (pid=${lock.pid ?? "unknown"})，本次启动取消`);
        console.error(`如需重启，请先运行: kill ${lock.pid ?? "<pid>"}`);
        process.exit(1);
    }

    await startBot();
})().catch((error) => {
    console.error("[Daemon] 启动失败:", error);
    process.exit(1);
});

/**
 * msgcode: CLI 命令实现
 *
 * 提供 start/stop/restart/allstop 命令
 */

import { TmuxSession } from "./tmux/session.js";
import { startListener } from "./listener.js";
import { config } from "./config.js";
import { IMessageSDK } from "@photon-ai/imessage-kit";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

let sdk: IMessageSDK | null = null;
let botProcess: ReturnType<typeof setInterval> | null = null;

/**
 * 启动 bot
 */
export async function startBot(): Promise<void> {
    // 检查是否已经在运行
    const isRunning = await checkBotRunning();
    if (isRunning) {
        console.log("⚠️  msgcode bot 已在运行");
        return;
    }

    console.log("🚀 启动 msgcode bot...");

    sdk = new IMessageSDK({ debug: config.logLevel === "debug" });

    // 启动消息监听
    await startListener(sdk, config.logLevel === "debug", config.useFileWatcher);

    console.log("✅ msgcode bot 已启动");

    // 保持运行
    await keepAlive();
}

/**
 * 停止 bot
 */
export async function stopBot(): Promise<void> {
    console.log("⏹️  停止 msgcode bot...");

    const isRunning = await checkBotRunning();
    if (!isRunning) {
        console.log("⚠️  msgcode bot 未在运行");
        return;
    }

    // 杀死 bot 进程
    try {
        await execAsync("pkill -f 'tsx src/index.ts'");
        await execAsync("pkill -f 'node.*msgcode'");
        console.log("✅ msgcode bot 已停止");
    } catch (error) {
        console.log("✅ msgcode bot 已停止（或未运行）");
    }
}

/**
 * 重启 bot
 */
export async function restartBot(): Promise<void> {
    console.log("🔄 重启 msgcode bot...");
    await stopBot();
    await new Promise(r => setTimeout(r, 1000));
    await startBot();
}

/**
 * 停止所有（bot + tmux）
 */
export async function allStop(): Promise<void> {
    console.log("🛑 停止所有服务...");

    // 停止 bot
    await stopBot();

    // 停止所有 tmux 会话
    try {
        const { stdout } = await execAsync("tmux ls 2>/dev/null || true");
        const sessions = stdout.split("\n")
            .map(line => line.match(/^([^:]+)/)?.[1])
            .filter((name): name is string => Boolean(name))
            .filter(name => name.startsWith("msgcode-"));

        for (const session of sessions) {
            await execAsync(`tmux kill-session -t ${session}`);
            console.log(`  ✓ 已停止 tmux 会话: ${session}`);
        }
    } catch {
        // 忽略错误
    }

    console.log("✅ 所有服务已停止");
    process.exit(0);
}

/**
 * 检查 bot 是否在运行
 */
async function checkBotRunning(): Promise<boolean> {
    try {
        const { stdout } = await execAsync("pgrep -f 'tsx src/index.ts' || true");
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * 保持进程运行
 */
function keepAlive(): Promise<never> {
    return new Promise(() => {
        // 永不 resolve，保持进程运行
    });
}

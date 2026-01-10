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
import { writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { logger } from "./logger/index.js";
import * as os from "node:os";
import * as path from "node:path";

const execAsync = promisify(exec);

let sdk: IMessageSDK | null = null;
let botProcess: ReturnType<typeof setInterval> | null = null;

/**
 * PID 文件路径（用于单进程检测）
 */
const PID_FILE = path.join(os.homedir(), '.config/msgcode/msgcode.pid');

/**
 * 启动 bot
 */
export async function startBot(): Promise<void> {
    // 🔒 单进程检测：检查是否已有实例在运行
    const runningInfo = await checkBotRunning();
    if (runningInfo.isRunning) {
        console.log(`❌ msgcode bot 已在运行 (PID: ${runningInfo.pid}, 进程数: ${runningInfo.count})`);
        console.log(`💡 如需重启，请先运行: msgcode stop`);
        logger.error(`msgcode bot 已在运行 (PID: ${runningInfo.pid}, 进程数: ${runningInfo.count})`, { module: "commands", runningInfo });
        process.exit(1);
        return;
    }

    console.log("🚀 启动 msgcode bot...");
    logger.info("🚀 启动 msgcode bot...", { module: "commands" });

    // 🔒 写入 PID 文件
    try {
        await writeFile(PID_FILE, String(process.pid), { mode: 0o644 });
        logger.info(`PID 文件已创建: ${PID_FILE} (PID: ${process.pid})`, { module: "commands", pid: process.pid });
    } catch (error: any) {
        console.warn(`⚠️  无法创建 PID 文件: ${error.message}`);
        logger.warn(`无法创建 PID 文件: ${error.message}`, { module: "commands", error });
    }

    // 注册退出时清理 PID 文件
    process.on('exit', () => cleanupPidFile());
    process.on('SIGINT', async () => {
        await cleanupPidFile();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await cleanupPidFile();
        process.exit(0);
    });

    sdk = new IMessageSDK({ debug: config.logLevel === "debug" });

    // 启动消息监听
    await startListener(sdk, config.logLevel === "debug", config.useFileWatcher);

    console.log("✅ msgcode bot 已启动");
    logger.info("✅ msgcode bot 已启动", { module: "commands" });

    // 启动后再次检查是否有多实例（守护）
    const postStartInfo = await checkBotRunning();
    if (postStartInfo.count > 1) {
        console.error(`🚨 检测到多实例冲突，正在退出。保留的 PID: ${postStartInfo.pid}`);
        logger.error("🚨 检测到多实例冲突，退出", { module: "commands", postStartInfo });
        await cleanupPidFile();
        process.exit(1);
    }

    // 保持运行
    await keepAlive();
}

/**
 * 停止 bot
 */
export async function stopBot(): Promise<void> {
    console.log("⏹️  停止 msgcode bot...");
    logger.info("⏹️  停止 msgcode bot...", { module: "commands" });

    const runningInfo = await checkBotRunning();
    if (!runningInfo.isRunning) {
        console.log("⚠️  msgcode bot 未在运行");
        logger.warn("⚠️  msgcode bot 未在运行", { module: "commands" });
        // 即使没有运行，也清理 PID 文件
        await cleanupPidFile();
        return;
    }

    // 杀死所有 msgcode 相关进程
    try {
        await execAsync("pkill -9 -f 'tsx.*src/index.ts'");
        await execAsync("pkill -9 -f 'tsx.*cli.ts'");
        await execAsync("pkill -9 -f 'tsx.*listener'");
        await execAsync("pkill -9 -f 'node.*tsx.*msgcode'");
        await execAsync("pkill -9 -f 'npm exec tsx src/index.ts'");

        // 等待进程完全退出
        await new Promise(r => setTimeout(r, 500));

        console.log(`✅ msgcode bot 已停止 (终止了 ${runningInfo.count} 个进程)`);
        logger.info(`msgcode bot 已停止 (终止了 ${runningInfo.count} 个进程)`, { module: "commands", count: runningInfo.count });
    } catch (error) {
        console.log("✅ msgcode bot 已停止（或未运行）");
        logger.info("✅ msgcode bot 已停止（或未运行）", { module: "commands" });
    }

    // 清理 PID 文件
    await cleanupPidFile();
}

/**
 * 重启 bot
 */
export async function restartBot(): Promise<void> {
    console.log("🔄 重启 msgcode bot...");
    logger.info("🔄 重启 msgcode bot...", { module: "commands" });
    await stopBot();
    await new Promise(r => setTimeout(r, 1000));
    await startBot();
}

/**
 * 停止所有（bot + tmux）
 */
export async function allStop(): Promise<void> {
    console.log("🛑 停止所有服务...");
    logger.info("🛑 停止所有服务...", { module: "commands" });

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
            logger.info(`  ✓ 已停止 tmux 会话: ${session}`, { module: "commands", session });
        }
    } catch {
        // 忽略错误
    }

    console.log("✅ 所有服务已停止");
    logger.info("✅ 所有服务已停止", { module: "commands" });
    process.exit(0);
}

/**
 * 运行信息
 */
interface RunningInfo {
    isRunning: boolean;
    count: number;
    pid: number | null;
    pids: number[];
}

/**
 * 检查 bot 是否在运行（改进版，使用多种方法检测）
 */
async function checkBotRunning(): Promise<RunningInfo> {
    const currentPid = process.pid;

    // 方法1: 检查 PID 文件（最可靠）
    if (existsSync(PID_FILE)) {
        try {
            const { stdout: pidCheck } = await execAsync(`cat ${PID_FILE}`);
            const pid = parseInt(pidCheck.trim(), 10);
            if (!isNaN(pid) && pid !== currentPid) {
                // 检查该 PID 是否仍在运行
                const { stdout: processCheck } = await execAsync(`ps -p ${pid} -o comm= 2>/dev/null || true`);
                if (processCheck.trim().length > 0) {
                    return {
                        isRunning: true,
                        count: 1,
                        pid: pid,
                        pids: [pid],
                    };
                }
            }
        } catch {
            // PID 文件读取失败，继续其他检测
        }
    }

    // 方法2: 检测 msgcode 相关进程（更宽松的命令行匹配）
    try {
        const { stdout } = await execAsync(
            "ps -axo pid,command | grep -E 'msgcode|src/index.ts|cli.ts|listener' | grep -v grep || true"
        );

        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
            const pids = lines
                .map(line => line.trim().split(/\s+/)[1])
                .map(p => parseInt(p, 10))
                .filter(p => !isNaN(p) && p !== currentPid);

            if (pids.length > 0) {
                return {
                    isRunning: true,
                    count: pids.length,
                    pid: pids[0],
                    pids,
                };
            }
        }
    } catch {
        // 检测失败
    }

    // 方法3: 使用 lsof 检测监听中的进程（如果使用了文件监听）
    try {
        // 检查是否有进程正在监看 iMessage 数据库
        const chatDbPath = `${os.homedir()}/Library/Messages/chat.db`;
        const { stdout } = await execAsync(
            `lsof +c 0 "${chatDbPath}" 2>/dev/null | grep -v COMMAND || true`
        );

        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
            const pids = lines
                .map(line => line.trim().split(/\s+/)[1])
                .map(p => parseInt(p, 10))
                .filter(p => !isNaN(p) && p !== currentPid);

            // 过滤掉系统的 IMDPersistenceAgent（系统 iMessage 后台进程）
            const filteredPids: number[] = [];
            for (const pid of pids) {
                try {
                    const { stdout: comm } = await execAsync(`ps -p ${pid} -o comm= || true`);
                    if (comm.includes("IMDPersistenceAgent")) {
                        continue;
                    }
                } catch {
                    // ignore
                }
                filteredPids.push(pid);
            }

            if (pids.length > 0) {
                return {
                    isRunning: filteredPids.length > 0,
                    count: filteredPids.length,
                    pid: filteredPids[0] ?? null,
                    pids: filteredPids,
                };
            }
        }
    } catch {
        // lsof 检测失败
    }

    // 方法4: 最后的保险 - 检测 tmux 会话（每个运行的 bot 都有 tmux 会话）
    // 注意：这里只作为提示，不单独作为判断依据（因为有 tmux 会话不代表 bot 进程在运行）
    // 移除此方法，避免误判
    // try {
    //     const { stdout } = await execAsync("tmux ls 2>/dev/null || true");
    //     const sessions = stdout.split('\n')
    //         .map(line => line.match(/^msgcode-([^:]+)/)?.[1])
    //         .filter((name): name is string => Boolean(name));
    //
    //     if (sessions.length > 0) {
    //         // 有 tmux 会话说明 bot 可能在运行
    //         // 但需要进一步确认是否有对应的监听进程
    //         // 这里返回保守的结果
    //         return {
    //             isRunning: true,
    //             count: sessions.length,
    //             pid: null,
    //             pids: [],
    //         };
    //     }
    // } catch {
    //     // tmux 检测失败
    // }

    // 没有检测到运行中的进程
    return {
        isRunning: false,
        count: 0,
        pid: null,
        pids: [],
    };
}

/**
 * 清理 PID 文件
 */
async function cleanupPidFile(): Promise<void> {
    try {
        if (existsSync(PID_FILE)) {
            await unlink(PID_FILE);
            logger.info(`PID 文件已删除: ${PID_FILE}`, { module: "commands" });
        }
    } catch (error: any) {
        logger.warn(`清理 PID 文件失败: ${error.message}`, { module: "commands", error });
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

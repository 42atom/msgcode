/**
 * msgcode: tmux 会话管理
 *
 * 管理与 Claude Code 的 tmux 会话
 */

import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";

import { logger } from "../logger/index.js";

const execAsync = promisify(exec);
const READY_WAIT_TIMEOUT_MS = 5000; // /start 等待就绪的上限，缩短启动首回响应时间
const STARTUP_SLOW_THRESHOLD_MS = 10000; // 超过该阈值视为 Claude 启动异常

/**
 * 校验路径是否安全（防止路径遍历和命令注入）
 *
 * 规则：
 * - 必须以 / 开头（绝对路径）
 * - 不允许包含 ..（路径遍历）
 * - 不允许包含 Shell 特殊字符（$, `, !）
 */
function isSafePath(path: string): boolean {
    return path.startsWith("/") && !path.includes("..") && !/[$`!]/.test(path);
}

/**
 * 单引号转义（用于 Shell 命令中的路径）
 * 将 ' 转义为 '\''（结束单引号、转义单引号、重新开始单引号）
 */
function shellEscapeSingleQuote(str: string): string {
    return "'" + str.replace(/'/g, "'\\''") + "'";
}

/**
 * Claude 会话状态
 */
export enum SessionStatus {
    Stopped = "stopped",
    Starting = "starting",
    Ready = "ready",
}

/**
 * tmux 会话管理器
 */
export class TmuxSession {
    private static sessions = new Map<string, SessionState>();

    /**
     * 会话状态
     */
    private static async getStatus(sessionName: string): Promise<SessionStatus> {
        try {
            const { stdout } = await execAsync(`tmux list-sessions -F "#{session_name}"`, { timeout: 5000 });
            if (!stdout.split("\n").includes(sessionName)) {
                // 会话不存在，同步清理缓存（防止外部 tmux kill-session 后缓存不同步）
                this.sessions.delete(sessionName);
                return SessionStatus.Stopped;
            }

            // 检查 Claude 是否在运行（通过检测提示符）
            const { stdout: paneOutput } = await execAsync(
                `tmux capture-pane -t ${sessionName} -p -S -100`,
                { timeout: 5000 }
            );

            // Claude 就绪标志：出现 "How can I help?" 或 ">" 提示符
            if (paneOutput.includes("How can I help?") || paneOutput.includes("╭")) {
                return SessionStatus.Ready;
            }

            return SessionStatus.Starting;
        } catch {
            // 出错时也清理缓存
            this.sessions.delete(sessionName);
            return SessionStatus.Stopped;
        }
    }

    /**
     * 生成会话名称（msgcode-前缀）
     */
    static getSessionName(groupName: string): string {
        const cleanName = groupName.toLowerCase().replace(/[^a-z0-9]/g, "_");
        return `msgcode-${cleanName}`;
    }

    /**
     * 启动 tmux 会话并运行 Claude
     */
    static async start(groupName: string, projectDir?: string): Promise<string> {
        const sessionName = this.getSessionName(groupName);
        const state: SessionState = { groupName, projectDir, status: SessionStatus.Starting };
        this.sessions.set(sessionName, state);
        const startTime = Date.now();

        // 检查会话是否已存在
        const currentStatus = await this.getStatus(sessionName);
        if (currentStatus !== SessionStatus.Stopped) {
            // 会话已存在，更新工作目录
            if (projectDir) {
                // P0 修复：校验路径安全性
                if (!isSafePath(projectDir)) {
                    throw new Error(`Invalid project directory: ${projectDir}`);
                }
                // 使用 spawn 避免命令注入，直接传路径（无需 shell 转义）
                await this.sendCommand(sessionName, `cd ${projectDir}`);
            }
            const statusText = currentStatus === SessionStatus.Ready ? "Claude 已就绪" : "正在启动";
            return `✅ tmux 会话 "${sessionName}" 已在运行\n📁 工作目录: ${projectDir || "~/"}\n📊 状态: ${statusText}`;
        }

        // 创建新会话
        try {
            // P0 修复：校验路径安全性
            if (projectDir && !isSafePath(projectDir)) {
                throw new Error(`Invalid project directory: ${projectDir}`);
            }
            const dirArg = projectDir ? `-c ${shellEscapeSingleQuote(projectDir)}` : "";
            // 注意：这里仍用 execAsync，需要 shell 转义；sendCommand 则无需
            await execAsync(`tmux new-session -d -s ${sessionName} ${dirArg}`, { timeout: 5000 });

            // 发送 claude 命令启动（参考 telecode）
            await this.sendCommand(sessionName, "claude --dangerously-skip-permissions");

            // 等待 Claude 启动，然后发送 Enter 跳过可能的确认对话框
            await new Promise(r => setTimeout(r, 2000));
            await this.sendCommand(sessionName, "");  // 发送 Enter 键

            // 等待 Claude 就绪（最多 30 秒）
            const ready = await this.waitForReady(sessionName, READY_WAIT_TIMEOUT_MS);
            state.status = ready ? SessionStatus.Ready : SessionStatus.Starting;

            const dirInfo = projectDir ? `\n📁 工作目录: ${projectDir}` : "";
            const elapsed = Date.now() - startTime;
            if (!ready && elapsed > STARTUP_SLOW_THRESHOLD_MS) {
                logger.warn(`⚠️ Claude 启动异常: ${elapsed}ms 未就绪`, { module: "tmux", sessionName, elapsed });
            }
            const readyInfo = ready
                ? "\n🤖 Claude 已就绪"
                : elapsed > STARTUP_SLOW_THRESHOLD_MS
                    ? "\n⚠️ Claude 启动异常（超过10秒未就绪）"
                    : "\n⏳ Claude 正在启动...";
            return `✅ 已启动 tmux 会话 "${sessionName}"${dirInfo}${readyInfo}`;
        } catch (error: any) {
            this.sessions.delete(sessionName);
            throw new Error(`启动失败: ${error.message}`);
        }
    }

    /**
     * 停止 tmux 会话
     */
    static async stop(groupName: string): Promise<string> {
        const sessionName = this.getSessionName(groupName);

        try {
            await execAsync(`tmux kill-session -t ${sessionName}`, { timeout: 5000 });
            this.sessions.delete(sessionName);
            return `✅ 已关闭 tmux 会话 "${sessionName}"`;
        } catch (error: any) {
            if (error.message.includes("session not found")) {
                return `⚠️  tmux 会话 "${sessionName}" 未运行`;
            }
            throw error;
        }
    }

    /**
     * 获取会话状态
     */
    static async status(groupName: string): Promise<string> {
        const sessionName = this.getSessionName(groupName);
        const status = await this.getStatus(sessionName);

        if (status === SessionStatus.Stopped) {
            return `⚠️  tmux 会话 "${sessionName}" 未运行`;
        }

        const state = this.sessions.get(sessionName);
        const dirInfo = state?.projectDir ? `\n📁 工作目录: ${state.projectDir}` : "";
        const statusText = status === SessionStatus.Ready ? "🤖 Claude 已就绪" : "⏳ 正在启动";
        return `✅ tmux 会话 "${sessionName}" 正在运行${dirInfo}\n📊 状态: ${statusText}`;
    }

    /**
     * 在会话中执行命令
     *
     * P0 安全修复：使用 spawn 传递参数，避免 shell 命令注入
     * tmux send-keys 直接接收字符串参数，无需 shell 解析
     */
    static async sendCommand(sessionName: string, command: string): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const proc = spawn("tmux", ["send-keys", "-t", sessionName, command, "Enter"]);

            // 5秒超时计时器
            const timeoutId = setTimeout(() => {
                if (!settled && !proc.killed) {
                    proc.kill();
                    settled = true;
                    reject(new Error("tmux send-keys timeout"));
                }
            }, 5000);

            proc.on("close", (code: number | null) => {
                clearTimeout(timeoutId);
                if (settled) return;  // 已被超时处理
                settled = true;
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`tmux send-keys exited with code ${code}`));
                }
            });

            proc.on("error", (err: Error) => {
                clearTimeout(timeoutId);
                if (settled) return;
                settled = true;
                reject(err);
            });
        });
    }

    /**
     * 发送 ESC 键
     */
    static async sendEscape(sessionName: string): Promise<void> {
        await execAsync(`tmux send-keys -t ${sessionName} Escape`, { timeout: 5000 });
    }

    /**
     * 获取终端快照
     */
    static async capturePane(sessionName: string, lines: number = 100): Promise<string> {
        try {
            const { stdout } = await execAsync(
                `tmux capture-pane -t ${sessionName} -p -S -${lines}`,
                { timeout: 5000 }
            );
            return stdout.trim();
        } catch {
            return "";
        }
    }

    /**
     * 等待 Claude 就绪
     */
    private static async waitForReady(sessionName: string, timeout: number): Promise<boolean> {
        const start = Date.now();
        const checkInterval = 1000; // 每秒检查一次

        while (Date.now() - start < timeout) {
            const status = await this.getStatus(sessionName);
            if (status === SessionStatus.Ready) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        return false;
    }

    /**
     * 检查会话是否存在
     */
    static async exists(groupName: string): Promise<boolean> {
        const sessionName = this.getSessionName(groupName);
        const status = await this.getStatus(sessionName);
        return status !== SessionStatus.Stopped;
    }
}

/**
 * 会话状态
 */
interface SessionState {
    groupName: string;
    projectDir?: string;
    status: SessionStatus;
}

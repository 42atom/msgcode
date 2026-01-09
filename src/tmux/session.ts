/**
 * msgcode: tmux 会话管理
 *
 * 管理与 Claude Code 的 tmux 会话
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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

        // 检查会话是否已存在
        const currentStatus = await this.getStatus(sessionName);
        if (currentStatus !== SessionStatus.Stopped) {
            // 会话已存在，更新工作目录
            if (projectDir) {
                await execAsync(`tmux send-keys -t ${sessionName} "cd ${projectDir}" Enter`, { timeout: 5000 });
            }
            const statusText = currentStatus === SessionStatus.Ready ? "Claude 已就绪" : "正在启动";
            return `✅ tmux 会话 "${sessionName}" 已在运行\n📁 工作目录: ${projectDir || "~/"}\n📊 状态: ${statusText}`;
        }

        // 创建新会话
        try {
            const dirArg = projectDir ? `-c "${projectDir}"` : "";
            await execAsync(`tmux new-session -d -s ${sessionName} ${dirArg}`, { timeout: 5000 });

            // 发送 claude 命令启动
            await this.sendCommand(sessionName, "claude");

            // 等待 Claude 就绪（最多 30 秒）
            const ready = await this.waitForReady(sessionName, 30000);
            state.status = ready ? SessionStatus.Ready : SessionStatus.Starting;

            const dirInfo = projectDir ? `\n📁 工作目录: ${projectDir}` : "";
            const readyInfo = ready ? "\n🤖 Claude 已就绪" : "\n⏳ Claude 正在启动...";
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
     */
    static async sendCommand(sessionName: string, command: string): Promise<void> {
        // 转义命令中的双引号和反斜杠
        const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        await execAsync(`tmux send-keys -t ${sessionName} "${escaped}" Enter`, { timeout: 5000 });
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

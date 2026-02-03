/**
 * msgcode: 连接探针
 *
 * 检查 imsg RPC 和 tmux 连接状态
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../../config.js";
import { withTimeout } from "../types.js";
import type { ProbeResult, ProbeOptions } from "../types.js";

const execAsync = promisify(exec);

/**
 * 连接探针
 */
export async function probeConnections(options?: ProbeOptions): Promise<ProbeResult> {
    const details: Record<string, unknown> = {};
    const issues: string[] = [];

    const timeout = options?.timeout ?? 2000;

    // 1. imsg RPC 连接（通过检查 imsg 二进制和尝试运行）
    try {
        // 检查 imsg 是否可执行
        await withTimeout(
            execAsync(`"${config.imsgPath}" --version`),
            timeout,
            "imsg --version"
        );
        details.imsg_executable = true;
    } catch {
        details.imsg_executable = false;
        issues.push("imsg 不可用");
    }

    // 2. tmux 连接（先检查二进制，再检查 server）
    let tmuxInstalled = false;

    // 2.1 检查 tmux 是否安装
    try {
        await withTimeout(
            execAsync("tmux -V"),
            timeout,
            "tmux -V"
        );
        tmuxInstalled = true;
        details.tmux_installed = true;
    } catch {
        details.tmux_installed = false;
        details.tmux_server_running = false;
        issues.push("tmux 未安装");
    }

    // 2.2 检查 tmux server 是否运行
    if (tmuxInstalled) {
        try {
            await withTimeout(
                execAsync("tmux list-sessions"),
                timeout,
                "tmux list-sessions"
            );
            details.tmux_server_running = true;

            // 列出 msgcode 会话
            const { stdout } = await execAsync("tmux list-sessions -F '#{session_name}'");
            const sessions = stdout.trim().split("\n").filter(s => s.startsWith("msgcode-"));
            details.tmux_msgcode_sessions = sessions.length;
        } catch {
            details.tmux_server_running = false;
            // tmux 已安装但 server 没跑，给 warning（不影响可用性判定）
            issues.push("tmux server 未运行（群里 /start 或运行 `tmux start-server` 启动）");
        }
    }

    // tmux 的可用性判定：已安装即算可用（server 没跑只是 warning）
    details.tmux_available = tmuxInstalled;

    // 3. Claude CLI
    try {
        await withTimeout(
            execAsync("claude --version"),
            timeout,
            "claude --version"
        );
        details.claude_cli_available = true;
    } catch {
        details.claude_cli_available = false;
        issues.push("Claude CLI 不可用");
    }

    // 判断状态
    let status: ProbeResult["status"] = "pass";
    if (!details.imsg_executable || !details.tmux_available) {
        status = "error";
    } else if (issues.length > 0) {
        status = "warning";
    }

    return {
        name: "connections",
        status,
        message: issues.length > 0 ? issues.join("; ") : "连接检查通过",
        details,
    };
}

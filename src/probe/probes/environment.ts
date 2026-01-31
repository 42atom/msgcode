/**
 * msgcode: 环境探针
 *
 * 检查 macOS 版本、Node.js 版本、imsg 二进制、Claude CLI
 */

import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { config } from "../../config.js";
import type { ProbeResult, ProbeOptions } from "../types.js";

const execAsync = promisify(exec);

/**
 * 环境探针
 */
export async function probeEnvironment(options?: ProbeOptions): Promise<ProbeResult> {
    const details: Record<string, unknown> = {};
    const issues: string[] = [];

    // 1. macOS 版本
    const macosVersion = os.release();
    details.macos_version = macosVersion;
    const majorVersion = parseInt(macosVersion.split(".")[0], 10);
    if (majorVersion < 21) {
        issues.push("macOS 版本过低（建议 >= 11.0 Big Sur）");
    }

    // 2. Node.js 版本
    const nodeVersion = process.version;
    details.node_version = nodeVersion;
    const majorNodeVersion = parseInt(nodeVersion.slice(1).split(".")[0], 10);
    if (majorNodeVersion < 18) {
        issues.push("Node.js 版本过低（要求 >= 18.0）");
    }

    // 3. imsg 二进制
    const imsgPath = config.imsgPath;
    details.imsg_path = imsgPath;
    const imsgExists = existsSync(imsgPath);
    details.imsg_executable = imsgExists;
    if (!imsgExists) {
        issues.push(`imsg 二进制不存在: ${imsgPath}`);
    } else {
        // 尝试获取 imsg 版本
        try {
            const { stdout } = await execAsync(`"${imsgPath}" --version`, { timeout: 2000 });
            details.imsg_version = stdout.trim();
        } catch {
            // 版本获取失败，但二进制存在
        }
    }

    // 4. Claude CLI
    try {
        const { stdout } = await execAsync("claude --version", { timeout: 2000 });
        details.claude_cli = true;
        details.claude_version = stdout.trim();
    } catch {
        details.claude_cli = false;
        issues.push("Claude CLI 不可用");
    }

    // 5. tmux
    try {
        const { stdout } = await execAsync("tmux -V", { timeout: 2000 });
        details.tmux = true;
        details.tmux_version = stdout.trim();
    } catch {
        details.tmux = false;
        issues.push("tmux 不可用");
    }

    // 判断状态
    let status: ProbeResult["status"] = "pass";
    if (majorNodeVersion < 18 || !imsgExists) {
        status = "error";
    } else if (issues.length > 0) {
        status = "warning";
    }

    return {
        name: "environment",
        status,
        message: issues.length > 0 ? issues.join("; ") : "环境检查通过",
        details,
    };
}

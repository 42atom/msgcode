/**
 * msgcode: 权限探针
 *
 * 检查文件系统访问权限
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../../config.js";
import type { ProbeResult, ProbeOptions } from "../types.js";

/**
 * 权限探针
 */
export async function probePermissions(options?: ProbeOptions): Promise<ProbeResult> {
    const details: Record<string, unknown> = {};
    const issues: string[] = [];

    // 1. ~/Library/Messages 访问权限
    const messagesPath = path.join(os.homedir(), "Library/Messages");
    try {
        await fs.access(messagesPath, fs.constants.R_OK);
        details.messages_readable = true;
    } catch {
        details.messages_readable = false;
        issues.push("~/Library/Messages 不可读");
    }

    // 2. ~/.config/msgcode 写权限
    const configDir = path.join(os.homedir(), ".config/msgcode");
    try {
        await fs.access(configDir, fs.constants.W_OK);
        details.config_writable = true;
    } catch {
        details.config_writable = false;
        issues.push("~/.config/msgcode 不可写");
    }

    // 3. WORKSPACE_ROOT 访问权限
    try {
        await fs.access(config.workspaceRoot, fs.constants.R_OK | fs.constants.W_OK);
        details.workspace_root_accessible = true;
    } catch {
        details.workspace_root_accessible = false;
        issues.push("WORKSPACE_ROOT 不可访问");
    }

    // 4. 完全磁盘访问（通过检查 Messages 数据库来推断）
    const dbPath = config.imsgDbPath || path.join(os.homedir(), "Library/Messages/chat.db");
    try {
        await fs.access(dbPath, fs.constants.R_OK);
        details.full_disk_access = true;
    } catch {
        details.full_disk_access = false;
        issues.push("完全磁盘访问可能未授权（无法读取 chat.db）");
    }

    // 判断状态
    let status: ProbeResult["status"] = "pass";
    if (!details.messages_readable || !details.full_disk_access) {
        status = "error";
    } else if (issues.length > 0) {
        status = "warning";
    }

    return {
        name: "permissions",
        status,
        message: issues.length > 0 ? issues.join("; ") : "权限检查通过",
        details,
    };
}

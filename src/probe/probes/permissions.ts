/**
 * msgcode: 权限探针
 *
 * 检查当前正式主链需要的文件系统访问权限
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
    void options;
    const details: Record<string, unknown> = {};
    const issues: string[] = [];

    // 1. ~/.config/msgcode 写权限
    const configDir = path.join(os.homedir(), ".config/msgcode");
    try {
        await fs.access(configDir, fs.constants.W_OK);
        details.config_writable = true;
    } catch {
        details.config_writable = false;
        issues.push("~/.config/msgcode 不可写");
    }

    // 2. WORKSPACE_ROOT 访问权限
    try {
        await fs.access(config.workspaceRoot, fs.constants.R_OK | fs.constants.W_OK);
        details.workspace_root_accessible = true;
    } catch {
        details.workspace_root_accessible = false;
        issues.push("WORKSPACE_ROOT 不可访问");
    }

    // 判断状态
    let status: ProbeResult["status"] = "pass";
    if (!details.config_writable || !details.workspace_root_accessible) {
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

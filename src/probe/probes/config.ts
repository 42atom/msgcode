/**
 * msgcode: 配置探针
 *
 * 检查 .env 文件和环境变量
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../../config.js";
import type { ProbeResult, ProbeOptions } from "../types.js";

/**
 * 配置探针
 */
export async function probeConfig(options?: ProbeOptions): Promise<ProbeResult> {
    const details: Record<string, unknown> = {};
    const issues: string[] = [];

    // 1. .env 文件存在性（检查多个位置）
    const userConfig = path.join(os.homedir(), ".config/msgcode/.env");
    const projectConfig = path.join(process.cwd(), ".env");

    const userEnvExists = existsSync(userConfig);
    const projectEnvExists = existsSync(projectConfig);

    details.env_file_user = userEnvExists;
    details.env_file_project = projectEnvExists;

    if (!userEnvExists && !projectEnvExists) {
        issues.push(".env 文件不存在");
    }

    // 2. 必需环境变量（已设置但不输出值）
    details.imsg_path_set = !!config.imsgPath;
    details.whitelist_phones_count = config.whitelist.phones.length;
    details.whitelist_emails_count = config.whitelist.emails.length;

    if (!config.imsgPath) {
        issues.push("IMSG_PATH 未设置");
    }
    if (config.whitelist.phones.length === 0 && config.whitelist.emails.length === 0) {
        issues.push("白名单为空（MY_PHONE/MY_EMAIL）");
    }

    // 3. WORKSPACE_ROOT 可访问性
    details.workspace_root = config.workspaceRoot;
    try {
        const { existsSync } = await import("node:fs");
        details.workspace_root_exists = existsSync(config.workspaceRoot);
        if (!details.workspace_root_exists) {
            issues.push("WORKSPACE_ROOT 目录不存在");
        }
    } catch {
        details.workspace_root_accessible = false;
    }

    // 4. lmstudio 配置（可选）
    details.lmstudio_configured = !!config.lmstudioBaseUrl;

    // 判断状态
    let status: ProbeResult["status"] = "pass";
    if (!config.imsgPath || (config.whitelist.phones.length === 0 && config.whitelist.emails.length === 0)) {
        status = "error";
    } else if (issues.length > 0) {
        status = "warning";
    }

    return {
        name: "config",
        status,
        message: issues.length > 0 ? issues.join("; ") : "配置检查通过",
        details,
    };
}

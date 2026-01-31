/**
 * msgcode: status 命令
 *
 * 输出当前配置摘要（只读、快速、无副作用）
 */

import { config } from "../config.js";
import * as os from "node:os";
import * as path from "node:path";
import { existsSync } from "node:fs";

/**
 * 输出配置摘要
 */
export async function statusCommand(): Promise<void> {
    const configDir = path.join(os.homedir(), ".config/msgcode");
    const logDir = path.join(configDir, "log");
    const logFile = path.join(logDir, "msgcode.log");
    const routesFile = path.join(configDir, "routes.json");

    console.log("msgcode 2.0 status\n");

    // 白名单
    console.log("Whitelist:");
    if (config.whitelist.emails.length > 0) {
        console.log(`  Emails: ${config.whitelist.emails.join(", ")}`);
    }
    if (config.whitelist.phones.length > 0) {
        console.log(`  Phones: ${config.whitelist.phones.join(", ")}`);
    }
    if (config.whitelist.emails.length === 0 && config.whitelist.phones.length === 0) {
        console.log("  (none)");
    }

    // 群组路由
    console.log("\nGroup Routes:");
    for (const [name, route] of config.groupRoutes.entries()) {
        const projectDir = route.projectDir || "(no project)";
        console.log(`  ${name}: ${route.chatId} -> ${projectDir}`);
    }
    if (config.groupRoutes.size === 0) {
        console.log("  (none)");
    }

    // 默认群组
    console.log("\nDefault Group:");
    console.log(`  ${config.defaultGroup || "(not set)"}`);

    // 日志配置
    console.log("\nLogging:");
    console.log(`  Level: ${config.logLevel}`);
    console.log(`  File: ${logFile}${existsSync(logFile) ? " (exists)" : " (not created)"}`);

    // 路由存储
    console.log("\nRoute Storage:");
    console.log(`  Path: ${routesFile}${existsSync(routesFile) ? " (exists)" : " (not created)"}`);

    // 工作空间
    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(os.homedir(), "msgcode-workspaces");
    console.log("\nWorkspace:");
    console.log(`  Root: ${workspaceRoot}${existsSync(workspaceRoot) ? "" : " (not created)"}`);

    // 高级选项
    console.log("\nAdvanced:");
    console.log(`  File Watcher: ${config.useFileWatcher ? "enabled" : "disabled"}`);
    console.log(`  Skip Unread Backlog: ${config.skipUnreadBacklog ? "yes" : "no"}`);

    console.log("");
}

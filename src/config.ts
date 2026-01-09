/**
 * matcode-mac: 配置加载模块
 *
 * 从 .env 文件加载配置，提供类型安全的配置访问
 */

import dotenv from "dotenv";

// 加载 .env
dotenv.config();

/**
 * 群组配置
 */
export interface GroupConfig {
    chatId: string;
    projectDir?: string;
    botType?: string;
}

/**
 * 白名单配置
 */
export interface WhitelistConfig {
    phones: string[];
    emails: string[];
}

/**
 * 完整配置
 */
export interface Config {
    // 白名单
    whitelist: WhitelistConfig;
    // 群组路由：群组名 → 配置
    groupRoutes: Map<string, GroupConfig>;
    // 默认群组
    defaultGroup: string | null;
    // 日志级别
    logLevel: "debug" | "info" | "warn" | "error";
    // 是否使用文件监听模式 (Phase 2 功能)
    useFileWatcher: boolean;
}

/**
 * 解析电话号码列表
 */
function parsePhones(value: string | undefined): string[] {
    if (!value) return [];
    return value.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * 解析邮箱列表
 */
function parseEmails(value: string | undefined): string[] {
    if (!value) return [];
    return value.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * 解析群组配置
 * 格式: GROUP_<名称>=<chatId>[:<项目目录>[:<bot类型>]]
 */
function parseGroupConfig(value: string): GroupConfig {
    const parts = value.split(":");
    return {
        chatId: parts[0],
        projectDir: parts[1],
        botType: parts[2],
    };
}

/**
 * 解析群组路由配置
 */
function parseGroupRoutes(): Map<string, GroupConfig> {
    const routes = new Map<string, GroupConfig>();

    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith("GROUP_") && value) {
            const name = key.replace("GROUP_", "").toLowerCase();
            routes.set(name, parseGroupConfig(value));
        }
    }

    return routes;
}

/**
 * 加载配置
 */
export function loadConfig(): Config {
    const phones = parsePhones(process.env.MY_PHONE);
    const emails = parseEmails(process.env.MY_EMAIL);

    if (phones.length === 0 && emails.length === 0) {
        console.warn("⚠️  警告: 未配置白名单 (MY_PHONE 或 MY_EMAIL)");
    }

    return {
        whitelist: {
            phones,
            emails,
        },
        groupRoutes: parseGroupRoutes(),
        defaultGroup: process.env.DEFAULT_GROUP || null,
        logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) || "info",
        useFileWatcher: process.env.USE_FILE_WATCHER === "true",
    };
}

/**
 * 全局配置实例
 */
export const config = loadConfig();

/**
 * 检查是否在白名单中
 */
export function isWhitelisted(identifier: string): boolean {
    const { whitelist } = config;

    // 检查电话号码（支持多种格式）
    for (const phone of whitelist.phones) {
        const normalizedPhone = phone.replace(/\D/g, ""); // 移除非数字
        const normalizedIdentifier = identifier.replace(/\D/g, "");
        if (normalizedIdentifier.includes(normalizedPhone) || normalizedPhone.includes(normalizedIdentifier)) {
            return true;
        }
    }

    // 检查邮箱
    for (const email of whitelist.emails) {
        if (identifier.toLowerCase() === email.toLowerCase()) {
            return true;
        }
    }

    return false;
}

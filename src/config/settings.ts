/**
 * msgcode: 持久化设置（独立于 .env）
 *
 * 用途：
 * - /loglevel 等用户可调整的配置
 * - 不覆盖用户手工配置的 .env
 *
 * 优先级：ENV > settings.json > 默认值
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logger } from "../logger/index.js";

// P0: 测试/多实例隔离：允许用环境变量覆盖配置目录
// - 默认：~/.config/msgcode
// - 覆盖：MSGCODE_CONFIG_DIR=/custom/path
const SETTINGS_DIR = process.env.MSGCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "msgcode");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

/**
 * 设置数据结构
 */
export interface Settings {
    version: number;
    logLevel?: "debug" | "info" | "warn" | "error";
    updatedAtMs: number;
}

/**
 * 默认设置
 */
const DEFAULT_SETTINGS: Settings = {
    version: 1,
    updatedAtMs: 0,
};

/**
 * 读取设置（文件不存在时返回默认值）
 */
export async function readSettings(): Promise<Settings> {
    try {
        const content = await fs.readFile(SETTINGS_FILE, "utf-8");
        const parsed = JSON.parse(content) as Partial<Settings>;
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
        // 文件不存在或解析失败，返回默认值
        return DEFAULT_SETTINGS;
    }
}

/**
 * 写入设置
 */
export async function writeSettings(settings: Settings): Promise<void> {
    try {
        // 确保目录存在
        await fs.mkdir(SETTINGS_DIR, { recursive: true });
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
    } catch (error) {
        logger.error("写入设置失败", { module: "settings", error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}

/**
 * 更新日志级别（持久化）
 */
export async function setLogLevel(level: "debug" | "info" | "warn" | "error"): Promise<void> {
    const current = await readSettings();
    const updated: Settings = {
        ...current,
        logLevel: level,
        updatedAtMs: Date.now(),
    };
    await writeSettings(updated);
}

/**
 * 重置日志级别（删除持久化配置）
 */
export async function resetLogLevel(): Promise<void> {
    const current = await readSettings();
    const updated: Settings = {
        ...current,
        logLevel: undefined,
        updatedAtMs: Date.now(),
    };
    await writeSettings(updated);
}

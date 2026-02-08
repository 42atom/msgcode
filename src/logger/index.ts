/**
 * msgcode: 日志系统
 *
 * 轻量级日志实现，支持多传输器、日志级别、文件轮转
 */

import type { ConsoleTransport } from "./console-transport.js";
import type { FileTransport } from "./file-transport.js";
import { ConsoleTransport as ConsoleTransportClass } from "./console-transport.js";
import { FileTransport as FileTransportClass } from "./file-transport.js";

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 日志级别优先级（数字越大优先级越高）
 */
const LevelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

/**
 * 日志条目
 */
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    module?: string;
    traceId?: string;  // 链路追踪 ID，用于关联完整请求流程
    meta?: Record<string, any>;
}

/**
 * 传输器接口
 */
export interface Transport {
    write(entry: LogEntry): void;
}

/**
 * 传输器选项（基类）
 */
export interface TransportOptions {
    /**
     * 最低日志级别
     */
    level?: LogLevel;
}

/**
 * Logger 配置选项
 */
export interface LoggerOptions {
    /**
     * 日志级别
     */
    level?: LogLevel;

    /**
     * 传输器列表
     */
    transports?: Transport[];
}

/**
 * Logger 类
 */
export class Logger {
    private _level: LogLevel;  // 重命名为 _level 避免 private 访问问题
    private transports: Transport[];

    constructor(options: LoggerOptions = {}) {
        this._level = options.level ?? "info";
        this.transports = options.transports ?? [];
    }

    /**
     * 判断是否应该输出该级别的日志
     */
    private shouldLog(level: LogLevel): boolean {
        return LevelPriority[level] >= LevelPriority[this._level];
    }

    /**
     * 记录日志
     */
    private log(level: LogLevel, message: string, meta?: Record<string, any>, traceId?: string): void {
        if (!this.shouldLog(level)) {
            return;
        }

        // 生成时间戳：YYYY-MM-DD HH:MM:SS.mmm（毫秒精度）
        const now = new Date();
        const timestamp = now.toISOString().replace("T", " ").replace("Z", "").slice(0, 23);

        // 构建日志条目（meta 不展开到顶层，保持结构化）
        const entry: LogEntry = {
            timestamp,
            level,
            message,
            module: meta?.module,
            traceId,  // 添加 traceId
            meta,
        };

        // 写入所有传输器
        for (const transport of this.transports) {
            try {
                transport.write(entry);
            } catch (error: any) {
                // 传输器写入失败，输出到 console 并继续
                console.error(`[Logger Error] ${error.message}`);
            }
        }
    }

    /**
     * DEBUG 级别日志
     */
    debug(message: string, meta?: Record<string, any>, traceId?: string): void {
        this.log("debug", message, meta, traceId);
    }

    /**
     * INFO 级别日志
     */
    info(message: string, meta?: Record<string, any>, traceId?: string): void {
        this.log("info", message, meta, traceId);
    }

    /**
     * WARN 级别日志
     */
    warn(message: string, meta?: Record<string, any>, traceId?: string): void {
        this.log("warn", message, meta, traceId);
    }

    /**
     * ERROR 级别日志
     */
    error(message: string, meta?: Record<string, any>, traceId?: string): void {
        this.log("error", message, meta, traceId);
    }

    /**
     * 设置日志级别
     */
    setLevel(level: LogLevel): void {
        this._level = level;
    }

    /**
     * 重置日志级别到 settings.json 的值（用于 /loglevel reset）
     */
    async resetLevelFromSettings(): Promise<void> {
        // 如果 ENV 已设置，不重置（ENV 优先级最高）
        if (process.env.LOG_LEVEL) {
            return;
        }

        try {
            const { readSettings } = await import("../config/settings.js");
            const settings = await readSettings();
            if (settings.logLevel) {
                this._level = settings.logLevel;
                currentLevelSource = "settings";
            } else {
                this._level = "info";
                currentLevelSource = "default";
            }
        } catch {
            // settings 读取失败，恢复默认值
            this._level = "info";
            currentLevelSource = "default";
        }
    }

    /**
     * 添加传输器
     */
    addTransport(transport: Transport): void {
        this.transports.push(transport);
    }

    /**
     * 关闭所有传输器
     */
    close(): void {
        for (const transport of this.transports) {
            if ("close" in transport && typeof transport.close === "function") {
                (transport as any).close();
            }
        }
    }

    /**
     * 获取当前日志级别
     */
    getCurrentLevel(): LogLevel {
        return this._level;
    }
}

/**
 * 创建 Logger 单例
 *
 * 注意：这里是同步初始化，只从 ENV 读取。
 * settings.json 的读取在 initLoggerFromSettings() 中异步进行。
 */
function createLogger(): Logger {
    // 1. 优先从环境变量读取日志级别
    const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
    const level = envLevel ?? "info";

    // 验证日志级别
    const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
    const normalizedLevel = validLevels.includes(level) ? level : "info";

    // 创建传输器
    const transports: Transport[] = [];

    // 控制台传输器（可选）
    const shouldConsoleLog = process.env.LOG_CONSOLE !== "false";
    if (shouldConsoleLog) {
        transports.push(new ConsoleTransportClass({ colorize: true }));
    }

    // 文件传输器（可选）
    if (process.env.LOG_FILE !== "false") {
        try {
            const logPath = process.env.LOG_PATH ?? "~/.config/msgcode/log/msgcode.log";
            transports.push(new FileTransportClass({
                filename: logPath,
                maxSize: 10 * 1024 * 1024, // 10MB
                maxFiles: 3,
            }));
        } catch (error: any) {
            console.warn(`文件日志初始化失败: ${error.message}`);
        }
    }

    // 创建 logger
    const logger = new Logger({
        level: normalizedLevel,
        transports,
    });

    return logger;
}

/**
 * Logger 单例
 */
export const logger = createLogger();

/**
 * 导出便捷函数：设置日志级别
 */
export function setLogLevel(level: LogLevel): void {
    logger.setLevel(level);
}

/**
 * 导出便捷函数：重置日志级别
 */
export async function resetLogLevel(): Promise<void> {
    await logger.resetLevelFromSettings();
}

/**
 * 记录当前日志级别的来源
 */
let currentLevelSource: "env" | "settings" | "default" = "default";

/**
 * 从 settings.json 初始化日志级别（异步）
 *
 * 优先级：ENV > settings.json > 默认值
 * 如果 ENV 已设置，settings.json 会被忽略
 */
export async function initLoggerFromSettings(): Promise<void> {
    // 如果 ENV 已设置，不读取 settings（ENV 优先级最高）
    if (process.env.LOG_LEVEL) {
        currentLevelSource = "env";
        return;
    }

    try {
        const { readSettings } = await import("../config/settings.js");
        const settings = await readSettings();
        if (settings.logLevel) {
            logger.setLevel(settings.logLevel);
            currentLevelSource = "settings";
        }
    } catch {
        // settings 读取失败，保持默认值
        currentLevelSource = "default";
    }
}

/**
 * 获取当前日志级别的来源（用于 /loglevel 命令）
 *
 * 优先级：ENV > settings > logger 当前值
 * 注意：这里返回的"当前级别"是按照优先级确定的，不一定是 logger 的实际级别
 */
export function getLogLevelSource(): { level: string; source: "env" | "settings" | "default" } {
    // 1. 优先级最高：ENV
    if (process.env.LOG_LEVEL) {
        const envLevel = process.env.LOG_LEVEL as LogLevel;
        const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
        if (validLevels.includes(envLevel)) {
            return { level: envLevel, source: "env" };
        }
    }

    // 2. 次优先级：settings.json (通过 currentLevelSource 判断)
    if (currentLevelSource === "settings") {
        return { level: logger.getCurrentLevel(), source: "settings" };
    }

    // 3. 默认值
    return { level: logger.getCurrentLevel(), source: "default" };
}

/**
 * 进程退出时关闭日志
 */
process.on("exit", () => {
    logger.close();
});

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
    private level: LogLevel;
    private transports: Transport[];

    constructor(options: LoggerOptions = {}) {
        this.level = options.level ?? "info";
        this.transports = options.transports ?? [];
    }

    /**
     * 判断是否应该输出该级别的日志
     */
    private shouldLog(level: LogLevel): boolean {
        return LevelPriority[level] >= LevelPriority[this.level];
    }

    /**
     * 记录日志
     */
    private log(level: LogLevel, message: string, meta?: Record<string, any>): void {
        if (!this.shouldLog(level)) {
            return;
        }

        // 生成时间戳：YYYY-MM-DD HH:MM:SS
        const now = new Date();
        const timestamp = now.toISOString().replace("T", " ").slice(0, 19);

        // 构建日志条目
        const entry: LogEntry = {
            timestamp,
            level,
            message,
            ...meta,
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
    debug(message: string, meta?: Record<string, any>): void {
        this.log("debug", message, meta);
    }

    /**
     * INFO 级别日志
     */
    info(message: string, meta?: Record<string, any>): void {
        this.log("info", message, meta);
    }

    /**
     * WARN 级别日志
     */
    warn(message: string, meta?: Record<string, any>): void {
        this.log("warn", message, meta);
    }

    /**
     * ERROR 级别日志
     */
    error(message: string, meta?: Record<string, any>): void {
        this.log("error", message, meta);
    }

    /**
     * 设置日志级别
     */
    setLevel(level: LogLevel): void {
        this.level = level;
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
}

/**
 * 创建 Logger 单例
 */
function createLogger(): Logger {
    // 从环境变量读取日志级别
    const level = (process.env.LOG_LEVEL ?? "info") as LogLevel;

    // 验证日志级别
    const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
    const normalizedLevel = validLevels.includes(level) ? level : "info";

    // 创建传输器
    const transports: Transport[] = [];

    // 控制台传输器（始终启用）
    transports.push(new ConsoleTransportClass({ colorize: true }));

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
            console.warn(`⚠️  文件日志初始化失败: ${error.message}`);
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
 * 进程退出时关闭日志
 */
process.on("exit", () => {
    logger.close();
});

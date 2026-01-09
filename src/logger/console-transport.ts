/**
 * msgcode: 控制台日志传输器
 *
 * 负责将日志输出到控制台，支持彩色格式
 */

import type { LogEntry, Transport, TransportOptions } from "./index.js";

/**
 * 控制台传输器选项
 */
export interface ConsoleTransportOptions extends TransportOptions {
    /**
     * 是否启用彩色输出
     */
    colorize?: boolean;
}

/**
 * ANSI 颜色代码
 */
const Colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",

    // 前景色
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
} as const;

/**
 * 日志级别对应的颜色
 */
const LevelColors: Record<string, string> = {
    DEBUG: Colors.cyan,
    INFO: Colors.green,
    WARN: Colors.yellow,
    ERROR: Colors.red,
};

/**
 * 控制台日志传输器
 */
export class ConsoleTransport implements Transport {
    private colorize: boolean;

    constructor(options: ConsoleTransportOptions = {}) {
        this.colorize = options.colorize ?? true;
    }

    /**
     * 写入日志到控制台
     */
    write(entry: LogEntry): void {
        const message = this.format(entry);
        const consoleMethod = this.getConsoleMethod(entry.level);

        consoleMethod(message);
    }

    /**
     * 格式化日志消息
     */
    private format(entry: LogEntry): string {
        const { timestamp, level, message, module } = entry;

        // 时间戳
        const timeStr = timestamp;
        const levelStr = level.toUpperCase().padEnd(5);
        const moduleStr = module ? `[${module}] ` : "";

        // 如果禁用颜色，直接返回纯文本
        if (!this.colorify) {
            return `${timeStr} [${levelStr}] ${moduleStr}${message}`;
        }

        // 带颜色的格式
        const levelColor = LevelColors[level.toUpperCase()] || Colors.white;
        const coloredLevel = `${levelColor}${levelStr}${Colors.reset}`;

        return `${timeStr} [${coloredLevel}] ${moduleStr}${message}`;
    }

    /**
     * 根据日志级别返回对应的 console 方法
     */
    private getConsoleMethod(level: string): (...args: any[]) => void {
        switch (level.toLowerCase()) {
            case "error":
                return console.error;
            case "warn":
                return console.warn;
            case "debug":
                return console.debug;
            case "info":
            default:
                return console.log;
        }
    }
}

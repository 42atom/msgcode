/**
 * msgcode: 文件日志传输器
 *
 * 负责将日志写入文件，支持按大小自动轮转
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { LogEntry, Transport, TransportOptions } from "./index.js";

/**
 * 文件传输器选项
 */
export interface FileTransportOptions extends TransportOptions {
    /**
     * 日志文件路径（支持 ~ 开头）
     */
    filename: string;

    /**
     * 单个日志文件最大大小（字节）
     * 默认：10MB
     */
    maxSize?: number;

    /**
     * 保留的历史日志文件数量
     * 默认：3
     */
    maxFiles?: number;
}

/**
 * 文件日志传输器（支持轮转）
 */
export class FileTransport implements Transport {
    private filename: string;
    private maxSize: number;
    private maxFiles: number;
    private stream: fs.WriteStream | null = null;
    private currentSize: number = 0;
    private disabled: boolean = false;

    constructor(options: FileTransportOptions) {
        // 展开路径中的 ~
        this.filename = this.expandPath(options.filename);
        this.maxSize = options.maxSize ?? 10 * 1024 * 1024; // 默认 10MB
        this.maxFiles = options.maxFiles ?? 3;

        this.initialize();
    }

    /**
     * 初始化文件传输器
     */
    private initialize(): void {
        try {
            this.ensureDir();
            this.openStream();
        } catch (error: any) {
            console.error(`[FileTransport] 初始化失败: ${error.message}`);
            console.error(`   日志文件: ${this.filename}`);
            console.error(`   将只输出到控制台`);
            this.disabled = true;
        }
    }

    /**
     * 确保日志目录存在
     */
    private ensureDir(): void {
        const dir = path.dirname(this.filename);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * 打开文件流
     */
    private openStream(): void {
        // 如果文件存在，获取当前大小
        if (fs.existsSync(this.filename)) {
            const stats = fs.statSync(this.filename);
            this.currentSize = stats.size;

            // 如果当前文件已超过最大大小，先轮转
            if (this.currentSize >= this.maxSize) {
                this.rotate();
            }
        } else {
            this.currentSize = 0;
        }

        // 以追加模式打开文件流
        this.stream = fs.createWriteStream(this.filename, { flags: "a" });

        // 处理流错误
        this.stream.on("error", (error) => {
            console.error(`[FileTransport] 写入错误: ${error.message}`);
            this.disabled = true;
        });
    }

    /**
     * 写入日志到文件
     */
    write(entry: LogEntry): void {
        if (this.disabled || !this.stream) {
            return;
        }

        try {
            const message = this.format(entry);
            const messageSize = Buffer.byteLength(message, "utf8");

            // 检查是否需要轮转
            if (this.currentSize + messageSize > this.maxSize) {
                this.rotate();
            }

            // 写入消息
            this.stream.write(message);
            this.currentSize += messageSize;
        } catch (error: any) {
            console.error(`[FileTransport] 写入失败: ${error.message}`);
            this.disabled = true;
        }
    }

    /**
     * 格式化日志消息
     */
    private format(entry: LogEntry): string {
        const { timestamp, level, message, module, meta } = entry;
        const levelStr = level.toUpperCase().padEnd(5);
        const moduleStr = module ? `[${module}] ` : "";

        // 添加关键元数据用于调试
        let metaStr = "";
        if (meta) {
            const parts: string[] = [];
            if (meta.chatId) parts.push(`chatId=${String(meta.chatId).slice(-6)}`);
            if (meta.sender) parts.push(`sender=${meta.sender}`);
            // 注意：默认不把用户/模型的原始文本写入文件日志，避免敏感内容落盘。
            // 如需排障，请在调用侧显式提供 textDigest/textLength，并使用 DEBUG_TRACE_TEXT=1 控制 textPreview。
            if (meta.textLength !== undefined) parts.push(`textLen=${meta.textLength}`);
            if (meta.textDigest) parts.push(`textSha=${String(meta.textDigest).slice(0, 12)}`);
            if (process.env.DEBUG_TRACE_TEXT === "1" && meta.textPreview) {
                parts.push(`textPreview="${String(meta.textPreview).slice(0, 30)}"`);
            }
            if (meta.rowid !== undefined) parts.push(`rowid=${meta.rowid}`);
            if (parts.length) metaStr = ` [${parts.join(" ")}]`;
        }

        return `${timestamp} [${levelStr}] ${moduleStr}${message}${metaStr}\n`;
    }

    /**
     * 日志轮转
     */
    private rotate(): void {
        if (!this.stream) {
            return;
        }

        try {
            // 关闭当前流
            this.stream.close();

            // 删除最老的日志文件
            const oldestFile = `${this.filename}.${this.maxFiles}`;
            if (fs.existsSync(oldestFile)) {
                fs.unlinkSync(oldestFile);
            }

            // 重命名现有日志文件（从后往前）
            for (let i = this.maxFiles - 1; i >= 1; i--) {
                const oldFile = `${this.filename}.${i}`;
                const newFile = `${this.filename}.${i + 1}`;

                if (fs.existsSync(oldFile)) {
                    fs.renameSync(oldFile, newFile);
                }
            }

            // 将当前日志重命名为 .1
            if (fs.existsSync(this.filename)) {
                fs.renameSync(this.filename, `${this.filename}.1`);
            }

            // 打开新的日志文件
            this.currentSize = 0;
            this.openStream();

            console.log(`[FileTransport] 日志已轮转`);
        } catch (error: any) {
            console.error(`[FileTransport] 轮转失败: ${error.message}`);
            this.disabled = true;
        }
    }

    /**
     * 展开路径中的 ~ 为用户主目录
     */
    private expandPath(filePath: string): string {
        if (filePath.startsWith("~/")) {
            return path.join(os.homedir(), filePath.slice(2));
        }
        return filePath;
    }

    /**
     * 关闭文件流
     */
    close(): void {
        if (this.stream) {
            this.stream.end();
            this.stream = null;
        }
    }
}

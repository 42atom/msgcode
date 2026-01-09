/**
 * msgcode: 文件监听器 (替代轮询)
 *
 * 使用 fs.watch 监听 iMessage 数据库变化
 * 这是 Phase 2 的实验性功能
 */

import { watch, existsSync } from "node:fs";
import type { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Message } from "@photon-ai/imessage-kit";

/**
 * iMessage 数据库路径
 */
const CHAT_DB_PATH = `${process.env.HOME}/Library/Messages/chat.db`;

/**
 * 监听器配置
 */
export interface WatcherConfig {
    sdk: IMessageSDK;
    onNewMessage: (message: Message) => void | Promise<void>;
    onGroupMessage: (message: Message) => void | Promise<void>;
    debug?: boolean;
}

/**
 * 文件监听器类
 */
export class DatabaseWatcher {
    private sdk: IMessageSDK;
    private config: WatcherConfig;
    private processedIds = new Set<string>();
    private lastPollTime = Date.now();
    private pollInterval: NodeJS.Timeout | null = null;
    private watcher: ReturnType<typeof watch> | null = null;
    private readonly maxCacheSize = 1000;

    constructor(config: WatcherConfig) {
        this.sdk = config.sdk;
        this.config = config;
    }

    /**
     * 启动监听
     */
    async start(): Promise<void> {
        if (!existsSync(CHAT_DB_PATH)) {
            throw new Error(`iMessage 数据库不存在: ${CHAT_DB_PATH}`);
        }

        console.log(`📡 文件监听模式: ${CHAT_DB_PATH}`);

        // 1. 监听数据库文件变化
        this.watcher = watch(CHAT_DB_PATH, { recursive: false }, (eventType, filename) => {
            if (eventType === "change") {
                this.onDatabaseChanged();
            }
        });

        // 2. 同时保留轮询作为备份 (降低频率)
        // 这是为了处理文件监听可能遗漏的情况
        this.pollInterval = setInterval(() => {
            this.checkNewMessages();
        }, 10000); // 10秒备份轮询

        console.log(`✅ 监听器已启动 (文件监听 + 10s 备份轮询)`);
    }

    /**
     * 数据库变化回调
     */
    private onDatabaseChanged(): void {
        const now = Date.now();
        const timeSinceLastPoll = now - this.lastPollTime;

        // 防抖: 如果距离上次检查不到 500ms，跳过
        if (timeSinceLastPoll < 500) {
            return;
        }

        if (this.config.debug) {
            console.log(`📝 数据库已变化，检查新消息...`);
        }

        this.checkNewMessages();
    }

    /**
     * 检查新消息
     */
    private async checkNewMessages(): Promise<void> {
        this.lastPollTime = Date.now();

        try {
            // 获取最近的消息
            const result = await this.sdk.getMessages({
                limit: 50,
                excludeOwnMessages: false,
            });

            for (const message of result.messages) {
                // 跳过已处理的消息
                if (this.processedIds.has(message.id)) {
                    continue;
                }

                // 记录已处理
                this.processedIds.add(message.id);
                this.cleanCache();

                // 路由消息
                if (message.isGroupChat) {
                    await this.config.onGroupMessage(message);
                } else {
                    await this.config.onNewMessage(message);
                }
            }
        } catch (error: any) {
            console.error(`检查消息失败: ${error.message}`);
        }
    }

    /**
     * 清理缓存
     */
    private cleanCache(): void {
        if (this.processedIds.size > this.maxCacheSize) {
            const entries = Array.from(this.processedIds);
            for (let i = 0; i < entries.length / 2; i++) {
                this.processedIds.delete(entries[i]);
            }
        }
    }

    /**
     * 停止监听
     */
    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        console.log(`监听器已停止`);
    }
}

/**
 * 创建文件监听器
 */
export function createWatcher(config: WatcherConfig): DatabaseWatcher {
    return new DatabaseWatcher(config);
}

/**
 * 检查文件监听是否可用
 */
export function isFileWatchingAvailable(): boolean {
    return existsSync(CHAT_DB_PATH);
}

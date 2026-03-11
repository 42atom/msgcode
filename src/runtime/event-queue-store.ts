/**
 * msgcode: 事件队列持久化存储（P5.7-R12 Agent Relentless Task Closure）
 *
 * 职责：
 * - 事件队列的持久化存储与加载
 * - 支持 queued/processing/done/failed 状态
 * - 重启恢复 queued|processing 状态的事件
 *
 * 存储格式：
 * - <eventQueueDir>/<chatId>.jsonl: 按 chatId 分组的事件队列（JSONL 格式）
 * - 每行一个事件，追加写入
 * - 启动时重载并清理已完成事件
 *
 * 对齐 steering-queue 语义：
 * - steer: 紧急干预队列（高优先级）
 * - followUp: 后续消息队列（低优先级）
 */

import fs from "node:fs";
import path from "node:path";
import type { TaskEvent } from "./task-types.js";
import { logger } from "../logger/index.js";

// ============================================
// 事件队列存储配置
// ============================================

export interface EventQueueStoreConfig {
    /** 事件队列目录路径 */
    eventQueueDir: string;
}

// ============================================
// 事件队列存储类
// ============================================

export class EventQueueStore {
    private eventQueueDir: string;

    constructor(config: EventQueueStoreConfig) {
        this.eventQueueDir = config.eventQueueDir;
        this.ensureDir();
    }

    /**
     * 确保事件队列目录存在
     */
    private ensureDir(): void {
        if (!fs.existsSync(this.eventQueueDir)) {
            fs.mkdirSync(this.eventQueueDir, { recursive: true });
            logger.info("事件队列存储目录已创建", {
                module: "event-queue-store",
                eventQueueDir: this.eventQueueDir,
            });
        }
    }

    /**
     * 获取事件队列文件路径
     */
    private getEventQueueFilePath(chatId: string): string {
        const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
        return path.join(this.eventQueueDir, `${safeChatId}.jsonl`);
    }

    /**
     * 追加事件到队列
     */
    async pushEvent(event: TaskEvent): Promise<void> {
        const filePath = this.getEventQueueFilePath(event.chatId);
        const line = JSON.stringify(event) + "\n";

        // 追加写入
        fs.appendFileSync(filePath, line, "utf-8");

        logger.debug("事件已入队", {
            module: "event-queue-store",
            eventId: event.eventId,
            taskId: event.taskId,
            chatId: event.chatId,
            type: event.type,
        });
    }

    /**
     * 批量追加事件
     */
    async pushEvents(events: TaskEvent[]): Promise<void> {
        if (events.length === 0) return;

        // 按 chatId 分组
        const eventsByChat = new Map<string, TaskEvent[]>();
        for (const event of events) {
            const chatEvents = eventsByChat.get(event.chatId) ?? [];
            chatEvents.push(event);
            eventsByChat.set(event.chatId, chatEvents);
        }

        // 批量写入
        for (const [chatId, chatEvents] of eventsByChat) {
            const filePath = this.getEventQueueFilePath(chatId);
            const lines = chatEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
            fs.appendFileSync(filePath, lines, "utf-8");
        }

        logger.debug("批量事件已入队", {
            module: "event-queue-store",
            count: events.length,
        });
    }

    /**
     * 获取指定 chat 的所有事件
     */
    async getEvents(chatId: string): Promise<TaskEvent[]> {
        const filePath = this.getEventQueueFilePath(chatId);
        if (!fs.existsSync(filePath)) {
            return [];
        }

        try {
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.trim().split("\n");
            const events: TaskEvent[] = [];

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line) as TaskEvent;
                    events.push(event);
                } catch (error) {
                    logger.warn("解析事件行失败", {
                        module: "event-queue-store",
                        chatId,
                        line: line.slice(0, 100),
                    });
                }
            }

            return events;
        } catch (error) {
            logger.warn("读取事件队列文件失败", {
                module: "event-queue-store",
                chatId,
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    /**
     * 获取指定 chat 的未完成事件（queued | processing）
     *
     * 用于重启恢复
     */
    async getPendingEvents(chatId: string): Promise<TaskEvent[]> {
        const allEvents = await this.getEvents(chatId);
        return allEvents.filter((e) => e.status === "queued" || e.status === "processing");
    }

    /**
     * 更新事件状态
     */
    async updateEventStatus(
        chatId: string,
        eventId: string,
        status: TaskEvent["status"],
        completedAt?: number
    ): Promise<void> {
        const events = await this.getEvents(chatId);
        const event = events.find((e) => e.eventId === eventId);

        if (!event) {
            logger.warn("事件不存在，无法更新状态", {
                module: "event-queue-store",
                chatId,
                eventId,
            });
            return;
        }

        // 更新状态
        event.status = status;
        if (completedAt) {
            event.completedAt = completedAt;
        }

        // 重写整个文件（简单实现，可后续优化为增量更新）
        const filePath = this.getEventQueueFilePath(chatId);
        const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
        fs.writeFileSync(filePath, lines, "utf-8");

        logger.debug("事件状态已更新", {
            module: "event-queue-store",
            eventId,
            status,
        });
    }

    /**
     * 清理已完成事件（done | failed）
     *
     * 定期清理，避免文件无限增长
     */
    async cleanupCompletedEvents(chatId: string): Promise<number> {
        const events = await this.getEvents(chatId);
        const pendingEvents = events.filter((e) => e.status === "queued" || e.status === "processing");

        if (pendingEvents.length === events.length) {
            // 没有已完成事件，无需清理
            return 0;
        }

        // 重写文件，只保留未完成事件
        const filePath = this.getEventQueueFilePath(chatId);
        const lines = pendingEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
        fs.writeFileSync(filePath, lines, "utf-8");

        const cleaned = events.length - pendingEvents.length;
        logger.info("已完成事件已清理", {
            module: "event-queue-store",
            chatId,
            cleaned,
            remaining: pendingEvents.length,
        });

        return cleaned;
    }

    /**
     * 删除指定 chat 的所有事件
     */
    async clearEvents(chatId: string): Promise<void> {
        const filePath = this.getEventQueueFilePath(chatId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info("事件队列已清空", {
                module: "event-queue-store",
                chatId,
            });
        }
    }

    /**
     * 启动时恢复所有未完成事件
     *
     * 用于重启恢复
     */
    async recoverPendingEvents(): Promise<Map<string, TaskEvent[]>> {
        const files = fs.readdirSync(this.eventQueueDir);
        const pendingEventsByChat = new Map<string, TaskEvent[]>();

        for (const file of files) {
            if (!file.endsWith(".jsonl")) continue;

            // 提取 chatId
            const chatId = file.replace(".jsonl", "").replace(/_dash_/g, "-");

            try {
                const pending = await this.getPendingEvents(chatId);
                if (pending.length > 0) {
                    pendingEventsByChat.set(chatId, pending);
                }
            } catch (error) {
                logger.warn("恢复事件队列失败", {
                    module: "event-queue-store",
                    file,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        logger.info("未完成事件恢复", {
            module: "event-queue-store",
            chatCount: pendingEventsByChat.size,
            totalEvents: Array.from(pendingEventsByChat.values()).reduce((sum, events) => sum + events.length, 0),
        });

        return pendingEventsByChat;
    }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建事件队列存储实例
 */
export function createEventQueueStore(config: EventQueueStoreConfig): EventQueueStore {
    return new EventQueueStore(config);
}

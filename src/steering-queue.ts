/**
 * msgcode: Steering Queue (Phase 4B - 持久化后端升级)
 *
 * Purpose:
 * - Provide emergency intervention mechanism for tool loops
 * - Two types of queues: steer (immediate) and followUp (post-round)
 *
 * Behavior:
 * - steer: Emergency turn - injects immediately after current tool, skips remaining tools
 * - followUp: Post-round message - processed only after current round completes
 *
 * Storage (P5.7-R12):
 * - 持久化后端：使用 event-queue-store
 * - 重启恢复：queued|processing 状态的事件可恢复
 * - 定期清理：已完成事件定期清理，避免文件无限增长
 */

import { randomUUID } from "node:crypto";
import { createEventQueueStore, type EventQueueStore } from "./runtime/event-queue-store.js";

// ============================================
// Types
// ============================================

/**
 * Queued intervention message
 */
export interface QueuedMessage {
    /** Unique identifier for this intervention */
    id: string;
    /** The message content to inject */
    content: string;
    /** Timestamp when queued */
    timestamp: number;
}

// ============================================
// 持久化后端初始化
// ============================================

/**
 * 事件队列存储实例（延迟初始化）
 */
let eventQueueStore: EventQueueStore | null = null;
type QueueBucket = { steer: QueuedMessage[]; followUp: QueuedMessage[] };

/**
 * 初始化事件队列存储
 *
 * @param eventQueueDir 事件队列目录路径
 */
export function initializeEventQueue(eventQueueDir: string): void {
    if (eventQueueStore) {
        return; // 已初始化
    }

    eventQueueStore = createEventQueueStore({ eventQueueDir });
}

/**
 * 获取事件队列存储实例
 */
function getEventQueueStore(): EventQueueStore {
    if (!eventQueueStore) {
        // 默认路径（向后兼容）
        const defaultDir = process.env.MSGCODE_TASK_DIR
            ? `${process.env.MSGCODE_TASK_DIR}/../event-queue`
            : "./.msgcode/event-queue";
        eventQueueStore = createEventQueueStore({ eventQueueDir: defaultDir });
    }
    return eventQueueStore;
}

// ============================================
// 兼容层：内存缓存（优化性能）
// ============================================

/**
 * Per-chat queues (chatId -> queues)
 *
 * 注意：这是内存缓存，真实存储在 event-queue-store
 */
const queues = new Map<string, QueueBucket>();

/**
 * 获取或创建指定 chat 的内存队列
 *
 * 注意：这里只做纯内存读写，不再隐式触发磁盘恢复。
 */
function getQueues(chatId: string): QueueBucket {
    let q = queues.get(chatId);
    if (!q) {
        q = { steer: [], followUp: [] };
        queues.set(chatId, q);
    }
    return q;
}

/**
 * 把持久化事件合并到内存队列。
 */
function mergePendingEventsIntoQueue(chatId: string, pendingEvents: Array<{
    eventId: string;
    type: string;
    status: string;
    payload?: string;
    createdAt: number;
}>): { steer: number; followUp: number } {
    const q = getQueues(chatId);
    const seen = new Set<string>([
        ...q.steer.map((message) => message.id),
        ...q.followUp.map((message) => message.id),
    ]);

    let restoredSteer = 0;
    let restoredFollowUp = 0;

    for (const event of pendingEvents) {
        if (event.type === "task_start" || event.type === "task_end") {
            continue;
        }
        if (event.status !== "queued" && event.status !== "processing") {
            continue;
        }
        if (seen.has(event.eventId)) {
            continue;
        }

        let queueType: "steer" | "followUp" = "followUp";
        let content = "";
        if (event.payload) {
            try {
                const parsed = JSON.parse(event.payload) as { content?: string; queueType?: string };
                content = parsed.content ?? "";
                if (parsed.queueType === "steer") {
                    queueType = "steer";
                }
            } catch {
                // 旧格式/坏数据默认按 followUp 恢复
            }
        }

        const message: QueuedMessage = {
            id: event.eventId,
            content,
            timestamp: event.createdAt,
        };

        if (queueType === "steer") {
            q.steer.push(message);
            restoredSteer += 1;
        } else {
            q.followUp.push(message);
            restoredFollowUp += 1;
        }
        seen.add(event.eventId);
    }

    return { steer: restoredSteer, followUp: restoredFollowUp };
}

/**
 * 显式恢复指定 chat 的持久化事件。
 */
export async function restoreQueuesFromDisk(chatId: string): Promise<{ steer: number; followUp: number }> {
    const store = getEventQueueStore();
    const pendingEvents = await store.getPendingEvents(chatId);
    return mergePendingEventsIntoQueue(chatId, pendingEvents);
}

/**
 * 显式恢复所有 chat 的持久化事件。
 */
export async function restoreAllQueuesFromDisk(): Promise<{ chatCount: number; eventCount: number }> {
    const store = getEventQueueStore();
    const pendingEventsByChat = await store.recoverPendingEvents();

    let eventCount = 0;
    for (const [chatId, events] of pendingEventsByChat.entries()) {
        const restored = mergePendingEventsIntoQueue(chatId, events);
        eventCount += restored.steer + restored.followUp;
    }

    return {
        chatCount: pendingEventsByChat.size,
        eventCount,
    };
}

// ============================================
// Steer Queue (Emergency Intervention)
// ============================================

/**
 * Push an emergency steering message
 *
 * Steer messages are processed immediately after the current tool completes,
 * skipping any remaining planned tools.
 *
 * 持久化：写入 event-queue-store（异步，不阻塞返回）
 *
 * @param chatId - Chat identifier
 * @param message - Message content to inject
 * @returns Unique intervention ID
 */
export function pushSteer(chatId: string, message: string): string {
    const q = getQueues(chatId);
    const intervention: QueuedMessage = {
        id: randomUUID(),
        content: message,
        timestamp: Date.now(),
    };
    q.steer.push(intervention);

    // 异步持久化到 event-queue-store（不阻塞主流程）
    const store = getEventQueueStore();
    store.pushEvent({
        eventId: intervention.id,
        taskId: "steer-" + intervention.id, // steer 消息没有关联 task
        chatId,
        type: "tool_call", // 复用类型
        status: "queued",
        payload: JSON.stringify({ content: message, queueType: "steer" }),
        createdAt: intervention.timestamp,
    }).catch((error) => {
        // 静默失败，不影响内存队列
        console.warn("[steering-queue] 持久化失败", error);
    });

    return intervention.id;
}

/**
 * Drain and return all steer messages for a chat
 *
 * Returns all queued steer messages and clears the queue.
 * Returns empty array if no steer messages exist.
 *
 * 持久化：标记事件为 done，并异步清理
 *
 * @param chatId - Chat identifier
 * @returns Array of steer messages (empty if none)
 */
export function drainSteer(chatId: string): QueuedMessage[] {
    const q = queues.get(chatId);
    if (!q || q.steer.length === 0) {
        return [];
    }
    const result = [...q.steer];
    q.steer = [];

    // 异步清理持久化存储（不阻塞主流程）
    const eventIds = result.map((m) => m.id);
    const store = getEventQueueStore();
    Promise.all(
        eventIds.map((eventId) =>
            store.updateEventStatus(chatId, eventId, "done", Date.now())
        )
    ).then(() => {
        // 定期清理已完成事件（每 10 次消费清理一次）
        if (Math.random() < 0.1) {
            store.cleanupCompletedEvents(chatId);
        }
    }).catch((error) => {
        // 静默失败
        console.warn("[steering-queue] 清理持久化事件失败", error);
    });

    return result;
}

/**
 * Check if there are pending steer messages
 *
 * @param chatId - Chat identifier
 * @returns True if steer queue has messages
 */
export function hasSteer(chatId: string): boolean {
    const q = queues.get(chatId);
    return q ? q.steer.length > 0 : false;
}

// ============================================
// FollowUp Queue (Post-Round Messages)
// ============================================

/**
 * Push a follow-up message
 *
 * Follow-up messages are processed only after the current round completes,
 * typically as the next user message in a new round.
 *
 * 持久化：写入 event-queue-store（异步，不阻塞返回）
 *
 * @param chatId - Chat identifier
 * @param message - Message content to inject
 * @returns Unique intervention ID
 */
export function pushFollowUp(chatId: string, message: string): string {
    const q = getQueues(chatId);
    const intervention: QueuedMessage = {
        id: randomUUID(),
        content: message,
        timestamp: Date.now(),
    };
    q.followUp.push(intervention);

    // 异步持久化到 event-queue-store（不阻塞主流程）
    const store = getEventQueueStore();
    store.pushEvent({
        eventId: intervention.id,
        taskId: "followup-" + intervention.id, // followUp 消息没有关联 task
        chatId,
        type: "tool_call", // 复用类型
        status: "queued",
        payload: JSON.stringify({ content: message, queueType: "followUp" }),
        createdAt: intervention.timestamp,
    }).catch((error) => {
        // 静默失败，不影响内存队列
        console.warn("[steering-queue] 持久化失败", error);
    });

    return intervention.id;
}

/**
 * Drain and return all follow-up messages for a chat
 *
 * Returns all queued follow-up messages and clears the queue.
 * Returns empty array if no follow-up messages exist.
 *
 * 持久化：标记事件为 done，并异步清理
 *
 * @param chatId - Chat identifier
 * @returns Array of follow-up messages (empty if none)
 */
export function drainFollowUp(chatId: string): QueuedMessage[] {
    const q = queues.get(chatId);
    if (!q || q.followUp.length === 0) {
        return [];
    }
    const result = [...q.followUp];
    q.followUp = [];

    // 异步清理持久化存储（不阻塞主流程）
    const eventIds = result.map((m) => m.id);
    const store = getEventQueueStore();
    Promise.all(
        eventIds.map((eventId) =>
            store.updateEventStatus(chatId, eventId, "done", Date.now())
        )
    ).then(() => {
        // 定期清理已完成事件（每 10 次消费清理一次）
        if (Math.random() < 0.1) {
            store.cleanupCompletedEvents(chatId);
        }
    }).catch((error) => {
        // 静默失败
        console.warn("[steering-queue] 清理持久化事件失败", error);
    });

    return result;
}

/**
 * Check if there are pending follow-up messages
 *
 * @param chatId - Chat identifier
 * @returns True if follow-up queue has messages
 */
export function hasFollowUp(chatId: string): boolean {
    const q = queues.get(chatId);
    return q ? q.followUp.length > 0 : false;
}

/**
 * Consume and return ONE follow-up message from the queue
 *
 * Removes only the first message from the queue, keeping remaining messages.
 * Returns undefined if queue is empty.
 *
 * This is the correct function for local provider's "one at a time" consumption strategy.
 *
 * 持久化：标记事件为 done，并异步清理
 *
 * @param chatId - Chat identifier
 * @returns First follow-up message, or undefined if queue is empty
 */
export function consumeOneFollowUp(chatId: string): QueuedMessage | undefined {
    const q = queues.get(chatId);
    if (!q || q.followUp.length === 0) {
        return undefined;
    }
    // Remove and return only the first message
    // Remaining messages stay in queue
    const message = q.followUp.shift();

    // 异步清理持久化存储（不阻塞主流程）
    if (message) {
        const store = getEventQueueStore();
        store.updateEventStatus(chatId, message.id, "done", Date.now())
            .then(() => {
                // 定期清理已完成事件（每 10 次消费清理一次）
                if (Math.random() < 0.1) {
                    store.cleanupCompletedEvents(chatId);
                }
            })
            .catch((error) => {
                // 静默失败
                console.warn("[steering-queue] 清理持久化事件失败", error);
            });
    }

    return message;
}

// ============================================
// Queue Management
// ============================================

/**
 * Clear all queues for a chat
 *
 * 持久化：清理该 chat 的所有事件（异步，不阻塞返回）
 *
 * @param chatId - Chat identifier
 */
export function clearQueues(chatId: string): void {
    queues.delete(chatId);

    // 异步清理持久化存储（不阻塞主流程）
    const store = getEventQueueStore();
    store.clearEvents(chatId).catch((error) => {
        // 静默失败
        console.warn("[steering-queue] 清理持久化事件失败", error);
    });
}

/**
 * Get queue status (for debugging/monitoring)
 *
 * @param chatId - Chat identifier
 * @returns Status object with queue counts
 */
export function getQueueStatus(chatId: string): { steer: number; followUp: number } {
    const q = queues.get(chatId);
    if (!q) {
        return { steer: 0, followUp: 0 };
    }
    return {
        steer: q.steer.length,
        followUp: q.followUp.length,
    };
}

// ============================================
// Test Helpers
// ============================================

/**
 * Clear all queues (for testing)
 */
export function clearAllQueues(): void {
    queues.clear();
    eventQueueStore = null;
}

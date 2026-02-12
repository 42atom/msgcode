/**
 * msgcode: Steering Queue (Phase 4B)
 *
 * Purpose:
 * - Provide emergency intervention mechanism for tool loops
 * - Two types of queues: steer (immediate) and followUp (post-round)
 *
 * Behavior:
 * - steer: Emergency turn - injects immediately after current tool, skips remaining tools
 * - followUp: Post-round message - processed only after current round completes
 *
 * Storage:
 * - In-memory per-chat queues (no persistence - interventions are ephemeral)
 */

import { randomUUID } from "node:crypto";

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

/**
 * Intervention queues for a chat
 */
interface ChatQueues {
    /** Emergency steering queue (highest priority) */
    steer: QueuedMessage[];
    /** Follow-up messages (post-round) */
    followUp: QueuedMessage[];
}

// ============================================
// In-Memory Storage
// ============================================

/**
 * Per-chat queues (chatId -> queues)
 */
const queues = new Map<string, ChatQueues>();

/**
 * Get or create queues for a chat
 */
function getQueues(chatId: string): ChatQueues {
    let q = queues.get(chatId);
    if (!q) {
        q = { steer: [], followUp: [] };
        queues.set(chatId, q);
    }
    return q;
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
    return intervention.id;
}

/**
 * Drain and return all steer messages for a chat
 *
 * Returns all queued steer messages and clears the queue.
 * Returns empty array if no steer messages exist.
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
    return intervention.id;
}

/**
 * Drain and return all follow-up messages for a chat
 *
 * Returns all queued follow-up messages and clears the queue.
 * Returns empty array if no follow-up messages exist.
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
 * This is the correct function for MLX provider's "one at a time" consumption strategy.
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
    return q.followUp.shift();
}

// ============================================
// Queue Management
// ============================================

/**
 * Clear all queues for a chat
 *
 * @param chatId - Chat identifier
 */
export function clearQueues(chatId: string): void {
    queues.delete(chatId);
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
}

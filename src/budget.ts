/**
 * msgcode: Context Budget Layer
 *
 * Purpose:
 * - Allocate context budget across message sections
 * - Trim messages to fit within token budget
 * - Support fallback to window-based behavior
 *
 * Design:
 * - Fixed allocation ratios (configurable in future)
 * - Character-based token estimation (fast, approximate)
 * - Preserve recent user messages and tool results
 */

import type { ModelCapabilities } from "./capabilities.js";
import type { WindowMessage } from "./session-window.js";

// ============================================
// Types
// ============================================

/**
 * Budget allocation for different message sections
 */
export interface BudgetAllocation {
    /** Total input budget in tokens */
    total: number;

    /** System prompt budget (10%) */
    system: number;

    /** Summary budget (20%) - placeholder for Phase 3 */
    summary: number;

    /** Recent history budget (50%) */
    recent: number;

    /** Current user message budget (20%) */
    current: number;
}

/**
 * Token estimation function type
 */
export type TokenEstimator = (message: WindowMessage) => number;

/**
 * Trim result
 */
export interface TrimResult {
    /** Trimmed messages */
    messages: WindowMessage[];

    /** Estimated tokens used */
    estimatedTokens: number;

    /** Whether any messages were trimmed */
    trimmed: boolean;

    /** Trim method used */
    trimMethod: "none" | "count-based" | "budget-based";
}

// ============================================
// Constants
// ============================================

/**
 * Default allocation ratios (sum to 100%)
 */
const DEFAULT_ALLOCATION_RATIOS = {
    system: 0.10,   // 10%
    summary: 0.20,  // 20% (placeholder for Phase 3)
    recent: 0.50,   // 50%
    current: 0.20,  // 20%
};

/**
 * Default characters per token for estimation
 */
const DEFAULT_CHARS_PER_TOKEN = 2;

// ============================================
// Budget Computation
// ============================================

/**
 * Compute input budget from model capabilities
 *
 * @param caps - Model capabilities
 * @returns Input budget (context window minus reserved output)
 */
export function computeInputBudget(caps: ModelCapabilities): number {
    return caps.contextWindowTokens - caps.reservedOutputTokens;
}

/**
 * Allocate budget across sections
 *
 * @param inputBudget - Total input budget in tokens
 * @param ratios - Allocation ratios (optional, uses defaults)
 * @returns Budget allocation per section
 */
export function allocateSections(
    inputBudget: number,
    ratios: typeof DEFAULT_ALLOCATION_RATIOS = DEFAULT_ALLOCATION_RATIOS
): BudgetAllocation {
    return {
        total: inputBudget,
        system: Math.floor(inputBudget * ratios.system),
        summary: Math.floor(inputBudget * ratios.summary),
        recent: Math.floor(inputBudget * ratios.recent),
        current: Math.floor(inputBudget * ratios.current),
    };
}

// ============================================
// Token Estimation
// ============================================

/**
 * Estimate tokens from message (character-based approximation)
 *
 * @param message - Window message
 * @param charsPerToken - Characters per token (default: 2)
 * @returns Estimated token count
 */
export function estimateMessageTokens(
    message: WindowMessage,
    charsPerToken: number = DEFAULT_CHARS_PER_TOKEN
): number {
    let chars = 0;

    // Count content
    if (message.content) {
        chars += message.content.length;
    }

    // Count tool_calls (approximate)
    if (message.tool_calls && message.tool_calls.length > 0) {
        for (const tc of message.tool_calls) {
            chars += tc.function.name.length + tc.function.arguments.length + 50; // overhead
        }
    }

    // Count tool_call_id
    if (message.tool_call_id) {
        chars += message.tool_call_id.length;
    }

    // Count role
    chars += message.role.length;

    return Math.ceil(chars / charsPerToken);
}

/**
 * Estimate total tokens for message array
 *
 * @param messages - Array of messages
 * @param charsPerToken - Characters per token
 * @returns Total estimated tokens
 */
export function estimateTotalTokens(
    messages: WindowMessage[],
    charsPerToken: number = DEFAULT_CHARS_PER_TOKEN
): number {
    return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg, charsPerToken), 0);
}

// ============================================
// Message Trimming
// ============================================

/**
 * Count-based trim (fallback: trim to max message count)
 *
 * @param messages - Messages to trim
 * @param maxMessages - Maximum messages to keep
 * @returns Trimmed messages (most recent)
 */
export function trimByCount(messages: WindowMessage[], maxMessages: number): WindowMessage[] {
    if (messages.length <= maxMessages) {
        return messages;
    }
    return messages.slice(-maxMessages);
}

/**
 * Budget-based trim (preserve recent and important messages)
 *
 * Priority order (what to keep):
 * 1. Most recent user message
 * 2. Recent tool results (with tool_call_id)
 * 3. Recent assistant messages
 * 4. Older user messages
 *
 * @param messages - Messages to trim
 * @param budgetTokens - Target budget in tokens
 * @param estimateFn - Token estimation function
 * @returns Trimmed result
 */
export function trimByBudget(
    messages: WindowMessage[],
    budgetTokens: number,
    estimateFn: TokenEstimator = estimateMessageTokens
): TrimResult {
    const estimatedTotal = estimateTotalTokens(messages, DEFAULT_CHARS_PER_TOKEN);

    // If within budget, no trim needed
    if (estimatedTotal <= budgetTokens) {
        return {
            messages,
            estimatedTokens: estimatedTotal,
            trimmed: false,
            trimMethod: "none",
        };
    }

    // Build prioritized list
    const prioritized: Array<{ msg: WindowMessage; priority: number; index: number }> = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        let priority = 0;

        // Priority 1: Most recent user message
        if (msg.role === "user" && i === messages.length - 1) {
            priority = 100;
        }
        // Priority 2: Tool results (always important)
        else if (msg.role === "tool") {
            priority = 80;
        }
        // Priority 3: Recent assistant messages (with tool_calls)
        else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
            priority = 70;
        }
        // Priority 4: Regular assistant messages
        else if (msg.role === "assistant") {
            priority = 60 + i; // More recent = higher priority
        }
        // Priority 5: User messages (except most recent)
        else if (msg.role === "user") {
            priority = 50 + i; // More recent = higher priority
        }

        prioritized.push({ msg, priority, index: i });
    }

    // Sort by priority (descending), then by index (ascending for same priority)
    prioritized.sort((a, b) => {
        if (a.priority !== b.priority) {
            return b.priority - a.priority;
        }
        return a.index - b.index;
    });

    // Greedily add messages until budget is exceeded
    const kept: WindowMessage[] = [];
    let usedTokens = 0;

    for (const { msg } of prioritized) {
        const msgTokens = estimateFn(msg);

        if (usedTokens + msgTokens <= budgetTokens) {
            kept.push(msg);
            usedTokens += msgTokens;
        }
    }

    // Re-sort by original index to maintain message order
    kept.sort((a, b) => {
        const aIndex = messages.indexOf(a);
        const bIndex = messages.indexOf(b);
        return aIndex - bIndex;
    });

    return {
        messages: kept,
        estimatedTokens: usedTokens,
        trimmed: true,
        trimMethod: "budget-based",
    };
}

/**
 * Trim messages by budget with fallback to count-based
 *
 * @param messages - Messages to trim
 * @param budgetTokens - Target budget in tokens
 * @param maxMessages - Fallback max message count
 * @returns Trimmed messages
 */
export function trimMessagesByBudget(
    messages: WindowMessage[],
    budgetTokens: number,
    maxMessages: number = 20
): WindowMessage[] {
    try {
        // Try budget-based trim
        const result = trimByBudget(messages, budgetTokens);

        if (!result.trimmed) {
            return result.messages;
        }

        // If we trimmed too aggressively and have < 4 messages, fall back to count-based
        if (result.messages.length < 4) {
            return trimByCount(messages, maxMessages);
        }

        return result.messages;
    } catch {
        // On error, fall back to count-based trim
        return trimByCount(messages, maxMessages);
    }
}

// ============================================
// Budget Summary
// ============================================

/**
 * Get budget summary for debugging
 *
 * @param messages - Messages to analyze
 * @param allocation - Budget allocation
 * @returns Summary object
 */
export function getBudgetSummary(
    messages: WindowMessage[],
    allocation: BudgetAllocation
): {
    estimated: {
        total: number;
        system: number;
        recent: number;
        current: number;
    };
    allocation: BudgetAllocation;
    withinBudget: boolean;
} {
    // Separate system from history
    const systemMsgs = messages.filter((m) => m.role === "system");
    const historyMsgs = messages.filter((m) => m.role !== "system");

    const systemTokens = estimateTotalTokens(systemMsgs);
    const historyTokens = estimateTotalTokens(historyMsgs);

    return {
        estimated: {
            total: systemTokens + historyTokens,
            system: systemTokens,
            recent: Math.floor(historyTokens * 0.7), // Approx: 70% of history is "recent"
            current: Math.floor(historyTokens * 0.3),  // Approx: 30% is "current"
        },
        allocation,
        withinBudget: systemTokens + historyTokens <= allocation.total,
    };
}

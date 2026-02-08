/**
 * msgcode: Session Window Memory
 *
 * Purpose:
 * - Provide sliding window memory for chat sessions
 * - Store recent messages per chatId in workspace
 * - Support MLX provider multi-turn conversations
 *
 * Storage:
 * - <workspace>/.msgcode/sessions/<chatId>.jsonl
 *
 * Features:
 * - Load window from disk
 * - Append new messages
 * - Prune to maxMessages (count-based, default 20)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ============================================
// Types
// ============================================

/**
 * Message format for session storage
 */
export interface WindowMessage {
    role: string;
    content?: string;
    tool_calls?: Array<{
        id: string;
        type: string;
        function: {
            name: string;
            arguments: string;
        };
    }>;
    tool_call_id?: string;
    name?: string;  // Tool name for role="tool" messages (OpenAI compatibility)
    timestamp?: number;
}

/**
 * Options for building window context
 */
export interface BuildWindowOptions {
    system?: string;
    history: WindowMessage[];
    currentUser: string;
    maxMessages?: number;
}

// ============================================
// Constants
// ============================================

/**
 * Default maximum messages in window
 */
const DEFAULT_MAX_MESSAGES = 20;

/**
 * Session directory name
 */
const SESSION_DIR = ".msgcode/sessions";

// ============================================
// Storage Path
// ============================================

/**
 * Get session file path for a chatId
 */
function getSessionPath(workspacePath: string, chatId: string): string {
    return join(workspacePath, SESSION_DIR, `${chatId}.jsonl`);
}

/**
 * Ensure session directory exists
 */
async function ensureSessionDir(workspacePath: string): Promise<void> {
    const sessionDir = join(workspacePath, SESSION_DIR);
    if (!existsSync(sessionDir)) {
        await mkdir(sessionDir, { recursive: true });
    }
}

// ============================================
// Load Window
// ============================================

/**
 * Load session window from disk
 *
 * @param workspacePath - Workspace directory path
 * @param chatId - Chat identifier (e.g., group chat ID)
 * @returns Array of messages in the window
 */
export async function loadWindow(
    workspacePath: string,
    chatId: string
): Promise<WindowMessage[]> {
    const sessionPath = getSessionPath(workspacePath, chatId);

    if (!existsSync(sessionPath)) {
        return [];
    }

    try {
        const content = await readFile(sessionPath, "utf-8");
        const messages: WindowMessage[] = [];

        for (const line of content.split("\n")) {
            if (line.trim() === "") continue;
            try {
                messages.push(JSON.parse(line) as WindowMessage);
            } catch {
                // Skip invalid lines
                continue;
            }
        }

        return messages;
    } catch {
        // On error, return empty window
        return [];
    }
}

// ============================================
// Append Window
// ============================================

/**
 * Append a message to the session window
 *
 * @param workspacePath - Workspace directory path
 * @param chatId - Chat identifier
 * @param message - Message to append
 */
export async function appendWindow(
    workspacePath: string,
    chatId: string,
    message: WindowMessage
): Promise<void> {
    await ensureSessionDir(workspacePath);

    const sessionPath = getSessionPath(workspacePath, chatId);

    // Add timestamp if not present
    if (!message.timestamp) {
        message.timestamp = Date.now();
    }

    const line = JSON.stringify(message) + "\n";

    // Append to file
    await writeFile(sessionPath, line, { flag: "a" });
}

// ============================================
// Prune Window
// ============================================

/**
 * Prune window to maxMessages (keep most recent)
 *
 * @param history - Message history
 * @param maxMessages - Maximum messages to keep (default 20)
 * @returns Pruned message array
 */
export function pruneWindow(
    history: WindowMessage[],
    maxMessages: number = DEFAULT_MAX_MESSAGES
): WindowMessage[] {
    if (history.length <= maxMessages) {
        return history;
    }

    // Keep the most recent maxMessages
    return history.slice(-maxMessages);
}

// ============================================
// Build Window Context
// ============================================

/**
 * Build window context for LLM request
 *
 * @param options - Build options
 * @returns Messages array ready for LLM API
 */
export function buildWindowContext(options: BuildWindowOptions): WindowMessage[] {
    const { system, history, currentUser, maxMessages = DEFAULT_MAX_MESSAGES } = options;

    const messages: WindowMessage[] = [];

    // Add system message if provided
    if (system) {
        messages.push({ role: "system", content: system });
    }

    // Separate history from current user input
    // currentUser represents the current input that must be preserved
    const historyWithoutCurrent = currentUser
        ? history.slice(0, -1)  // Exclude last message (assumed to be current)
        : history;

    // Prune history to maxMessages, leaving room for current user
    const roomForCurrent = currentUser ? 1 : 0;
    const prunedHistory = pruneWindow(historyWithoutCurrent, maxMessages - roomForCurrent);

    // Add history messages (excluding current)
    messages.push(...prunedHistory);

    // Add current user message at the end (always preserved)
    if (currentUser) {
        messages.push({ role: "user", content: currentUser });
    }

    return messages;
}

// ============================================
// Utility: Clear Window
// ============================================

/**
 * Clear session window (for testing or reset)
 *
 * @param workspacePath - Workspace directory path
 * @param chatId - Chat identifier
 */
export async function clearWindow(
    workspacePath: string,
    chatId: string
): Promise<void> {
    const sessionPath = getSessionPath(workspacePath, chatId);

    if (existsSync(sessionPath)) {
        await writeFile(sessionPath, "");
    }
}

// ============================================
// Utility: Get Window Stats
// ============================================

/**
 * Get window statistics
 *
 * @param workspacePath - Workspace directory path
 * @param chatId - Chat identifier
 * @returns Stats object with message count
 */
export async function getWindowStats(
    workspacePath: string,
    chatId: string
): Promise<{ count: number; size: number }> {
    const messages = await loadWindow(workspacePath, chatId);
    return {
        count: messages.length,
        size: messages.reduce((acc, m) => acc + JSON.stringify(m).length, 0),
    };
}

// ============================================
// Summary Integration
// ============================================

/**
 * Result of trimming with summary metadata
 */
export interface TrimResult {
    /** Trimmed messages (recent window) */
    messages: WindowMessage[];

    /** Messages that were trimmed (old messages) */
    trimmed: WindowMessage[];

    /** Whether trimming occurred */
    wasTrimmed: boolean;
}

/**
 * Trim window and return both kept and trimmed messages
 *
 * @param history - Message history
 * @param maxMessages - Maximum messages to keep
 * @returns Trim result with both kept and trimmed messages
 */
export function trimWindowWithResult(
    history: WindowMessage[],
    maxMessages: number = DEFAULT_MAX_MESSAGES
): TrimResult {
    if (history.length <= maxMessages) {
        return {
            messages: history,
            trimmed: [],
            wasTrimmed: false,
        };
    }

    return {
        messages: history.slice(-maxMessages),
        trimmed: history.slice(0, -maxMessages),
        wasTrimmed: true,
    };
}

/**
 * Build window context with summary support
 *
 * @param options - Build options
 * @returns Messages array ready for LLM API
 */
export function buildWindowContextWithSummary(
    options: BuildWindowOptions & {
        summaryContent?: string;
    }
): WindowMessage[] {
    const { system, history, currentUser, maxMessages = DEFAULT_MAX_MESSAGES, summaryContent } =
        options;

    const messages: WindowMessage[] = [];

    // Add system message if provided
    if (system) {
        messages.push({ role: "system", content: system });
    }

    // Add summary if provided
    if (summaryContent) {
        messages.push({
            role: "system",
            content: `[Previous Context Summary]\n${summaryContent}\n[End Summary]`,
        });
    }

    // Prune history to maxMessages
    const prunedHistory = pruneWindow(history, maxMessages);

    // Add history messages
    messages.push(...prunedHistory);

    return messages;
}

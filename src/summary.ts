/**
 * msgcode: Summary Compression Layer
 *
 * Purpose:
 * - Compress old messages into structured summary
 * - Reduce context bloat while preserving key information
 * - Rule-based extraction (no additional LLM calls)
 *
 * Design:
 * - Fixed Markdown sections (Goal/Constraints/Decisions/Open Items/Tool Facts)
 * - Triggered when budget trimming occurs
 * - Stored alongside session window
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WindowMessage } from "./session-window.js";

// ============================================
// Types
// ============================================

/**
 * Summary structure (as stored in markdown)
 */
export interface ChatSummary {
    /** User's stated goals or objectives */
    goal: string[];

    /** Explicit constraints from user (must/must not/only/just) */
    constraints: string[];

    /** Key decisions made by assistant */
    decisions: string[];

    /** Open questions or items to address */
    openItems: string[];

    /** Reusable facts from tool results (paths/values/states) */
    toolFacts: string[];
}

/**
 * Summary extraction options
 */
export interface SummaryOptions {
    /** Minimum messages to trigger summary (default: 20) */
    triggerThreshold?: number;

    /** Whether to force regeneration (default: false) */
    forceRegenerate?: boolean;
}

// ============================================
// Constants
// ============================================

/**
 * Summary file name
 */
const SUMMARY_FILE = "summary.md";

/**
 * Default trigger threshold
 */
const DEFAULT_TRIGGER_THRESHOLD = 20;

// ============================================
// Storage Path
// ============================================

/**
 * Get summary file path for a chatId
 */
function getSummaryPath(workspacePath: string, chatId: string): string {
    return join(workspacePath, ".msgcode/sessions", chatId, SUMMARY_FILE);
}

/**
 * Ensure summary directory exists
 */
async function ensureSummaryDir(workspacePath: string, chatId: string): Promise<void> {
    const summaryDir = join(workspacePath, ".msgcode/sessions", chatId);
    if (!existsSync(summaryDir)) {
        await mkdir(summaryDir, { recursive: true });
    }
}

// ============================================
// Load / Save Summary
// ============================================

/**
 * Load summary from disk
 *
 * @param workspacePath - Workspace directory path
 * @param chatId - Chat identifier
 * @returns Summary object or empty structure
 */
export async function loadSummary(
    workspacePath: string,
    chatId: string
): Promise<ChatSummary> {
    const summaryPath = getSummaryPath(workspacePath, chatId);

    if (!existsSync(summaryPath)) {
        return {
            goal: [],
            constraints: [],
            decisions: [],
            openItems: [],
            toolFacts: [],
        };
    }

    try {
        const content = await readFile(summaryPath, "utf-8");
        return parseSummaryMarkdown(content);
    } catch {
        return {
            goal: [],
            constraints: [],
            decisions: [],
            openItems: [],
            toolFacts: [],
        };
    }
}

/**
 * Save summary to disk
 *
 * @param workspacePath - Workspace directory path
 * @param chatId - Chat identifier
 * @param summary - Summary object to save
 */
export async function saveSummary(
    workspacePath: string,
    chatId: string,
    summary: ChatSummary
): Promise<void> {
    await ensureSummaryDir(workspacePath, chatId);

    const summaryPath = getSummaryPath(workspacePath, chatId);
    const markdown = formatSummaryMarkdown(summary);

    await writeFile(summaryPath, markdown, "utf-8");
}

// ============================================
// Summary Generation (Rule-Based)
// ============================================

/**
 * Keyword patterns for extraction
 */
const PATTERNS = {
    // Chinese constraint keywords
    constraints: ["必须", "不要", "仅", "只", "不能", "禁止", "限制", "避免"],
    // Chinese decision keywords
    decisions: ["决定", "采用", "改为", "选择", "使用", "设置为"],
    // Question indicators
    questions: ["?", "？", "如何", "怎么", "什么", "哪个", "是否"],
    // Tool result patterns (JSON with specific keys)
    toolResultKeys: ["path", "file", "directory", "url", "id", "status", "state"],
};

/**
 * Extract summary from trimmed messages (rule-based)
 *
 * @param trimmedMessages - Messages that were trimmed
 * @param originalMessages - Original full message history
 * @returns Extracted summary
 */
export function extractSummary(
    trimmedMessages: WindowMessage[],
    originalMessages: WindowMessage[]
): ChatSummary {
    const summary: ChatSummary = {
        goal: [],
        constraints: [],
        decisions: [],
        openItems: [],
        toolFacts: [],
    };

    // Analyze trimmed messages
    for (const msg of trimmedMessages) {
        if (!msg.content) continue;

        const content = msg.content;

        // Extract constraints from user messages
        if (msg.role === "user") {
            for (const keyword of PATTERNS.constraints) {
                if (content.includes(keyword)) {
                    // Extract sentence containing the keyword
                    const sentence = extractSentence(content, keyword);
                    if (sentence && !summary.constraints.includes(sentence)) {
                        summary.constraints.push(sentence);
                    }
                }
            }

            // Extract questions as open items
            for (const keyword of PATTERNS.questions) {
                if (content.includes(keyword)) {
                    const question = extractSentence(content, keyword);
                    if (question && !summary.openItems.includes(question)) {
                        summary.openItems.push(question);
                    }
                }
            }
        }

        // Extract decisions from assistant messages
        if (msg.role === "assistant") {
            for (const keyword of PATTERNS.decisions) {
                if (content.includes(keyword)) {
                    const sentence = extractSentence(content, keyword);
                    if (sentence && !summary.decisions.includes(sentence)) {
                        summary.decisions.push(sentence);
                    }
                }
            }
        }

        // Extract tool facts from tool messages
        if (msg.role === "tool" && msg.content) {
            try {
                const toolData = JSON.parse(msg.content);
                if (toolData.success && toolData.data) {
                    const fact = extractToolFact(toolData.data);
                    if (fact && !summary.toolFacts.includes(fact)) {
                        summary.toolFacts.push(fact);
                    }
                }
            } catch {
                // Not valid JSON, skip
            }
        }
    }

    // Extract goals from first user message (if available)
    const firstUserMsg = originalMessages.find((m) => m.role === "user");
    if (firstUserMsg?.content) {
        // Use first message as initial goal statement
        const goalText = firstUserMsg.content.slice(0, 200); // Limit length
        if (goalText && !summary.goal.includes(goalText)) {
            summary.goal.push(goalText);
        }
    }

    return summary;
}

/**
 * Extract sentence containing a keyword
 */
function extractSentence(content: string, keyword: string): string {
    const index = content.indexOf(keyword);
    if (index === -1) return "";

    // Find sentence boundaries
    let start = content.lastIndexOf(".", index - 1);
    if (start === -1) start = content.lastIndexOf("。", index - 1);
    if (start === -1) start = content.lastIndexOf("\n", index - 1);
    start = Math.max(0, start + 1);

    let end = content.indexOf(".", index + keyword.length);
    if (end === -1) end = content.indexOf("。", index + keyword.length);
    if (end === -1) end = content.indexOf("\n", index + keyword.length);
    if (end === -1) end = content.length;

    return content.slice(start, end).trim();
}

/**
 * Extract reusable fact from tool result
 */
function extractToolFact(data: unknown): string | null {
    if (typeof data !== "object" || data === null) return null;

    const obj = data as Record<string, unknown>;

    // Look for common fact keys
    for (const key of PATTERNS.toolResultKeys) {
        if (key in obj && obj[key]) {
            const value = String(obj[key]);
            if (value && value !== "null" && value !== "undefined") {
                return `${key}: ${value}`;
            }
        }
    }

    // For command output, extract first meaningful line
    if (obj.stdout || obj.output || obj.result) {
        const output = String(obj.stdout || obj.output || obj.result || "");
        const lines = output.split("\n").filter((l) => l.trim());
        if (lines.length > 0) {
            return `output: ${lines[0].slice(0, 100)}`;
        }
    }

    return null;
}

// ============================================
// Markdown Format / Parse
// ============================================

/**
 * Format summary as Markdown (exported for testing)
 */
export function formatSummaryMarkdown(summary: ChatSummary): string {
    const lines: string[] = [];

    lines.push("# Chat Summary");
    lines.push("");
    lines.push(`> Generated: ${new Date().toISOString()}`);
    lines.push("");

    if (summary.goal.length > 0) {
        lines.push("## Goal");
        lines.push("");
        for (const goal of summary.goal) {
            lines.push(`- ${goal}`);
        }
        lines.push("");
    }

    if (summary.constraints.length > 0) {
        lines.push("## Constraints");
        lines.push("");
        for (const constraint of summary.constraints) {
            lines.push(`- ${constraint}`);
        }
        lines.push("");
    }

    if (summary.decisions.length > 0) {
        lines.push("## Decisions");
        lines.push("");
        for (const decision of summary.decisions) {
            lines.push(`- ${decision}`);
        }
        lines.push("");
    }

    if (summary.openItems.length > 0) {
        lines.push("## Open Items");
        lines.push("");
        for (const item of summary.openItems) {
            lines.push(`- ${item}`);
        }
        lines.push("");
    }

    if (summary.toolFacts.length > 0) {
        lines.push("## Tool Facts");
        lines.push("");
        for (const fact of summary.toolFacts) {
            lines.push(`- ${fact}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

/**
 * Parse summary from Markdown (exported for testing)
 */
export function parseSummaryMarkdown(markdown: string): ChatSummary {
    const summary: ChatSummary = {
        goal: [],
        constraints: [],
        decisions: [],
        openItems: [],
        toolFacts: [],
    };

    let currentSection: keyof ChatSummary | null = null;

    for (const line of markdown.split("\n")) {
        const trimmed = line.trim();

        // Check for section headers
        if (trimmed.startsWith("##")) {
            const sectionName = trimmed.slice(2).trim().toLowerCase();
            if (sectionName === "goal") currentSection = "goal";
            else if (sectionName === "constraints") currentSection = "constraints";
            else if (sectionName === "decisions") currentSection = "decisions";
            else if (sectionName === "open items") currentSection = "openItems";
            else if (sectionName === "tool facts") currentSection = "toolFacts";
            else currentSection = null;
            continue;
        }

        // Parse list items
        if (currentSection && trimmed.startsWith("-")) {
            const item = trimmed.slice(1).trim();
            if (item) {
                summary[currentSection].push(item);
            }
        }
    }

    return summary;
}

// ============================================
// Summary Integration
// ============================================

/**
 * Check if summary should be generated
 *
 * @param originalCount - Original message count
 * @param trimmedCount - Count after trimming
 * @param options - Summary options
 * @returns Whether to generate summary
 */
export function shouldGenerateSummary(
    originalCount: number,
    trimmedCount: number,
    options: SummaryOptions = {}
): boolean {
    const threshold = options.triggerThreshold ?? DEFAULT_TRIGGER_THRESHOLD;

    // Force regenerate if requested
    if (options.forceRegenerate) {
        return true;
    }

    // Generate if trimming occurred and we're over threshold
    return originalCount > threshold && originalCount > trimmedCount;
}

/**
 * Build context with summary integrated
 *
 * @param system - System prompt
 * @param summary - Chat summary
 * @param recentWindow - Recent messages (after trimming)
 * @returns Messages array with summary integrated
 */
export function buildContextWithSummary(
    system: string | undefined,
    summary: ChatSummary,
    recentWindow: WindowMessage[]
): WindowMessage[] {
    const messages: WindowMessage[] = [];

    // Add system prompt
    if (system) {
        messages.push({ role: "system", content: system });
    }

    // Add summary as system message if non-empty
    const summaryContent = formatSummaryAsContext(summary);
    if (summaryContent) {
        messages.push({
            role: "system",
            content: `[Previous Context Summary]\n${summaryContent}\n[End Summary]`,
        });
    }

    // Add recent window
    messages.push(...recentWindow);

    return messages;
}

/**
 * Format summary for context injection
 */
export function formatSummaryAsContext(summary: ChatSummary): string {
    const parts: string[] = [];

    if (summary.goal.length > 0) {
        parts.push(`Goal: ${summary.goal.join("; ")}`);
    }

    if (summary.constraints.length > 0) {
        parts.push(`Constraints: ${summary.constraints.join("; ")}`);
    }

    if (summary.decisions.length > 0) {
        parts.push(`Decisions: ${summary.decisions.join("; ")}`);
    }

    if (summary.openItems.length > 0) {
        parts.push(`Open: ${summary.openItems.join("; ")}`);
    }

    if (summary.toolFacts.length > 0) {
        parts.push(`Facts: ${summary.toolFacts.join("; ")}`);
    }

    return parts.join("\n");
}

// ============================================
// Utility: Clear Summary
// ============================================

/**
 * Clear summary file (for testing or reset)
 *
 * @param workspacePath - Workspace directory path
 * @param chatId - Chat identifier
 */
export async function clearSummary(
    workspacePath: string,
    chatId: string
): Promise<void> {
    const summaryPath = getSummaryPath(workspacePath, chatId);

    if (existsSync(summaryPath)) {
        const { unlink } = await import("node:fs/promises");
        await unlink(summaryPath);
    }
}

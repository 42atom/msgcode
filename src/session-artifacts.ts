/**
 * msgcode: Session Artifacts Management
 *
 * Provides unified session cleanup operations (session window + summary)
 * Used by both TmuxHandler and LocalHandler for /clear command
 *
 * Architecture:
 * - Pure function layer: clearSessionFiles() - no side effects except file I/O
 * - Wrapper layer: clearSessionArtifacts() - logs and returns user-facing results
 *
 * Error handling:
 * - Validates projectDir before any file operations
 * - Wraps clearWindow/clearSummary in try-catch
 * - Returns structured error messages for observability
 */

import { logger } from "./logger/index.js";

// ============================================
// Types
// ============================================

/**
 * Result of session files cleanup (pure function)
 */
export interface ClearFilesResult {
    /** Whether the cleanup succeeded */
    ok: boolean;
    /** Error message if ok is false */
    error?: string;
}

/**
 * Result of session artifacts cleanup (wrapper with logging)
 */
export interface ClearSessionResult {
    /** Whether the cleanup succeeded */
    ok: boolean;
    /** Error message if ok is false */
    error?: string;
}

// ============================================
// Pure Function Layer (No Logging)
// ============================================

/**
 * Clear session files (pure function layer)
 *
 * This function performs only file cleanup operations without logging.
 * Used internally by clearSessionArtifacts wrapper.
 *
 * @param projectDir - Workspace directory path (validated by caller)
 * @param chatId - Chat identifier
 * @returns Cleanup result without logging side effects
 * @private
 */
export async function clearSessionFiles(
    projectDir: string,
    chatId: string
): Promise<ClearFilesResult> {
    const { clearWindow } = await import("./session-window.js");
    const { clearSummary } = await import("./summary.js");

    // Clear session window (jsonl)
    await clearWindow(projectDir, chatId);

    // Clear summary (summary.md)
    await clearSummary(projectDir, chatId);

    return { ok: true };
}

// ============================================
// Wrapper Layer (With Logging)
// ============================================

/**
 * Clear session artifacts (session window + summary)
 *
 * This is the unified entry point for /clear command across all handlers.
 * Do not duplicate this logic in individual handlers.
 *
 * @param projectDir - Workspace directory path
 * @param chatId - Chat identifier
 * @returns Cleanup result with ok flag and optional error message
 */
export async function clearSessionArtifacts(
    projectDir: string | undefined,
    chatId: string
): Promise<ClearSessionResult> {
    // Validate projectDir before any file operations
    if (!projectDir) {
        return {
            ok: false,
            error: "未绑定 workspace，无法清理会话文件（请先使用 /bind <dir> 绑定工作区）",
        };
    }

    try {
        // Call pure function layer
        const result = await clearSessionFiles(projectDir, chatId);

        if (!result.ok) {
            return result;
        }

        return { ok: true };
    } catch (error) {
        // Log error with structured metadata for observability
        logger.error("清理失败: session artifacts cleanup failed", {
            module: "session-artifacts",
            chatId,
            error: error instanceof Error ? error.message : String(error),
        });

        // Return readable error message
        return {
            ok: false,
            error: `清理失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

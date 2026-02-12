/**
 * msgcode: MLX LM Server Provider
 *
 * Purpose:
 * - Provider for mlx_lm.server (GLM4.7 Flash MLX)
 * - Multi-round tool loop with role=tool feedback
 * - Configuration via workspace config.json
 *
 * Error Codes:
 * - MLX_HTTP_ERROR: HTTP request failed
 * - MLX_TIMEOUT: Request timeout
 * - MLX_INVALID_RESPONSE: Invalid response format
 * - MLX_NO_TOOL_CALL: No tool call found
 */

import { randomUUID } from "node:crypto";

// ============================================
// Phase 5: Multi-round Tool Loop Constants
// ============================================

/**
 * Maximum number of tool loop rounds before forced termination
 */
export const MAX_TOOL_ROUNDS = 6;

/**
 * Maximum tools to execute per round (limits parallel tool calls)
 */
export const MAX_TOOLS_PER_ROUND = 3;
import {
    loadWindow,
    appendWindow,
    buildWindowContext,
    trimWindowWithResult,
    type WindowMessage,
} from "../session-window.js";
import {
    getCapabilities,
    getInputBudget,
} from "../capabilities.js";
import {
    allocateSections,
    trimMessagesByBudget,
} from "../budget.js";
import {
    loadSummary,
    saveSummary,
    extractSummary,
    shouldGenerateSummary,
    buildContextWithSummary,
    formatSummaryAsContext,
    type ChatSummary,
} from "../summary.js";
import {
    drainSteer,
    consumeOneFollowUp,
    hasSteer,
    hasFollowUp,
    type QueuedMessage,
} from "../steering-queue.js";

// ============================================
// Types
// ============================================

export interface MlxConfig {
    baseUrl: string;
    modelId: string;
    maxTokens: number;
    temperature: number;
    topP: number;
}

export interface MlxChatOptions {
    prompt: string;
    system?: string;
    workspacePath: string;
    chatId: string;  // Required for session window
}

export interface MlxToolLoopOptions {
    prompt: string;
    system?: string;
    workspacePath: string;
    chatId: string;  // Required for session window
}

export interface MlxToolLoopResult {
    answer: string;
    toolCall?: { name: string; args: Record<string, unknown>; result: unknown };
}

export interface MlxChatResponse {
    choices: Array<{
        message: {
            role?: string;
            content?: string;
            reasoning?: string;  // GLM-4.7: some models put answer here
            tool_calls?: Array<{
                id: string;
                type: string;
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
        };
    }>;
}

// ============================================
// Config
// ============================================

/**
 * Auto-detect model ID from /v1/models
 *
 * 选模策略（避免误选 HF cache 模型）：
 * 1. 优先选 `id` 以 `/` 开头的模型（本地路径模型，即当前 --model 的 resolve path）
 * 2. 否则选 `id` 包含 `GLM`/`glm` 的模型
 * 3. 否则回退 `data[0].id`
 */
async function detectModelId(baseUrl: string): Promise<string> {
    const response = await fetch(`${baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        throw new Error(`MLX: Failed to fetch models (HTTP ${response.status})`);
    }

    const data = await response.json() as { data?: Array<{ id?: string }> };

    if (!data.data || data.data.length === 0) {
        throw new Error("MLX: No models available");
    }

    // 策略 1: 优先选本地路径模型（id 以 `/` 开头）
    const localPathModel = data.data.find(m => m.id?.startsWith("/"));
    if (localPathModel?.id) {
        return localPathModel.id;
    }

    // 策略 2: 选包含 GLM 的模型
    const glmModel = data.data.find(m => m.id && (m.id.includes("GLM") || m.id.includes("glm")));
    if (glmModel?.id) {
        return glmModel.id;
    }

    // 策略 3: 回退到第一个模型
    const modelId = data.data[0]?.id;
    if (!modelId) {
        throw new Error("MLX: First model has no ID");
    }

    return modelId;
}

/**
 * Resolve model ID (use config or auto-detect)
 */
async function resolveModelId(config: MlxConfig): Promise<string> {
    if (config.modelId) {
        return config.modelId;
    }

    return await detectModelId(config.baseUrl);
}

// ============================================
// HTTP Client
// ============================================

interface MlxErrorResponse {
    error?: {
        message?: string;
        code?: string;
    };
}

async function mlxFetch<T>(
    url: string,
    options: RequestInit & { timeout?: number }
): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 120000);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                ...options.headers,
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const text = await response.text();
            let errorMsg = `HTTP ${response.status}`;
            try {
                const err = JSON.parse(text) as MlxErrorResponse;
                if (err.error?.message) {
                    errorMsg = err.error.message;
                }
            } catch {
                // Ignore JSON parse errors
            }
            throw new Error(`MLX_HTTP_ERROR: ${errorMsg}`);
        }

        return await response.json() as T;
    } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === "AbortError") {
            throw new Error("MLX_TIMEOUT: Request timeout");
        }

        // Unified error template for MLX service unreachable
        const errMsg = error instanceof Error ? error.message : String(error);
        if (
            errMsg.includes("ECONNREFUSED") ||
            errMsg.includes("ENOTFOUND") ||
            errMsg.includes("ECONNRESET") ||
            errMsg.includes("ETIMEDOUT") ||
            errMsg.includes("fetch failed") ||
            errMsg.includes("Network error")
        ) {
            throw new Error("MLX 服务不可达：请先启动 mlx_lm.server 并检查 mlx.baseUrl");
        }

        throw error;
    }
}

// ============================================
// Chat API
// ============================================

/**
 * Default max messages in session window (fallback)
 */
const DEFAULT_MAX_MESSAGES = 20;

/**
 * Apply budget trimming with summary generation
 *
 * Implements 4-section context partition:
 * 1. System (10%): system prompt
 * 2. Summary (20%): loaded from <chatId>/summary.md
 * 3. Recent (50%): trimmed history messages
 * 4. Current (20%): current user message (always preserved)
 *
 * Budget allocation is enforced via token-based trimming of the recent section.
 * System and summary are assumed to fit within their respective budgets.
 * Current user message is always preserved as it represents the current input.
 *
 * @param messages - Messages to trim (includes current user at end)
 * @param systemPrompt - System prompt (included in budget check)
 * @param workspacePath - Workspace path (for summary storage)
 * @param chatId - Chat ID (for summary storage)
 * @returns Trimmed messages with summary integrated
 */
async function applyBudgetTrimWithSummary(
    messages: WindowMessage[],
    systemPrompt: string | undefined,
    workspacePath: string,
    chatId: string
): Promise<WindowMessage[]> {
    try {
        // Get MLX capabilities
        const caps = getCapabilities("mlx");

        // Compute input budget
        const inputBudget = getInputBudget("mlx");

        // Allocate sections: system 10%, summary 20%, recent 50%, current 20%
        // Note: System and summary sizes are not actively enforced (assumed to fit)
        // Only the recent section is actively trimmed to fit its budget allocation
        const allocation = allocateSections(inputBudget);

        // Track original count for summary generation
        const originalCount = messages.length;

        // Separate current user message (last message) from history
        // Current section (20%) is always preserved - represents the current input
        const currentMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        const isLastMsgUser = currentMsg?.role === "user";
        const history = isLastMsgUser ? messages.slice(0, -1) : messages;

        // Calculate budget for recent section (50% of input budget)
        // This is the only section we actively trim; system/summary/current are assumed to fit
        const recentBudget = allocation.recent;

        // Trim history to fit within recent budget
        const trimmedHistory = trimMessagesByBudget(history, recentBudget, DEFAULT_MAX_MESSAGES);
        const trimmedCount = trimmedHistory.length;

        // Check if we should generate summary (when trimming occurred)
        if (shouldGenerateSummary(originalCount, trimmedCount + 1, { triggerThreshold: DEFAULT_MAX_MESSAGES })) {
            // Calculate which messages were trimmed (original - kept)
            const keptCount = trimmedHistory.length;
            const trimmedMessages = originalCount > keptCount ? messages.slice(0, originalCount - keptCount) : [];

            if (trimmedMessages.length > 0) {
                // Generate summary from trimmed messages
                const newSummary = extractSummary(trimmedMessages, messages);

                // Save summary
                await saveSummary(workspacePath, chatId, newSummary);
            }
        }

        // Load existing summary (if any)
        const summary = await loadSummary(workspacePath, chatId);

        // Build result with 4-section partition
        const result: WindowMessage[] = [];

        // System section (10%) + Summary section (20%) merged into single system message
        // Some local chat templates don't handle multiple system messages well
        let systemContent = systemPrompt || "";
        const summaryContent = formatSummaryAsContext(summary);
        if (summaryContent) {
            systemContent += `\n\n[Previous Context Summary]\n${summaryContent}\n[End Summary]`;
        }
        if (systemContent) {
            result.push({ role: "system", content: systemContent });
        }

        // Recent section (50%)
        result.push(...trimmedHistory);

        // Current section (20%) - always preserve current user message
        if (currentMsg) {
            result.push(currentMsg);
        }

        return result;
    } catch {
        // On any error, fall back to simple trim without summary
        const pruned = messages.length > DEFAULT_MAX_MESSAGES
            ? messages.slice(-DEFAULT_MAX_MESSAGES)
            : messages;

        const result: WindowMessage[] = [];
        if (systemPrompt) {
            result.push({ role: "system", content: systemPrompt });
        }
        result.push(...pruned);

        return result;
    }
}

/**
 * Apply budget trimming to context messages (with optional summary)
 * Used for round 2 of tool loop where summary may be passed in
 *
 * Implements 4-section context partition:
 * 1. System (10%): system prompt
 * 2. Summary (20%): passed in or loaded (if provided)
 * 3. Recent (50%): trimmed history messages
 * 4. Current (20%): current user message (always preserved)
 *
 * @param messages - Messages to trim (includes current user at end)
 * @param systemPrompt - System prompt (included in budget check)
 * @param summary - Optional summary to inject (for round 2)
 * @returns Trimmed messages with fallback to count-based
 */
function applyBudgetTrim(
    messages: WindowMessage[],
    systemPrompt?: string,
    summary?: ChatSummary
): WindowMessage[] {
    try {
        // Get MLX capabilities
        const caps = getCapabilities("mlx");

        // Compute input budget
        const inputBudget = getInputBudget("mlx");

        // Allocate sections: system 10%, summary 20%, recent 50%, current 20%
        // Note: Only the recent section is actively trimmed to fit its budget
        const allocation = allocateSections(inputBudget);

        // Separate current user message (last message) from history
        // Current section (20%) is always preserved - represents the current input
        const currentMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        const isLastMsgUser = currentMsg?.role === "user";
        const history = isLastMsgUser ? messages.slice(0, -1) : messages;

        // Calculate budget for recent section (50% of input budget)
        const recentBudget = allocation.recent;

        // Trim history to fit within recent budget
        const trimmedHistory = trimMessagesByBudget(history, recentBudget, DEFAULT_MAX_MESSAGES);

        // Build result: system + summary + recent + current
        const result: WindowMessage[] = [];

        // System section (10%) + Summary section (20%) merged into single system message
        // Some local chat templates don't handle multiple system messages well
        let systemContent = systemPrompt || "";
        if (summary) {
            const summaryContent = formatSummaryAsContext(summary);
            if (summaryContent) {
                systemContent += `\n\n[Previous Context Summary]\n${summaryContent}\n[End Summary]`;
            }
        }
        if (systemContent) {
            result.push({ role: "system", content: systemContent });
        }

        // Recent section (50%)
        result.push(...trimmedHistory);

        // Current section (20%) - always preserve current user message
        if (currentMsg) {
            result.push(currentMsg);
        }

        return result;
    } catch {
        // On any error, fall back to count-based trim
        const pruned = messages.length > DEFAULT_MAX_MESSAGES
            ? messages.slice(-DEFAULT_MAX_MESSAGES)
            : messages;

        const result: WindowMessage[] = [];
        if (systemPrompt) {
            result.push({ role: "system", content: systemPrompt });
        }
        result.push(...pruned);

        return result;
    }
}

// ============================================
// Phase 6: 404 Fallback Retry Helpers
// ============================================

/**
 * Check if error is HTTP 404
 */
function isHttp404Error(error: unknown): boolean {
    if (error instanceof Error && error.message.includes("MLX_HTTP_ERROR: HTTP 404")) {
        return true;
    }
    return false;
}

/**
 * Build minimal context for fallback retry (system + current user only)
 */
function buildMinimalContext(
    systemPrompt: string | undefined,
    currentUserMessage: WindowMessage
): WindowMessage[] {
    const messages: WindowMessage[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
    }

    // Add only the current user message (no history, no summary)
    messages.push(currentUserMessage);

    return messages;
}

/**
 * Perform MLX chat request with 404 fallback retry
 *
 * @param url - Full URL for chat completions
 * @param requestBody - Request body to send
 * @param attempt - Attempt number (0 or 1 for retry)
 * @returns MLX chat response
 * @throws Error if request fails (including after retry)
 */
async function mlxChatWithRetry(
    url: string,
    requestBody: {
        model: string;
        messages: WindowMessage[];
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
        tools?: typeof MLX_TOOLS;
        tool_choice?: string;
    },
    chatId: string,
    attempt: number = 0,
    traceId?: string
): Promise<MlxChatResponse> {
    const { logger } = await import("../logger/index.js");

    try {
        return await mlxFetch<MlxChatResponse>(url, {
            method: "POST",
            timeout: 120000,
            body: JSON.stringify(requestBody),
        });
    } catch (error) {
        // On 404 and first attempt, log and return error for caller to handle retry
        if (isHttp404Error(error) && attempt === 0) {
            logger.warn("MLX 404 error, will retry with minimal context", {
                module: "mlx",
                chatId,
                traceId,
                reason: "mlx_404_fallback",
                retry: 1,
            });
            throw error; // Re-throw for caller to handle retry
        }
        // For all other errors or retries, re-throw
        throw error;
    }
}

/**
 * Run basic chat (no tools) with session window, budget, summary, and 404 fallback support
 */
export async function runMlxChat(options: MlxChatOptions): Promise<string> {
    const { logger } = await import("../logger/index.js");
    const { randomUUID } = await import("node:crypto");
    const { getMlxConfig } = await import("../config/workspace.js");
    const traceId = randomUUID();

    logger.info("MLX chat 开始", {
        module: "mlx",
        chatId: options.chatId,
        traceId,
        promptLength: options.prompt.length,
    });

    const config = await getMlxConfig(options.workspacePath);
    const modelId = await resolveModelId(config);

    // P0: Auto-start MLX server if not running (single instance enforcement)
    try {
        const { MlxServer } = await import("../runners/mlx.js");
        const status = await MlxServer.getStatus();
        if (!status.running) {
            logger.info("MLX server not running, auto-starting", {
                module: "mlx",
                chatId: options.chatId,
                traceId,
            });
            await MlxServer.startFromWorkspace(options.workspacePath);
        }
    } catch (err) {
        logger.warn("MLX server auto-start failed, continuing anyway", {
            module: "mlx",
            chatId: options.chatId,
            traceId,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    // Phase 4A: Persist user message FIRST, then load history
    // This ensures disk state is source of truth and avoids memory/disk divergence
    const userMessage: WindowMessage = { role: "user", content: options.prompt };
    await appendWindow(options.workspacePath, options.chatId, userMessage);

    // Load session window (now includes the just-persisted user message)
    const history = await loadWindow(options.workspacePath, options.chatId);

    // Apply budget trimming with summary generation
    const context = await applyBudgetTrimWithSummary(
        history,
        options.system,
        options.workspacePath,
        options.chatId
    );

    const requestBody = {
        model: modelId,
        messages: context,
        temperature: config.temperature,
        top_p: config.topP,
        max_tokens: config.maxTokens,
        repetition_penalty: 1.0,
    };

    logger.info("MLX 发送请求", {
        module: "mlx",
        chatId: options.chatId,
        traceId,
        messagesCount: context.length,
        maxTokens: config.maxTokens,
    });

    let response: MlxChatResponse;
    let usedRetry = false;

    // Phase 6: Try with full context first, then fallback to minimal on 404
    try {
        response = await mlxChatWithRetry(
            `${config.baseUrl}/v1/chat/completions`,
            requestBody,
            options.chatId,
            0,
            traceId
        );
    } catch (error) {
        if (isHttp404Error(error)) {
            usedRetry = true;
            logger.warn("MLX 404 错误，使用 minimal context 重试", {
                module: "mlx",
                chatId: options.chatId,
                traceId,
            });

            // Retry with minimal context (system + current user only, no history/summary)
            const minimalContext = buildMinimalContext(options.system, userMessage);
            response = await mlxFetch<MlxChatResponse>(`${config.baseUrl}/v1/chat/completions`, {
                method: "POST",
                timeout: 120000,
                body: JSON.stringify({
                    ...requestBody,
                    messages: minimalContext,
                }),
            });

            logger.info("MLX 404 重试成功", {
                module: "mlx",
                chatId: options.chatId,
                traceId,
                minimalContextLength: minimalContext.length,
            });
        } else {
            throw error;
        }
    }

    const msg = response.choices[0]?.message;
    // GLM-4.7: prefer 'content' field, fallback to 'reasoning' (some models put answer there)
    const content = msg?.content || msg?.reasoning || "";

    if (!content) {
        logger.error("MLX 响应内容为空", {
            module: "mlx",
            chatId: options.chatId,
            traceId,
            hasContent: !!msg?.content,
            hasReasoning: !!msg?.reasoning,
            responseKeys: msg ? Object.keys(msg) : [],
        });
        throw new Error("MLX_INVALID_RESPONSE: No content in response");
    }

    logger.info("MLX chat 完成", {
        module: "mlx",
        chatId: options.chatId,
        traceId,
        contentLength: content.length,
        usedRetry,
    });

    // Append assistant response to session window
    await appendWindow(options.workspacePath, options.chatId, {
        role: "assistant",
        content,
    });

    return content;
}

// ============================================
// Tool Loop
// ============================================

/**
 * Tool definitions for MLX
 *
 * Available tools:
 * - read(path: string): Read file contents
 * - bash(command: string): Execute shell commands
 * - edit(path: string, searchText: string, replaceText: string): Edit file with find-replace
 * - write(path: string, content: string): Write content to a file
 */
const MLX_TOOLS = [
    {
        type: "function",
        function: {
            name: "read",
            description: "Read the contents of a text file. Use this when you need to see code or understand file contents.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "File path to read (e.g., '/Users/<you>/msgcode-workspaces/<workspace>/src/main.ts')",
                    },
                },
                required: ["path"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "bash",
            description: "Execute shell commands. Use for git, npm, testing, grep, find, and other terminal operations.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "Shell command to execute (e.g., 'git status', 'npm test', 'grep -r pattern .')",
                    },
                },
                required: ["command"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "edit",
            description: "Edit a file by finding and replacing text. Use this to make precise code modifications.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "File path to edit",
                    },
                    searchText: {
                        type: "string",
                        description: "Text to search for (will be replaced with replaceText)",
                    },
                    replaceText: {
                        type: "string",
                        description: "Replacement text",
                    },
                },
                required: ["path", "searchText"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "write",
            description: "Write content to a new file or overwrite an existing file. Use to create new files.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "File path to write",
                    },
                    content: {
                        type: "string",
                        description: "Content to write to the file",
                    },
                },
                required: ["path", "content"],
            },
        },
    },
];

/**
 * Default system prompt for tool loop
 * Enforces tool usage for filesystem operations
 */
const DEFAULT_TOOL_LOOP_SYSTEM = `You are a helpful assistant with access to tools.

IMPORTANT: When you need filesystem information or want to execute commands, you MUST call the appropriate tools first:
- Use "read" tool to read file contents
- Use "bash" tool to execute commands (git, npm, test, grep, find, ls, cat, pwd, etc.)
- Use "edit" tool to edit files by finding and replacing text
- Use "write" tool to write content to a new file or overwrite an existing file

CRITICAL: Tool call format requirements
- You MUST use tool_calls (OpenAI tool calling), never write tool usage in plain text.
- tool_calls[].function.arguments MUST be a valid JSON object string.
- Do NOT use XML tags, YAML, Markdown, or pseudo-code in arguments.
- Only include keys defined in the tool schema.
- No comments, no trailing commas.

Do NOT claim you don't have permissions or cannot access files. Use the tools to gather information first, then provide your summary.`;

// ============================================
// Phase 5: Tool Execution Helper
// ============================================

/**
 * Execute a single tool call via Tool Bus or direct filesystem operations
 *
 * Maps MLX tool names to execution:
 * - read -> shell "cat <path>"
 * - bash -> executeTool("shell", { command }, ...)
 * - edit -> read file, replace text, write back (direct filesystem)
 * - write -> writeFile with content (direct filesystem)
 *
 * @param toolCall - Tool call from LLM response
 * @param workspacePath - Workspace directory path
 * @returns Tool result message
 */
async function executeSingleToolCall(
    toolCall: { id: string; type: string; function: { name: string; arguments: string } },
    workspacePath: string
): Promise<{ toolMessage: WindowMessage; toolName: string; toolArgs: Record<string, unknown>; toolResult: { ok: boolean; data?: unknown; error?: string } }> {
    const { executeTool } = await import("../tools/bus.js");
    const { logger } = await import("../logger/index.js");
    const toolName = toolCall.function.name;
    const toolArgsRaw = toolCall.function.arguments;
    let toolArgs: Record<string, unknown>;

    try {
        toolArgs = JSON.parse(toolArgsRaw);
    } catch {
        // JSON 解析失败：返回错误让模型重试，而不是执行空参数
        const toolMessage: WindowMessage = {
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({
                success: false,
                error: "Arguments must be valid JSON object string. Please retry with JSON.",
                raw: toolArgsRaw.slice(0, 500),
            }),
        };
        return { toolMessage, toolName, toolArgs: {}, toolResult: { ok: false, error: "Invalid JSON" } };
    }

    // P0: Log all tool calls for debugging tool loop crashes
    logger.info("MLX tool call", {
        module: "mlx",
        tool: toolName,
        args: JSON.stringify(toolArgs).slice(0, 200),
        workspacePath,
    });

    // P0: Strict validation - reject unknown tools BEFORE any execution
    const ALLOWED_TOOLS = ["read", "bash", "edit", "write"];
    if (!ALLOWED_TOOLS.includes(toolName)) {
        logger.warn("MLX tool rejected (unknown tool)", {
            module: "mlx",
            attemptedTool: toolName,
            allowedTools: ALLOWED_TOOLS.join(", "),
            workspacePath,
        });
        const toolResult = {
            ok: false,
            error: `Unknown tool: ${toolName}. Available tools: ${ALLOWED_TOOLS.join(", ")}`,
        };
        const toolMessage: WindowMessage = {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
                success: false,
                error: toolResult.error,
            }),
        };
        return { toolMessage, toolName, toolArgs, toolResult };
    }

    let toolResult: { ok: boolean; data?: unknown; error?: string } = { ok: false, error: "unhandled tool" };

    try {
        switch (toolName) {
            case "read": {
                const path = toolArgs.path as string;
                const r = await executeTool("shell", { command: `cat "${path}"` }, {
                    workspacePath,
                    source: "llm-tool-call",
                    requestId: randomUUID(),
                });
                toolResult = r.ok
                    ? { ok: true, data: r.data }
                    : { ok: false, error: r.error ? `${r.error.code}: ${r.error.message}` : "shell failed" };
                break;
            }
            case "bash": {
                const r = await executeTool("shell", toolArgs, {
                    workspacePath,
                    source: "llm-tool-call",
                    requestId: randomUUID(),
                });
                toolResult = r.ok
                    ? { ok: true, data: r.data }
                    : { ok: false, error: r.error ? `${r.error.code}: ${r.error.message}` : "shell failed" };
                break;
            }
            case "edit": {
                const path = toolArgs.path as string;
                const searchText = toolArgs.searchText as string;
                const replaceText = toolArgs.replaceText as string || "";

                // Use perl -pi -e for cross-platform in-place replacement
                // \Q...\E treats searchText as literal string (not regex)
                // Pass content via env vars to avoid shell escaping issues
                const r = await executeTool("shell", {
                    command: `MSGCODE_SEARCH="${searchText}" MSGCODE_REPLACE="${replaceText}" perl -pi -e 's/\\Q$ENV{MSGCODE_SEARCH}\\E/$ENV{MSGCODE_REPLACE}/g' "${path}"`,
                }, {
                    workspacePath,
                    source: "llm-tool-call",
                    requestId: randomUUID(),
                });
                toolResult = r.ok
                    ? { ok: true, data: r.data }
                    : { ok: false, error: r.error ? `${r.error.code}: ${r.error.message}` : "shell failed" };
                break;
            }
            case "write": {
                const path = toolArgs.path as string;
                const content = toolArgs.content as string;

                const { writeFile } = await import("node:fs/promises");
                await writeFile(path, content, "utf-8");

                toolResult = {
                    ok: true,
                    data: `Wrote ${content.length} characters to ${path}`,
                };
                break;
            }
        }
    } catch (err) {
        toolResult = {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }

    // Build tool result message
    const toolFeedback = toolResult.ok
        ? JSON.stringify({ success: true, data: toolResult.data })
        : JSON.stringify({ success: false, error: toolResult.error });

    const toolMessage: WindowMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolName,
        content: toolFeedback,
    };

    return { toolMessage, toolName, toolArgs, toolResult };
}

// ============================================
// Multi-round Tool Loop
// ============================================

/**
 * Run multi-round tool loop with session window and budget support
 *
 * Iterates until:
 * - No tool_calls in response (converged)
 * - MAX_TOOL_ROUNDS reached
 * - Unrecoverable error occurs
 *
 * Each round:
 * - Sends request with tools enabled
 * - If tool_calls exist, executes up to MAX_TOOLS_PER_ROUND tools
 * - After each tool, checks for steer intervention
 * - Continues to next round with tool results appended
 *
 * @param options - Tool loop options
 * @returns Tool loop result with final answer
 */
export async function runMlxToolLoop(options: MlxToolLoopOptions): Promise<MlxToolLoopResult> {
    const { getMlxConfig } = await import("../config/workspace.js");
    const config = await getMlxConfig(options.workspacePath);
    const modelId = await resolveModelId(config);

    // P0: Auto-start MLX server if not running (single instance enforcement)
    try {
        const { MlxServer } = await import("../runners/mlx.js");
        const status = await MlxServer.getStatus();
        if (!status.running) {
            const { logger } = await import("../logger/index.js");
            logger.info("MLX server not running, auto-starting", { module: "mlx" });
            await MlxServer.startFromWorkspace(options.workspacePath);
        }
    } catch (err) {
        const { logger } = await import("../logger/index.js");
        logger.warn("MLX server auto-start failed, continuing anyway", {
            module: "mlx",
            error: err instanceof Error ? err.message : String(err),
        });
    }

    // Phase 4A: Persist user message FIRST, then load history
    const userMessage: WindowMessage = { role: "user", content: options.prompt };
    await appendWindow(options.workspacePath, options.chatId, userMessage);

    // Load session window (now includes the just-persisted user message)
    let history = await loadWindow(options.workspacePath, options.chatId);

    // Use enhanced system prompt if none provided
    const systemPrompt = options.system || DEFAULT_TOOL_LOOP_SYSTEM;

    // Apply budget trimming with summary generation (initial round)
    let context = await applyBudgetTrimWithSummary(
        history,
        systemPrompt,
        options.workspacePath,
        options.chatId
    );

    // Track tool calls for result return
    const allToolCalls: Array<{ name: string; args: Record<string, unknown>; result: { ok: boolean; data?: unknown; error?: string } }> = [];

    // Phase 6: Track 404 fallback retry (only once per session)
    let hasPerformed404Fallback = false;

    // P0: Global limit on total tool calls across all rounds (prevents runaway loops)
    const MAX_TOTAL_TOOL_CALLS = 15;

    // ========================================
    // Multi-round Tool Loop
    // ========================================
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const { logger } = await import("../logger/index.js");
        logger.info("MLX tool loop round", {
            module: "mlx",
            round: round + 1,
            maxRounds: MAX_TOOL_ROUNDS,
            toolsSoFar: allToolCalls.length,
            maxTotalTools: MAX_TOTAL_TOOL_CALLS,
        });

        // P0: Check global tool call limit
        if (allToolCalls.length >= MAX_TOTAL_TOOL_CALLS) {
            logger.warn("MLX tool loop: max total tool calls reached, forcing termination", {
                module: "mlx",
                totalCalls: allToolCalls.length,
                limit: MAX_TOTAL_TOOL_CALLS,
                round: round + 1,
            });
            break;
        }

        // ===== Send request with tools =====
        let response: MlxChatResponse;

        // Phase 6: 404 fallback retry logic
        try {
            response = await mlxFetch<MlxChatResponse>(`${config.baseUrl}/v1/chat/completions`, {
                method: "POST",
                timeout: 120000,
                body: JSON.stringify({
                    model: modelId,
                    messages: context,
                    tools: MLX_TOOLS,
                    tool_choice: "auto",
                    temperature: config.temperature,
                    top_p: config.topP,
                    max_tokens: config.maxTokens,
                    repetition_penalty: 1.0,
                }),
            });
        } catch (error) {
            if (isHttp404Error(error) && !hasPerformed404Fallback && round === 0) {
                // Retry with minimal context (system + current user only, no history/summary)
                const { logger } = await import("../logger/index.js");
                logger.warn("MLX tool loop 404 error, retrying with minimal context", {
                    module: "mlx",
                    chatId: options.chatId,
                    reason: "mlx_404_fallback",
                    retry: 1,
                });

                hasPerformed404Fallback = true;
                const minimalContext = buildMinimalContext(systemPrompt, userMessage);
                context = minimalContext;

                response = await mlxFetch<MlxChatResponse>(`${config.baseUrl}/v1/chat/completions`, {
                    method: "POST",
                    timeout: 120000,
                    body: JSON.stringify({
                        model: modelId,
                        messages: context,
                        tools: MLX_TOOLS,
                        tool_choice: "auto",
                        temperature: config.temperature,
                        top_p: config.topP,
                        max_tokens: config.maxTokens,
                        repetition_penalty: 1.0,
                    }),
                });
            } else {
                throw error;
            }
        }

        const msg = response.choices[0]?.message;
        if (!msg) {
            throw new Error("MLX_INVALID_RESPONSE: No message in response");
        }

        const toolCalls = msg.tool_calls || [];

        // ===== Build assistant message =====
        const assistantMsg: WindowMessage = {
            role: "assistant",
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        if (msg.content) {
            assistantMsg.content = msg.content;
        }

        // Append assistant message to history
        history.push(assistantMsg);

        // ===== Convergence check: No tool calls =====
        if (toolCalls.length === 0) {
            // No more tools needed - this is the final answer
            // GLM-4.7: prefer 'content' field, fallback to 'reasoning' (some models put answer there)
            const finalAnswer = msg.content || msg.reasoning || "";

            // Append final assistant response to session window
            await appendWindow(options.workspacePath, options.chatId, assistantMsg);

            return { answer: finalAnswer };
        }

        // ===== Execute tools (up to MAX_TOOLS_PER_ROUND) =====
        const toolMessages: WindowMessage[] = [];
        let steerIntervention = false;

        for (let i = 0; i < Math.min(toolCalls.length, MAX_TOOLS_PER_ROUND); i++) {
            const toolCall = toolCalls[i];

            // Execute single tool call
            const { toolMessage, toolName, toolArgs, toolResult } = await executeSingleToolCall(
                toolCall,
                options.workspacePath
            );

            // Track tool call for result
            allToolCalls.push({ name: toolName, args: toolArgs, result: toolResult });

            // Phase 4B: Check for steer intervention after each tool
            const steerMessages = drainSteer(options.chatId);
            if (steerMessages.length > 0) {
                // Steer intervention: Inject steer message instead of tool result
                const steerMsg = steerMessages[0];
                toolMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({
                        success: true,
                        data: `[干预: ${steerMsg.content}]`,
                        _intervention: true,
                        _originalResult: toolResult.ok ? toolResult.data : toolResult.error,
                    }),
                });
                steerIntervention = true;
                // Skip remaining tools in this round
                break;
            }

            // Normal tool result
            toolMessages.push(toolMessage);
        }

        // Append tool messages to history
        history.push(...toolMessages);

        // Persist all messages to session window
        await appendWindow(options.workspacePath, options.chatId, assistantMsg);
        for (const tm of toolMessages) {
            await appendWindow(options.workspacePath, options.chatId, tm);
        }

        // ===== Rebuild context for next round =====
        const summary = await loadSummary(options.workspacePath, options.chatId);
        context = applyBudgetTrim(history, systemPrompt, summary);

        // If steer intervention occurred, skip to final round (no more tools)
        if (steerIntervention) {
            round = MAX_TOOL_ROUNDS - 1; // Force exit after next iteration
        }
    }

    // ===== Max rounds reached - force termination =====
    // Send one final request without tools to get summary
    const finalResponse = await mlxFetch<MlxChatResponse>(`${config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        timeout: 120000,
        body: JSON.stringify({
            model: modelId,
            messages: context,
            tools: [],  // No tools in final round
            tool_choice: "none",
            temperature: config.temperature,
            top_p: config.topP,
            max_tokens: config.maxTokens,
            repetition_penalty: 1.0,
        }),
    });

    const finalMsg = finalResponse.choices[0]?.message;
    // GLM-4.7: prefer 'content' field, fallback to 'reasoning' (some models put answer there)
    const finalAnswer = finalMsg?.content || finalMsg?.reasoning || `[达到最大工具轮次限制 (${MAX_TOOL_ROUNDS} 轮)，已终止工具循环]`;

    // Append final assistant response to session window
    await appendWindow(options.workspacePath, options.chatId, {
        role: "assistant",
        content: finalAnswer,
    });

    // Phase 4B P1 fix: Consume followUp messages after round completes
    const followUpMessage = consumeOneFollowUp(options.chatId);
    if (followUpMessage) {
        const nextUserMessage: WindowMessage = {
            role: "user",
            content: followUpMessage.content,
        };
        await appendWindow(options.workspacePath, options.chatId, nextUserMessage);
    }

    // Return first tool call info for backward compatibility
    const firstToolCall = allToolCalls[0];
    return {
        answer: finalAnswer,
        toolCall: firstToolCall ? {
            name: firstToolCall.name,
            args: firstToolCall.args,
            result: firstToolCall.result,
        } : undefined,
    };
}

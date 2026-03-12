/**
 * msgcode: Assistant 消息解析器
 *
 * 从 Claude Code JSONL 输出中提取 assistant 回复
 */

import type { JSONLEntry } from "./reader.js";
import { logger } from "../logger/index.js";

/**
 * 解析结果
 */
export interface ParseResult {
    text: string;
    hasToolUse: boolean;
    isComplete: boolean;
    finishReason?: string;
    /** P0 Batch-0: 是否检测到 stop_hook_summary */
    seenStopHookSummary?: boolean;
}

/**
 * 工具调用信息
 */
export interface ToolUseInfo {
    name: string;
    input?: any;
}

/**
 * Assistant 消息解析器
 */
export class AssistantParser {
    /**
     * 从 JSONL 条目中提取 assistant 消息
     *
     * P0 Batch-2: 兼容 stop_hook_summary + sidechain + 多种内容字段
     */
    static parse(entries: JSONLEntry[]): ParseResult {
        let text = "";
        let hasToolUse = false;
        let isComplete = false;
        let finishReason: string | undefined;
        // P0 Batch-0: 累积是否检测到 stop_hook_summary（任何条目有则标记）
        let seenStopHookSummary = false;

        for (const entry of entries) {
            const entryType = entry.type;
            const entrySubtype = entry.subtype;
            const message = entry.message as any;

            // P0 Batch-2: 优先检测 stop_hook_summary（type="system" + subtype="stop_hook_summary"）
            // 这必须在 assistant 类型检查之前，因为 system 类型会被下面跳过
            if (entryType === "system" && entrySubtype === "stop_hook_summary") {
                isComplete = true;
                finishReason = finishReason || "stop_hook_summary";
                seenStopHookSummary = true;
                continue;  // stop_hook_summary 不包含文本内容，跳过
            }

            // 只处理 assistant 类型的条目
            if (entryType !== "assistant") {
                continue;
            }

            // P0 Batch-2: 兼容两条路径抽取文本
            // 路径1: entry.type === "assistant" + entry.message.role === "assistant" + entry.message.content
            // 路径2: entry.type === "assistant" + 直接在 entry 上有内容字段
            let content = message?.content || entry.content;

            // P0 Batch-2: 支持多种内容字段（text / output_text / markdown）
            if (!content && message) {
                if (typeof message.text === "string") content = message.text;
                else if (typeof message.output_text === "string") content = message.output_text;
                else if (typeof message.markdown === "string") content = message.markdown;
            }
            if (!content && typeof entry.text === "string") content = entry.text;
            if (!content && typeof entry.output_text === "string") content = entry.output_text;
            if (!content && typeof entry.markdown === "string") content = entry.markdown;

            if (content) {
                if (typeof content === "string") {
                    // 过滤掉 observation/summary XML 块
                    const filteredContent = this.filterPluginOutput(content);
                    text += filteredContent;
                } else if (Array.isArray(content)) {
                    const blocks = content as Array<{ type: string; text?: string; name?: string }>;
                    for (const block of blocks) {
                        if (block.type === "text" && block.text) {
                            // 过滤掉 observation/summary XML 块
                            const filteredText = this.filterPluginOutput(block.text);
                            text += filteredText;
                        } else if (block.type === "tool_use" && block.name) {
                            hasToolUse = true;
                            // 工具调用不显示，只等待结果
                        } else if (block.type === "tool_result") {
                            hasToolUse = true;
                            // 工具结果不显示，只等待最终回复
                        }
                    }
                }
            }

            // 🔴 Stop Hook 检测：检查消息是否完成
            // 方式1: stop_reason === "end_turn"
            if (message?.stop_reason === "end_turn") {
                isComplete = true;
                finishReason = "end_turn";
            }

            // 方式2: type === "summary"（某些情况下是完成标志）
            if (entry.type === "summary" || entrySubtype === "summary") {
                isComplete = true;
                finishReason = finishReason || entrySubtype || entry.type;
            }

            // 方式3: status === "complete"
            if (entry.status === "complete" || entry.type === "complete") {
                isComplete = true;
                finishReason = finishReason || entry.status || entry.type;
            }

            if (!finishReason && entry.message?.metadata?.finish_reason) {
                isComplete = true;
                finishReason = entry.message.metadata.finish_reason;
            }
            if (!finishReason && entry.metadata?.finish_reason) {
                isComplete = true;
                finishReason = entry.metadata.finish_reason;
            }
        }

        return { text, hasToolUse, isComplete, finishReason, seenStopHookSummary };
    }

    /**
     * 提取纯文本（去除工具调用标记）
     */
    static toPlainText(result: ParseResult): string {
        let text = result.text;

        // 移除工具调用标记
        text = text.replace(/🔧 执行: [\w-]+\n?/g, "");

        return text.trim();
    }

    /**
     * 格式化为移动端友好的文本
     */
    static formatForIMessage(result: ParseResult): string {
        const plainText = this.toPlainText(result);

        // 限制长度（避免移动端消息过长难以阅读）
        const maxLength = 4000;
        if (plainText.length <= maxLength) {
            return plainText;
        }

        // 截断并添加提示
        return plainText.slice(0, maxLength - 50) + "\n\n... (消息过长，已截断)";
    }

    /**
     * 过滤插件/MCP 输出（移除 observation/summary XML 块）
     *
     * 策略：移除 <observation>...</observation> 和 <summary>...</summary> 块
     * 保留其他正常文本
     */
    private static filterPluginOutput(text: string): string {
        let filtered = text;

        // 移除 <observation>...</observation> 块（包括带数字前缀的）
        filtered = filtered.replace(/\d*<\/?observation>[^]*<\/?observation>/gi, "");

        // 移除 <summary>...</summary> 块（包括带数字前缀的）
        filtered = filtered.replace(/\d*<\/?summary>[^]*<\/?summary>/gi, "");

        // 移除残留的 XML 元素（如果上面的替换没有完全清除）
        filtered = filtered.replace(/<(title|facts|narrative|concepts|request|investigated|learned|completed|next_steps|notes|subtitle|type)>[^<]*<\/\1>/gi, "");

        // 移除未闭合的标签（如 "123observation>" 或 "123summary>"）
        filtered = filtered.replace(/\d+(observation|summary)>/gi, "");

        // 移除工具调用展示块（只保留最终回复）
        filtered = filtered.replace(/\*\*[^*]*Built-in Tool:[\s\S]*?\*Executing on server\.\.\.\*/gi, "");

        return filtered.trim();
    }

    /**
     * 从原始 JSONL 内容解析
     *
     * P1 修复：添加解析错误计数和日志
     */
    static parseJsonl(content: string): ParseResult {
        const entries: JSONLEntry[] = [];
        const lines = content.split("\n").filter(Boolean);
        let parseErrors = 0;

        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as JSONLEntry;
                entries.push(entry);
            } catch {
                parseErrors++;
                // 最多记录 3 条无效行详情，避免日志刷屏
                if (parseErrors <= 3) {
                    logger.warn(`[Parser] 跳过无效 JSONL 行: ${line.slice(0, 80)}...`, { module: "parser" });
                }
            }
        }

        if (parseErrors > 0) {
            logger.error(`[Parser] JSONL 解析共跳过 ${parseErrors} 行`, { module: "parser", parseErrors });
        }

        return this.parse(entries);
    }

    /**
     * 检测工具调用（用于流式输出的工具通知）
     *
     * @param entries JSONL 条目数组
     * @returns 检测到的工具调用列表
     */
    static detectToolUses(entries: JSONLEntry[]): ToolUseInfo[] {
        const toolUses: ToolUseInfo[] = [];

        for (const entry of entries) {
            // 只处理 assistant 类型的条目
            if (entry.type !== "assistant") {
                continue;
            }

            const message = entry.message as any;
            let content = message?.content || entry.content;

            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === "tool_use" && block.name) {
                        toolUses.push({
                            name: block.name,
                            input: block.input,
                        });
                    }
                }
            }
        }

        return toolUses;
    }

    /**
     * 检测是否有工具活动（tool_use / tool_result），不限定角色
     */
    static hasToolActivity(entries: JSONLEntry[]): boolean {
        for (const entry of entries) {
            const message = entry.message as any;
            const content = message?.content || entry.content;

            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block?.type === "tool_use" || block?.type === "tool_result") {
                        return true;
                    }
                }
            }

            if (entry.toolUseResult) {
                return true;
            }
        }
        return false;
    }
}

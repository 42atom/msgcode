/**
 * msgcode: Assistant 消息解析器
 *
 * 从 Claude Code JSONL 输出中提取 assistant 回复
 */

import type { JSONLEntry } from "./reader.js";

/**
 * 解析结果
 */
export interface ParseResult {
    text: string;
    hasToolUse: boolean;
    isComplete: boolean;
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
     */
    static parse(entries: JSONLEntry[]): ParseResult {
        let text = "";
        let hasToolUse = false;
        let isComplete = false;

        for (const entry of entries) {
            // Claude Code JSONL 结构:
            // - entry.type = "user" | "assistant" | "system" | ...
            // - entry.message = { role: "...", content: "...", stop_reason: "..." }
            const entryType = entry.type;
            const message = entry.message as any;

            // 只处理 assistant 类型的条目
            if (entryType !== "assistant") {
                continue;
            }

            // 提取文本内容 - content 可能在 message 里或直接在 entry 上
            let content = message?.content || entry.content;

            if (content) {
                if (typeof content === "string") {
                    text += content;
                } else if (Array.isArray(content)) {
                    const blocks = content as Array<{ type: string; text?: string; name?: string }>;
                    for (const block of blocks) {
                        if (block.type === "text" && block.text) {
                            text += block.text;
                        } else if (block.type === "tool_use" && block.name) {
                            hasToolUse = true;
                            // 工具调用可以选择性显示
                            text += `\n🔧 执行: ${block.name}\n`;
                        }
                    }
                }
            }

            // 🔴 Stop Hook 检测：检查消息是否完成
            // 方式1: stop_reason === "end_turn"
            if (message?.stop_reason === "end_turn") {
                isComplete = true;
            }

            // 方式2: type === "summary"（某些情况下是完成标志）
            if (entry.type === "summary" || entry.subtype === "summary" || entry.subtype === "stop_hook_summary") {
                isComplete = true;
            }

            // 方式3: status === "complete"
            if (entry.status === "complete" || entry.type === "complete") {
                isComplete = true;
            }
        }

        return { text, hasToolUse, isComplete };
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
     * 格式化为 iMessage 友好的文本
     */
    static formatForIMessage(result: ParseResult): string {
        const plainText = this.toPlainText(result);

        // 限制长度（iMessage 有长度限制）
        const maxLength = 4000;
        if (plainText.length <= maxLength) {
            return plainText;
        }

        // 截断并添加提示
        return plainText.slice(0, maxLength - 50) + "\n\n... (消息过长，已截断)";
    }

    /**
     * 从原始 JSONL 内容解析
     */
    static parseJsonl(content: string): ParseResult {
        const entries: JSONLEntry[] = [];
        const lines = content.split("\n").filter(Boolean);

        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as JSONLEntry;
                entries.push(entry);
            } catch {
                // 跳过无效行
            }
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
}

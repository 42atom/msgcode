/**
 * msgcode: Codex 消息解析器（T3: Codex 回复抽取）
 *
 * 从 Codex JSONL 输出中提取 assistant 回复
 * 解析 output_text 字段（Codex JSONL: response_item.payload.content[].type=output_text）
 */

import type { CodexJSONLEntry } from "./codex-reader.js";
import { logger } from "../logger/index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * 解析结果
 */
export interface CodexParseResult {
    text: string;
    isComplete: boolean;
    finishReason?: string;
}

/**
 * Codex 消息解析器
 */
export class CodexParser {
    /**
     * 从 Codex JSONL 条目中提取 assistant 消息
     */
    static parse(entries: CodexJSONLEntry[]): CodexParseResult {
        let text = "";
        let fallbackText = "";
        const isComplete = false; // Codex JSONL 没有稳定的“完成标志”，由外层稳定计数判定
        const finishReason: string | undefined = undefined;

        for (const entry of entries) {
            // Codex JSONL 结构（实测）：
            // {"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}]}}
            if (entry.type === "response_item") {
                if (!isRecord(entry.payload)) continue;
                if (entry.payload.type !== "message") continue;
                if (entry.payload.role !== "assistant") continue;

                const content = entry.payload.content;
                if (!Array.isArray(content)) continue;
                for (const part of content) {
                    if (!isRecord(part)) continue;
                    if (part.type !== "output_text" && part.type !== "text") continue;
                    if (typeof part.text !== "string") continue;
                    text += part.text;
                }
                continue;
            }

            // 兼容：有些版本/模式下可能只写 event_msg.agent_message（没有 response_item.message）
            // 在 response_item 能取到文本时，优先使用 response_item，避免重复。
            if (entry.type === "event_msg") {
                if (!isRecord(entry.payload)) continue;
                if (entry.payload.type !== "agent_message") continue;
                if (typeof entry.payload.message !== "string") continue;
                fallbackText += entry.payload.message + "\n";
            }
        }

        const finalText = text.trim().length > 0 ? text : fallbackText.trimEnd();
        return { text: finalText, isComplete, finishReason };
    }

    /**
     * 提取纯文本
     */
    static toPlainText(result: CodexParseResult): string {
        return result.text.trim();
    }

    /**
     * 格式化为 iMessage 友好的文本
     */
    static formatForIMessage(result: CodexParseResult): string {
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
    static parseJsonl(content: string): CodexParseResult {
        const entries: CodexJSONLEntry[] = [];
        const lines = content.split("\n").filter(Boolean);
        let parseErrors = 0;

        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as CodexJSONLEntry;
                entries.push(entry);
            } catch {
                parseErrors++;
                if (parseErrors <= 3) {
                    logger.warn(`[CodexParser] 跳过无效 JSONL 行: ${line.slice(0, 80)}...`, { module: "codex-parser" });
                }
            }
        }

        if (parseErrors > 0) {
            logger.error(`[CodexParser] JSONL 解析共跳过 ${parseErrors} 行`, { module: "codex-parser", parseErrors });
        }

        return this.parse(entries);
    }
}

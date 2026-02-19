/**
 * msgcode: 日志文本字段格式化工具
 *
 * 提供统一的文本转义与截断逻辑，用于日志字段输出
 * 消除 inboundText/responseText 等字段的重复处理代码
 */

// ============================================
// 文本格式化工具函数
// ============================================

/**
 * 格式化日志文本字段（转义 + 截断）
 *
 * 统一处理逻辑：
 * 1. 转义特殊字符：\ → \\, " → \", 换行 → \n
 * 2. 截断超长文本：超过 maxChars 时添加省略号
 *
 * @param value - 原始值（任意类型，会被 String() 转换）
 * @param maxChars - 最大字符数，默认 500
 * @returns 格式化后的字符串（已转义、已截断）
 *
 * @example
 * formatLogTextField("hello")           // "hello"
 * formatLogTextField("a\\b")            // "a\\\\b"
 * formatLogTextField("say \"hi\"")      // "say \\\"hi\\\""
 * formatLogTextField("line1\nline2")    // "line1\\nline2"
 * formatLogTextField("a".repeat(600))   // 前 500 字符 + "…"
 * formatLogTextField(null)              // "null"
 * formatLogTextField(undefined)         // "undefined"
 */
export function formatLogTextField(value: unknown, maxChars = 500): string {
    const raw = String(value);

    // 转义顺序有讲究：先转义反斜杠，再转义其他
    const normalized = raw
        .replace(/\\/g, "\\\\")    // 反斜杠 → \\
        .replace(/"/g, '\\"')      // 双引号 → \"
        .replace(/\r?\n/g, "\\n"); // 换行 → \n

    // 截断超长文本
    return normalized.length > maxChars
        ? `${normalized.slice(0, maxChars)}…`
        : normalized;
}

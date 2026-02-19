/**
 * msgcode: 日志文本格式化工具 BDD 测试
 *
 * 测试场景：
 * - Scenario A: 特殊字符转义
 * - Scenario B: 长文本截断
 * - Scenario C: 边界值处理
 */

import { describe, test, expect } from "bun:test";
import { formatLogTextField } from "../src/logger/format-text.js";

describe("formatLogTextField", () => {
    describe("Scenario A: 特殊字符转义", () => {
        test("应该转义反斜杠", () => {
            expect(formatLogTextField("a\\b")).toBe("a\\\\b");
        });

        test("应该转义双引号", () => {
            expect(formatLogTextField('say "hi"')).toBe('say \\"hi\\"');
        });

        test("应该转义换行符 \\n", () => {
            expect(formatLogTextField("line1\nline2")).toBe("line1\\nline2");
        });

        test("应该转义 Windows 换行符 \\r\\n", () => {
            expect(formatLogTextField("line1\r\nline2")).toBe("line1\\nline2");
        });

        test("应该正确处理混合转义", () => {
            expect(formatLogTextField('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd');
        });

        test("普通文本不应变化", () => {
            expect(formatLogTextField("请执行 pwd")).toBe("请执行 pwd");
        });
    });

    describe("Scenario B: 长文本截断", () => {
        test("短于 500 字符不应截断", () => {
            const shortText = "a".repeat(100);
            expect(formatLogTextField(shortText)).toBe(shortText);
            expect(formatLogTextField(shortText)).not.toContain("…");
        });

        test("等于 500 字符不应截断", () => {
            const exactText = "a".repeat(500);
            expect(formatLogTextField(exactText)).toBe(exactText);
            expect(formatLogTextField(exactText)).not.toContain("…");
        });

        test("超过 500 字符应该截断并添加省略号", () => {
            const longText = "a".repeat(600);
            const result = formatLogTextField(longText);
            expect(result).toHaveLength(501); // 500 + …
            expect(result).toBe("a".repeat(500) + "…");
        });

        test("应该支持自定义截断长度", () => {
            const text = "a".repeat(100);
            const result = formatLogTextField(text, 50);
            expect(result).toBe("a".repeat(50) + "…");
        });

        test("截断后转义字符计数正确", () => {
            // 每个反斜杠变成两个，总长度翻倍
            const longText = "\\".repeat(300); // 原始 300 个反斜杠
            const result = formatLogTextField(longText);
            // 转义后变成 600 个反斜杠，超过 500，截断到 500 + …
            expect(result).toBe("\\".repeat(500) + "…");
        });
    });

    describe("Scenario C: 边界值处理", () => {
        test("null 应该转为字符串 'null'", () => {
            expect(formatLogTextField(null)).toBe("null");
        });

        test("undefined 应该转为字符串 'undefined'", () => {
            expect(formatLogTextField(undefined)).toBe("undefined");
        });

        test("数字应该转为字符串", () => {
            expect(formatLogTextField(123)).toBe("123");
            expect(formatLogTextField(0)).toBe("0");
        });

        test("布尔值应该转为字符串", () => {
            expect(formatLogTextField(true)).toBe("true");
            expect(formatLogTextField(false)).toBe("false");
        });

        test("空字符串应该返回空字符串", () => {
            expect(formatLogTextField("")).toBe("");
        });

        test("对象应该转为 [object Object]", () => {
            expect(formatLogTextField({ foo: "bar" })).toBe("[object Object]");
        });

        test("数组应该转为字符串", () => {
            expect(formatLogTextField([1, 2, 3])).toBe("1,2,3");
        });
    });

    describe("Scenario D: 实际使用场景", () => {
        test("模拟 inboundText 场景", () => {
            const input = "请执行 ls -la";
            expect(formatLogTextField(input)).toBe("请执行 ls -la");
        });

        test("模拟 responseText 场景（带代码块）", () => {
            const response = '执行结果：\n```\npwd\n/Users/test\n```';
            const expected = '执行结果：\\n```\\npwd\\n/Users/test\\n```';
            expect(formatLogTextField(response)).toBe(expected);
        });

        test("模拟超长 responseText 截断", () => {
            const longResponse = "结果：\n" + "x".repeat(1000);
            const result = formatLogTextField(longResponse);
            expect(result).toContain("结果：\\n");
            expect(result.endsWith("…")).toBe(true);
            expect(result.length).toBe(501);
        });
    });
});

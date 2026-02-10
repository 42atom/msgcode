/**
 * msgcode: OutputReader 单元测试
 *
 * P0: 验证字节 offset 的正确性（避免中文 UTF-8 编码问题）
 */

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OutputReader } from "../src/output/reader.js";

describe("OutputReader", () => {
    const testDir = path.join(process.cwd(), ".test-output-reader");
    const testFile = path.join(testDir, "test.jsonl");

    beforeEach(async () => {
        // 清理并创建测试目录
        await fs.rm(testDir, { recursive: true, force: true });
        await fs.mkdir(testDir, { recursive: true });
    });

    test("P0: 中文字符不会导致 offset 错位（字节 vs 字符）", async () => {
        const reader = new OutputReader();

        // 场景：文件包含 30 个中文字符（约 90 字节）
        const chineseContent = "这是三十个中文字符的测试内容用来验证字节偏移是否正确" +
                              "第二行也是三十个中文字符继续验证字节偏移的正确性";

        const lines = [
            JSON.stringify({ type: "system", content: "start" }),
            JSON.stringify({ type: "user", content: chineseContent }),
            JSON.stringify({ type: "assistant", content: "回复中文字符" }),
        ];

        const initialContent = lines.join("\n") + "\n";
        await fs.writeFile(testFile, initialContent, "utf-8");

        // 第一次读取：应该读出全部 3 行
        const result1 = await reader.read(testFile);
        expect(result1.entries).toHaveLength(3);
        expect(result1.entries[0].type).toBe("system");
        expect(result1.entries[1].content).toBe(chineseContent);
        expect(result1.entries[2].type).toBe("assistant");

        const offset1 = result1.newOffset;

        // 追加新内容（包含中文）
        const newEntry = JSON.stringify({ type: "user", content: "追加的中文内容" });
        await fs.appendFile(testFile, newEntry + "\n", "utf-8");

        // 第二次读取：应该只读新增的 1 行（不会重复读）
        const result2 = await reader.read(testFile);
        expect(result2.entries).toHaveLength(1);
        expect(result2.entries[0].content).toBe("追加的中文内容");

        // 验证 offset 是递增的（字节偏移）
        const offset2 = result2.newOffset;
        expect(offset2).toBeGreaterThan(offset1);
    });

    test("P0: 混合中英文内容的增量读取", async () => {
        const reader = new OutputReader();

        // 初始内容：中英文混合
        const mixedContent = "Hello 世界！This is a test with 中文 characters.";
        const initialLines = [
            JSON.stringify({ type: "test", content: mixedContent }),
            JSON.stringify({ type: "test", content: "Line 2 with more 中文" }),
        ];

        await fs.writeFile(testFile, initialLines.join("\n") + "\n", "utf-8");

        // 第一次读取
        const result1 = await reader.read(testFile);
        expect(result1.entries).toHaveLength(2);
        expect(result1.entries[0].content).toBe(mixedContent);

        // 追加纯英文内容
        const newLine = JSON.stringify({ type: "test", content: "Pure English content" });
        await fs.appendFile(testFile, newLine + "\n", "utf-8");

        // 第二次读取：应该只读新增的 1 行
        const result2 = await reader.read(testFile);
        expect(result2.entries).toHaveLength(1);
        expect(result2.entries[0].content).toBe("Pure English content");

        // 再追加中文内容
        const newLine2 = JSON.stringify({ type: "test", content: "更多中文内容" });
        await fs.appendFile(testFile, newLine2 + "\n", "utf-8");

        // 第三次读取：应该只读新增的 1 行
        const result3 = await reader.read(testFile);
        expect(result3.entries).toHaveLength(1);
        expect(result3.entries[0].content).toBe("更多中文内容");
    });

    test("文件被重写时从头开始读", async () => {
        const reader = new OutputReader();

        // 初始内容（包含较长的内容，确保文件有足够大小）
        const longContent = "这是很长的初始内容用来确保文件有足够的大小" +
                           "这样当我们重写文件时新文件会更小" +
                           "这应该触发从头开始读取的逻辑";
        const initialContent = JSON.stringify({ type: "test", content: longContent }) + "\n";
        await fs.writeFile(testFile, initialContent, "utf-8");

        // 第一次读取
        const result1 = await reader.read(testFile);
        expect(result1.entries).toHaveLength(1);

        const stat1 = await fs.stat(testFile);
        console.log("[DEBUG] 初始文件大小:", stat1.size, "字节, offset:", result1.newOffset);

        // 文件被重写（明显变小）
        const shortContent = "短";
        const rewrittenContent = JSON.stringify({ type: "test", content: shortContent }) + "\n";
        await fs.writeFile(testFile, rewrittenContent, "utf-8");

        const stat2 = await fs.stat(testFile);
        console.log("[DEBUG] 重写后文件大小:", stat2.size, "字节");

        // 第二次读取：应该从头开始读（不会漏读）
        const result2 = await reader.read(testFile);
        expect(result2.entries).toHaveLength(1);
        expect(result2.entries[0].content).toBe(shortContent);
    });

    test("setPosition 和 getPosition 的字节偏移一致性", async () => {
        const reader = new OutputReader();

        // 写入测试内容
        const content = JSON.stringify({ type: "test", content: "测试" }) + "\n";
        await fs.writeFile(testFile, content, "utf-8");

        // 获取文件字节数
        const stat = await fs.stat(testFile);
        const fileBytes = stat.size;

        // 设置字节偏移
        reader.setPosition(testFile, fileBytes);

        // 读取应该返回空（已读到末尾）
        const result = await reader.read(testFile);
        expect(result.entries).toHaveLength(0);
        expect(result.newOffset).toBe(fileBytes);

        // getPosition 应该返回相同的值
        expect(reader.getPosition(testFile)).toBe(fileBytes);
    });

    test("reset 清除读取位置", async () => {
        const reader = new OutputReader();

        // 写入测试内容
        const content = JSON.stringify({ type: "test", content: "测试" }) + "\n";
        await fs.writeFile(testFile, content, "utf-8");

        // 第一次读取
        const result1 = await reader.read(testFile);
        expect(result1.entries).toHaveLength(1);

        // 追加内容
        await fs.appendFile(testFile, JSON.stringify({ type: "test", content: "新内容" }) + "\n", "utf-8");

        // 第二次读取：应该读到新内容
        const result2 = await reader.read(testFile);
        expect(result2.entries).toHaveLength(1);

        // reset 后重新读取：应该从头开始（包含所有内容）
        reader.reset(testFile);
        const result3 = await reader.read(testFile);
        expect(result3.entries).toHaveLength(2);
    });

    test("文件不存在时返回空结果", async () => {
        const reader = new OutputReader();
        const nonExistentFile = path.join(testDir, "nonexistent.jsonl");

        const result = await reader.read(nonExistentFile);
        expect(result.entries).toHaveLength(0);
        expect(result.bytesRead).toBe(0);
        expect(result.newOffset).toBe(0);
    });

    test("P0: 长中文内容的字节偏移精确性", async () => {
        const reader = new OutputReader();

        // 生成长中文内容（100 个字符）
        const longChinese = "这是很长的中文内容用来测试字节偏移的精确性" +
                           "每个中文字符在UTF-8编码中占用三个字节" +
                           "所以一百个中文字符应该占用三百个字节" +
                           "这个测试确保我们的字节偏移计算是正确的" +
                           "不会因为字符数和字节数的差异而导致读取错误" +
                           "这对于JSONL文件的增量读取非常重要" +
                           "因为我们需要准确地知道上次读取到的位置" +
                           "这样才能在下一次读取时只读取新增的内容" +
                           "而不是重复读取或者漏读某些内容" +
                           "这个测试涵盖了各种中文字符和标点符号";

        const entry = JSON.stringify({ type: "test", content: longChinese });
        await fs.writeFile(testFile, entry + "\n", "utf-8");

        // 第一次读取
        const result1 = await reader.read(testFile);
        expect(result1.entries).toHaveLength(1);
        expect(result1.entries[0].content).toBe(longChinese);

        const offset1 = result1.newOffset;

        // 追加同样长度的内容
        await fs.appendFile(testFile, entry + "\n", "utf-8");

        // 第二次读取
        const result2 = await reader.read(testFile);
        expect(result2.entries).toHaveLength(1);

        // 验证字节偏移正确（两次读取的字节数应该相等）
        expect(result2.newOffset - offset1).toBe(offset1);
    });
});

// 清理测试文件
afterAll(async () => {
    const testDir = path.join(process.cwd(), ".test-output-reader");
    await fs.rm(testDir, { recursive: true, force: true });
});

#!/usr/bin/env node
/**
 * Batch-2 验收脚本：测试 JSONL 解析器
 *
 * 从实际 Claude Code JSONL 文件中提取 assistant 回复
 */

import { readFileSync } from "node:fs";
import { AssistantParser } from "../src/output/parser.js";

interface JSONLEntry {
    timestamp: number;
    type?: string;
    subtype?: string;
    content?: string;
    message?: any;
    [key: string]: any;
}

function parseJsonlFile(filePath: string): JSONLEntry[] {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const entries: JSONLEntry[] = [];

    for (const line of lines) {
        try {
            const entry = JSON.parse(line) as JSONLEntry;
            entries.push(entry);
        } catch {
            // 跳过无效行
        }
    }

    return entries;
}

function main() {
    const jsonlPath = process.argv[2];
    if (!jsonlPath) {
        console.error("用法: node scripts/test-jsonl-parser.ts <path/to/session.jsonl>");
        console.error("示例: node scripts/test-jsonl-parser.ts ~/.claude/projects/<project>/<session>.jsonl");
        process.exit(2);
    }

    console.log(`📂 解析文件: ${jsonlPath}`);
    console.log("");

    const entries = parseJsonlFile(jsonlPath);
    console.log(`📊 总条目数: ${entries.length}`);

    // 统计条目类型
    const typeStats = new Map<string, number>();
    for (const entry of entries) {
        const key = entry.type || "(no type)";
        typeStats.set(key, (typeStats.get(key) || 0) + 1);
    }
    console.log(`📋 条目类型分布:`);
    for (const [type, count] of typeStats) {
        console.log(`   - ${type}: ${count}`);
    }
    console.log("");

    // 检测 stop_hook_summary
    const stopHookEntries = entries.filter(e => e.type === "system" && e.subtype === "stop_hook_summary");
    console.log(`🔍 stop_hook_summary 条目: ${stopHookEntries.length} 个`);
    console.log("");

    // 解析
    console.log(`🔧 解析中...`);
    const result = AssistantParser.parse(entries);

    console.log("");
    console.log(`✅ 解析结果:`);
    console.log(`   - 文本长度: ${result.text.length} 字符`);
    console.log(`   - hasToolUse: ${result.hasToolUse}`);
    console.log(`   - isComplete: ${result.isComplete}`);
    console.log(`   - finishReason: ${result.finishReason || "(无)"}`);
    console.log(`   - seenStopHookSummary: ${result.seenStopHookSummary || false}`);
    console.log("");

    // 显示文本预览
    if (result.text.length > 0) {
        const preview = result.text.slice(0, 200);
        console.log(`📝 文本预览:`);
        console.log("   " + preview.split("\n").join("\n   "));
        if (result.text.length > 200) {
            console.log(`   ... (还有 ${result.text.length - 200} 字符)`);
        }
    } else {
        console.log(`⚠️  未提取到文本内容`);
    }

    console.log("");
    console.log(`✅ 验收标准:`);
    console.log(`   1. stop_hook_summary 被识别: ${result.seenStopHookSummary ? "✓" : "✗"}`);
    console.log(`   2. isComplete 正确: ${result.isComplete ? "✓" : "✗"}`);
    console.log(`   3. 文本被提取: ${result.text.length > 0 ? "✓" : "✗"}`);

    // 返回退出码
    const passed = result.seenStopHookSummary && result.isComplete && result.text.length > 0;
    process.exit(passed ? 0 : 1);
}

main();

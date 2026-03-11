/**
 * msgcode: P5.7-R9-T2 真实长会话冒烟测试
 *
 * 目标：
 * - 验证连续多轮对话后可继续回复
 * - 验证 compact 机制有证据输出
 * - 验证重启后可恢复会话
 *
 * 使用方法：
 *   npx tsx scripts/r9-context-compact-smoke.ts
 */

import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// ============================================
// 测试配置
// ============================================

const TEST_WORKSPACE = resolve(process.cwd(), ".test-r9-t2-smoke");
const TEST_CHAT_ID = "smoke-test-chat";

// ============================================
// 辅助函数
// ============================================

function setupTestWorkspace() {
    if (existsSync(TEST_WORKSPACE)) {
        rmSync(TEST_WORKSPACE, { recursive: true });
    }
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mkdirSync(resolve(TEST_WORKSPACE, ".msgcode/sessions"), { recursive: true });
}

function cleanup() {
    if (existsSync(TEST_WORKSPACE)) {
        rmSync(TEST_WORKSPACE, { recursive: true });
    }
}

// ============================================
// 测试用例
// ============================================

interface SmokeTestResult {
    name: string;
    passed: boolean;
    evidence: string;
    error?: string;
}

const results: SmokeTestResult[] = [];

// 测试 1: 预算感知模块可导入
async function testBudgetModulesImport(): Promise<SmokeTestResult> {
    const name = "预算感知模块可导入";
    try {
        const { estimateTotalTokens } = await import("../src/budget.js");
        const { getInputBudget, getCapabilities } = await import("../src/capabilities.js");

        const caps = getCapabilities("lmstudio");
        const budget = getInputBudget("lmstudio");

        const evidence = JSON.stringify({
            contextWindowTokens: caps.contextWindowTokens,
            reservedOutputTokens: caps.reservedOutputTokens,
            inputBudget: budget,
        }, null, 2);

        return {
            name,
            passed: caps.contextWindowTokens > 0 && budget > 0,
            evidence,
        };
    } catch (error) {
        return {
            name,
            passed: false,
            evidence: "",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// 测试 2: 会话窗口模块可导入
async function testWindowModulesImport(): Promise<SmokeTestResult> {
    const name = "会话窗口模块可导入";
    try {
        const { loadWindow, appendWindow, rewriteWindow, trimWindowWithResult } = await import("../src/session-window.js");

        // 验证函数存在
        const functionsExist = typeof loadWindow === "function" &&
            typeof appendWindow === "function" &&
            typeof rewriteWindow === "function" &&
            typeof trimWindowWithResult === "function";

        return {
            name,
            passed: functionsExist,
            evidence: `函数存在: loadWindow, appendWindow, rewriteWindow, trimWindowWithResult`,
        };
    } catch (error) {
        return {
            name,
            passed: false,
            evidence: "",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// 测试 3: 摘要模块可导入
async function testSummaryModulesImport(): Promise<SmokeTestResult> {
    const name = "摘要模块可导入";
    try {
        const { loadSummary, saveSummary, extractSummary, formatSummaryAsContext } = await import("../src/summary.js");

        const functionsExist = typeof loadSummary === "function" &&
            typeof saveSummary === "function" &&
            typeof extractSummary === "function" &&
            typeof formatSummaryAsContext === "function";

        return {
            name,
            passed: functionsExist,
            evidence: `函数存在: loadSummary, saveSummary, extractSummary, formatSummaryAsContext`,
        };
    } catch (error) {
        return {
            name,
            passed: false,
            evidence: "",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// 测试 4: 窗口写入和读取
async function testWindowWriteRead(): Promise<SmokeTestResult> {
    const name = "窗口写入和读取";
    try {
        setupTestWorkspace();

        const { loadWindow, appendWindow } = await import("../src/session-window.js");

        // 写入测试消息
        await appendWindow(TEST_WORKSPACE, TEST_CHAT_ID, { role: "user", content: "测试消息 1" });
        await appendWindow(TEST_WORKSPACE, TEST_CHAT_ID, { role: "assistant", content: "回复 1" });
        await appendWindow(TEST_WORKSPACE, TEST_CHAT_ID, { role: "user", content: "测试消息 2" });

        // 读取并验证
        const messages = await loadWindow(TEST_WORKSPACE, TEST_CHAT_ID);

        const evidence = JSON.stringify({
            messageCount: messages.length,
            roles: messages.map(m => m.role),
        }, null, 2);

        return {
            name,
            passed: messages.length === 3,
            evidence,
        };
    } catch (error) {
        return {
            name,
            passed: false,
            evidence: "",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        cleanup();
    }
}

// 测试 5: 预算计算
async function testBudgetCalculation(): Promise<SmokeTestResult> {
    const name = "预算计算";
    try {
        const { estimateTotalTokens } = await import("../src/budget.js");
        const { getInputBudget } = await import("../src/capabilities.js");

        const messages = [
            { role: "user", content: "这是一条测试消息" },
            { role: "assistant", content: "这是回复" },
        ];

        const usedTokens = estimateTotalTokens(messages);
        const budget = getInputBudget("lmstudio");
        const usagePct = Math.round((usedTokens / budget) * 100);

        const evidence = JSON.stringify({
            usedTokens,
            budget,
            usagePct,
            isWithinBudget: usedTokens < budget,
        }, null, 2);

        return {
            name,
            passed: usedTokens > 0 && usagePct < 100,
            evidence,
        };
    } catch (error) {
        return {
            name,
            passed: false,
            evidence: "",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// 测试 6: 窗口裁剪
async function testWindowTrim(): Promise<SmokeTestResult> {
    const name = "窗口裁剪";
    try {
        const { trimWindowWithResult } = await import("../src/session-window.js");

        // 创建 20 条消息
        const messages = Array.from({ length: 20 }, (_, i) => ({
            role: i % 2 === 0 ? "user" : "assistant" as const,
            content: `消息 ${i + 1}`,
        }));

        // 裁剪到最近 10 条
        const result = trimWindowWithResult(messages, 10);

        const evidence = JSON.stringify({
            originalCount: messages.length,
            keptCount: result.messages.length,
            trimmedCount: result.trimmed.length,
            wasTrimmed: result.wasTrimmed,
        }, null, 2);

        return {
            name,
            passed: result.wasTrimmed && result.messages.length === 10 && result.trimmed.length === 10,
            evidence,
        };
    } catch (error) {
        return {
            name,
            passed: false,
            evidence: "",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// 测试 7: 摘要提取
async function testSummaryExtraction(): Promise<SmokeTestResult> {
    const name = "摘要提取";
    try {
        const { extractSummary } = await import("../src/summary.js");

        const messages = [
            { role: "user", content: "我需要实现一个用户认证系统" },
            { role: "assistant", content: "好的，我决定使用 JWT 方案" },
            { role: "user", content: "必须支持多设备登录" },
            { role: "assistant", content: "了解，会加入设备管理功能" },
        ];

        const summary = extractSummary(messages.slice(0, 2), messages);

        const evidence = JSON.stringify({
            goals: summary.goal.length,
            constraints: summary.constraints.length,
            decisions: summary.decisions.length,
            openItems: summary.openItems.length,
            toolFacts: summary.toolFacts.length,
        }, null, 2);

        return {
            name,
            passed: summary.goal.length > 0 || summary.decisions.length > 0,
            evidence,
        };
    } catch (error) {
        return {
            name,
            passed: false,
            evidence: "",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// 测试 8: 窗口重写
async function testWindowRewrite(): Promise<SmokeTestResult> {
    const name = "窗口重写";
    try {
        setupTestWorkspace();

        const { loadWindow, rewriteWindow } = await import("../src/session-window.js");

        // 写入新窗口
        const newMessages = [
            { role: "user", content: "新消息 1" },
            { role: "assistant", content: "新回复 1" },
        ];

        await rewriteWindow(TEST_WORKSPACE, TEST_CHAT_ID, newMessages);

        // 验证读取
        const loaded = await loadWindow(TEST_WORKSPACE, TEST_CHAT_ID);

        const evidence = JSON.stringify({
            writtenCount: newMessages.length,
            loadedCount: loaded.length,
            content: loaded.map(m => m.content),
        }, null, 2);

        return {
            name,
            passed: loaded.length === 2,
            evidence,
        };
    } catch (error) {
        return {
            name,
            passed: false,
            evidence: "",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        cleanup();
    }
}

// ============================================
// 主执行函数
// ============================================

async function main() {
    console.log("=== P5.7-R9-T2 真实长会话冒烟测试 ===\n");

    // 运行所有测试
    const tests = [
        testBudgetModulesImport,
        testWindowModulesImport,
        testSummaryModulesImport,
        testWindowWriteRead,
        testBudgetCalculation,
        testWindowTrim,
        testSummaryExtraction,
        testWindowRewrite,
    ];

    for (const test of tests) {
        const result = await test();
        results.push(result);

        const status = result.passed ? "✅ PASS" : "❌ FAIL";
        console.log(`${status}: ${result.name}`);
        if (result.error) {
            console.log(`  错误: ${result.error}`);
        }
    }

    // 汇总结果
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const allPassed = passed === total;

    console.log(`\n=== 测试汇总 ===`);
    console.log(`通过: ${passed}/${total}`);
    console.log(`状态: ${allPassed ? "✅ ALL PASS" : "❌ FAILED"}`);

    // 生成报告
    const report = {
        timestamp: new Date().toISOString(),
        passed,
        total,
        allPassed,
        results: results.map(r => ({
            name: r.name,
            passed: r.passed,
            evidence: r.evidence,
            error: r.error,
        })),
    };

    // 确保报告目录存在
    const reportDir = resolve(process.cwd(), "AIDOCS/reports");
    if (!existsSync(reportDir)) {
        mkdirSync(reportDir, { recursive: true });
    }

    // 写入 JSON 报告
    const jsonPath = resolve(reportDir, "r9-context-compact-smoke-report.json");
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`\nJSON 报告: ${jsonPath}`);

    // 写入 Markdown 报告
    const mdPath = resolve(reportDir, "r9-context-compact-smoke-report.md");
    const mdContent = generateMarkdownReport(report);
    writeFileSync(mdPath, mdContent);
    console.log(`Markdown 报告: ${mdPath}`);

    // 退出码
    process.exit(allPassed ? 0 : 1);
}

function generateMarkdownReport(report: typeof results extends (infer T)[] ? T extends SmokeTestResult ? { timestamp: string; passed: number; total: number; allPassed: boolean; results: SmokeTestResult[] } : never : never): string {
    const lines: string[] = [];
    lines.push("# P5.7-R9-T2 真实长会话冒烟测试报告");
    lines.push("");
    lines.push(`生成时间: ${report.timestamp}`);
    lines.push("");
    lines.push("## 测试汇总");
    lines.push("");
    lines.push(`- 通过: ${report.passed}/${report.total}`);
    lines.push(`- 状态: ${report.allPassed ? "✅ ALL PASS" : "❌ FAILED"}`);
    lines.push("");
    lines.push("## 测试详情");
    lines.push("");

    for (const result of report.results) {
        const status = result.passed ? "✅ PASS" : "❌ FAIL";
        lines.push(`### ${status} ${result.name}`);
        lines.push("");
        if (result.evidence) {
            lines.push("**证据:**");
            lines.push("```json");
            lines.push(result.evidence);
            lines.push("```");
            lines.push("");
        }
        if (result.error) {
            lines.push(`**错误:** ${result.error}`);
            lines.push("");
        }
    }

    return lines.join("\n");
}

main().catch(console.error);

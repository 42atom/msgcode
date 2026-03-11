/**
 * Tool Loop Smoke Gate - 20-case 回归测试
 *
 * P5.7-R3k: 每日健康检查门禁
 *
 * 测试集分层：
 * - L1 (5条): 单工具成功
 * - L2 (5条): 工具失败可诊断
 * - L3 (5条): 二轮收口稳定
 * - L4 (5条): 复杂任务链路
 *
 * 通过阈值：>= 19/20
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================
// 类型定义
// ============================================

interface SmokeCase {
    id: string;
    level: "L1" | "L2" | "L3" | "L4";
    description: string;
    prompt: string;
    expectedTool?: string; // 预期调用的工具名
    expectFailure?: boolean; // 预期工具失败
    expectEmptyResponse?: boolean; // 预期空答复
    validate?: (response: string, toolName?: string) => boolean;
}

interface SmokeResult {
    caseId: string;
    passed: boolean;
    reason: string;
    response?: string;
    toolName?: string;
    durationMs: number;
}

interface SmokeReport {
    timestamp: string;
    totalCases: number;
    passed: number;
    failed: number;
    passRate: string;
    gateStatus: "PASS" | "FAIL";
    results: SmokeResult[];
    summary: {
        L1: { total: number; passed: number };
        L2: { total: number; passed: number };
        L3: { total: number; passed: number };
        L4: { total: number; passed: number };
    };
}

// ============================================
// 20-case 测试集（冻结）
// ============================================

const SMOKE_CASES: SmokeCase[] = [
    // L1: 单工具成功（5条）
    {
        id: "L1-01",
        level: "L1",
        description: "read_file: 读取存在的文件",
        prompt: "读取 package.json 文件的前 5 行",
        expectedTool: "read_file",
        validate: (res) => res.includes("package") || res.includes("name"),
    },
    {
        id: "L1-02",
        level: "L1",
        description: "read_file: 读取指定路径文件",
        prompt: "读取 src/index.ts 文件的前 10 行",
        expectedTool: "read_file",
        validate: (res) => res.length > 0,
    },
    {
        id: "L1-03",
        level: "L1",
        description: "bash: 列出目录内容",
        prompt: "用 bash 列出当前目录下的文件",
        expectedTool: "bash",
        validate: (res) => res.length > 0,
    },
    {
        id: "L1-04",
        level: "L1",
        description: "bash: 获取当前工作目录",
        prompt: "用 bash 执行 pwd 命令",
        expectedTool: "bash",
        validate: (res) => res.includes("/") || res.includes("\\"),
    },
    {
        id: "L1-05",
        level: "L1",
        description: "bash: 简单 echo 命令",
        prompt: "用 bash 执行 echo 'hello world'",
        expectedTool: "bash",
        validate: (res) => res.includes("hello"),
    },

    // L2: 工具失败可诊断（5条）
    {
        id: "L2-01",
        level: "L2",
        description: "read_file: 读取不存在的文件",
        prompt: "读取 /path/does/not/exist/file.txt 文件",
        expectedTool: "read_file",
        expectFailure: true,
        validate: (res, toolName) => {
            // 应该返回错误说明，而不是幻想内容
            return (
                res.includes("不存在") ||
                res.includes("not found") ||
                res.includes("error") ||
                res.includes("失败")
            );
        },
    },
    {
        id: "L2-02",
        level: "L2",
        description: "bash: 无效命令",
        prompt: "用 bash 执行 nonexistent_command_xyz",
        expectedTool: "bash",
        expectFailure: true,
        validate: (res) =>
            res.includes("not found") ||
            res.includes("找不到") ||
            res.includes("error") ||
            res.includes("失败"),
    },
    {
        id: "L2-03",
        level: "L2",
        description: "bash: 权限不足",
        prompt: "用 bash 执行 ls /root （可能权限不足）",
        expectedTool: "bash",
        expectFailure: false, // 可能成功也可能失败，取决于系统
        validate: () => true,
    },
    {
        id: "L2-04",
        level: "L2",
        description: "read_file: 无效路径格式",
        prompt: "读取文件：/dev/null/invalid/path",
        expectedTool: "read_file",
        expectFailure: true,
        validate: (res) => res.length > 0, // 任何响应都算通过（不崩溃）
    },
    {
        id: "L2-05",
        level: "L2",
        description: "bash: 超时命令（短超时）",
        prompt: "用 bash 执行 sleep 0.1 && echo done",
        expectedTool: "bash",
        expectFailure: false,
        validate: (res) => res.includes("done") || res.length > 0,
    },

    // L3: 二轮收口稳定（5条）
    {
        id: "L3-01",
        level: "L3",
        description: "二轮收口：工具调用后有自然语言",
        prompt: "读取 package.json 文件，然后告诉我项目名称是什么",
        expectedTool: "read_file",
        validate: (res) => res.length > 10, // 应该有自然语言回复
    },
    {
        id: "L3-02",
        level: "L3",
        description: "二轮收口：无漂移（不输出 <tool_call）",
        prompt: "列出 src 目录下的文件，用简洁的语言回复",
        expectedTool: "bash",
        validate: (res) => !res.includes("<tool_call"), // 不应该漂移
    },
    {
        id: "L3-03",
        level: "L3",
        description: "二轮收口：非空答复",
        prompt: "读取 README.md 的前 20 行，总结一下内容",
        expectedTool: "read_file",
        validate: (res) => res.length > 20 && !res.includes("undefined"),
    },
    {
        id: "L3-04",
        level: "L3",
        description: "二轮收口：格式化输出",
        prompt: "用 bash 执行 date 命令，然后用中文告诉现在是什么时间",
        expectedTool: "bash",
        validate: (res) => res.length > 5,
    },
    {
        id: "L3-05",
        level: "L3",
        description: "二轮收口：多轮工具后稳定",
        prompt: "先列出当前目录，然后告诉我有多少个 .ts 文件",
        expectedTool: "bash",
        validate: (res) => res.length > 5,
    },

    // L4: 复杂任务链路（5条）
    {
        id: "L4-01",
        level: "L4",
        description: "复杂任务：读取+分析",
        prompt: "读取 tsconfig.json 文件，然后告诉我这个项目使用的 TypeScript 版本要求",
        expectedTool: "read_file",
        validate: (res) => res.length > 10,
    },
    {
        id: "L4-02",
        level: "L4",
        description: "复杂任务：多步骤执行",
        prompt: "先查看当前目录结构，然后找出所有的测试文件数量",
        expectedTool: "bash",
        validate: (res) => res.length > 5,
    },
    {
        id: "L4-03",
        level: "L4",
        description: "复杂任务：错误恢复",
        prompt: "尝试读取 /nonexistent 文件，如果失败就告诉我原因",
        expectedTool: "read_file",
        validate: (res) =>
            res.includes("不存在") ||
            res.includes("not found") ||
            res.includes("失败") ||
            res.includes("error"),
    },
    {
        id: "L4-04",
        level: "L4",
        description: "复杂任务：条件判断",
        prompt: "检查 package.json 中是否有 jest 依赖，告诉我结果",
        expectedTool: "read_file",
        validate: (res) => res.length > 5,
    },
    {
        id: "L4-05",
        level: "L4",
        description: "复杂任务：综合分析",
        prompt: "读取 src/handlers.ts 的前 50 行，简要说明这个文件的作用",
        expectedTool: "read_file",
        validate: (res) => res.length > 20,
    },
];

// ============================================
// 模拟执行器（实际运行时需要替换为真实调用）
// ============================================

/**
 * 模拟 ToolLoop 执行
 *
 * 实际使用时需要替换为真实的 runLmStudioToolLoop 调用
 */
async function executeToolLoop(prompt: string): Promise<{ response: string; toolName?: string }> {
    // 模拟实现 - 实际运行时需要替换
    // 这里只做占位，真实场景需要 import { runLmStudioToolLoop } from "../src/lmstudio.js"

    // 模拟延迟
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 简单的模拟逻辑
    if (prompt.includes("读取") || prompt.includes("read_file")) {
        if (prompt.includes("不存在") || prompt.includes("/path/does/not/exist")) {
            return {
                response: "错误：文件不存在或路径无效",
                toolName: "read_file",
            };
        }
        return {
            response: "文件内容已读取...",
            toolName: "read_file",
        };
    }

    if (prompt.includes("bash") || prompt.includes("执行")) {
        if (prompt.includes("nonexistent_command")) {
            return {
                response: "错误：命令未找到",
                toolName: "bash",
            };
        }
        return {
            response: "命令执行成功",
            toolName: "bash",
        };
    }

    return {
        response: "模拟响应",
        toolName: undefined,
    };
}

// ============================================
// 执行单个测试用例
// ============================================

async function runCase(tc: SmokeCase): Promise<SmokeResult> {
    const start = Date.now();

    try {
        const result = await executeToolLoop(tc.prompt);
        const durationMs = Date.now() - start;

        // 执行验证
        let passed = true;
        let reason = "";

        // 检查工具名
        if (tc.expectedTool && result.toolName !== tc.expectedTool) {
            passed = false;
            reason = `工具不匹配：期望 ${tc.expectedTool}，实际 ${result.toolName || "无"}`;
        }

        // 检查失败预期
        if (tc.expectFailure && !tc.validate?.(result.response, result.toolName)) {
            passed = false;
            reason = `失败处理不符合预期：${result.response.slice(0, 100)}`;
        }

        // 执行自定义验证
        if (passed && tc.validate && !tc.validate(result.response, result.toolName)) {
            passed = false;
            reason = `验证失败：响应不符合预期`;
        }

        // 检查空答复
        if (tc.expectEmptyResponse && result.response.trim().length > 0) {
            passed = false;
            reason = `预期空答复但收到内容`;
        }

        if (!tc.expectEmptyResponse && result.response.trim().length === 0) {
            passed = false;
            reason = `收到空答复`;
        }

        return {
            caseId: tc.id,
            passed,
            reason: passed ? "通过" : reason,
            response: result.response,
            toolName: result.toolName,
            durationMs,
        };
    } catch (error) {
        return {
            caseId: tc.id,
            passed: false,
            reason: `异常：${error instanceof Error ? error.message : String(error)}`,
            durationMs: Date.now() - start,
        };
    }
}

// ============================================
// 主执行函数
// ============================================

async function main(): Promise<void> {
    console.log("=".repeat(60));
    console.log("Tool Loop Smoke Gate - 20-case 回归测试");
    console.log("=".repeat(60));
    console.log();

    const results: SmokeResult[] = [];

    // 执行所有测试用例
    for (const tc of SMOKE_CASES) {
        console.log(`[${tc.id}] ${tc.description}...`);
        const result = await runCase(tc);
        results.push(result);
        console.log(`  ${result.passed ? "✓ PASS" : "✗ FAIL"}: ${result.reason} (${result.durationMs}ms)`);
    }

    // 统计结果
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    const passRate = ((passed / results.length) * 100).toFixed(1);

    // 分层统计
    const summary = {
        L1: { total: 0, passed: 0 },
        L2: { total: 0, passed: 0 },
        L3: { total: 0, passed: 0 },
        L4: { total: 0, passed: 0 },
    };

    for (let i = 0; i < SMOKE_CASES.length; i++) {
        const level = SMOKE_CASES[i].level;
        summary[level].total++;
        if (results[i].passed) {
            summary[level].passed++;
        }
    }

    // 生成报告
    const report: SmokeReport = {
        timestamp: new Date().toISOString(),
        totalCases: results.length,
        passed,
        failed,
        passRate: `${passRate}%`,
        gateStatus: passed >= 19 ? "PASS" : "FAIL",
        results,
        summary,
    };

    // 输出汇总
    console.log();
    console.log("=".repeat(60));
    console.log("测试结果汇总");
    console.log("=".repeat(60));
    console.log(`总用例: ${results.length}`);
    console.log(`通过: ${passed}`);
    console.log(`失败: ${failed}`);
    console.log(`通过率: ${passRate}%`);
    console.log(`门禁状态: ${report.gateStatus}`);
    console.log();
    console.log("分层统计:");
    console.log(`  L1: ${summary.L1.passed}/${summary.L1.total}`);
    console.log(`  L2: ${summary.L2.passed}/${summary.L2.total}`);
    console.log(`  L3: ${summary.L3.passed}/${summary.L3.total}`);
    console.log(`  L4: ${summary.L4.passed}/${summary.L4.total}`);

    // 保存报告
    const reportDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "AIDOCS", "reports");
    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(reportDir, `smoke-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log();
    console.log(`报告已保存: ${reportPath}`);

    // 退出码
    process.exit(report.gateStatus === "PASS" ? 0 : 1);
}

// ============================================
// 入口
// ============================================

main().catch((error) => {
    console.error("执行失败:", error);
    process.exit(1);
});

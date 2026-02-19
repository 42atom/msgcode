/**
 * msgcode: P5.6.7 R6b 运行时冒烟测试
 *
 * 在 3 个工作区执行集成冒烟验证
 *
 * Usage: npx tsx scripts/smoke-p5-6-7-r6b.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ============================================
// 配置
// ============================================

const WORKSPACES = [
    "/Users/admin/msgcode-workspaces/medicpass",
    "/Users/admin/msgcode-workspaces/charai",
    "/Users/admin/msgcode-workspaces/game01",
];

interface SmokeResult {
    workspace: string;
    configExists: boolean;
    globalSoulDirExists: boolean;
    workspaceSoulExists: boolean;
    memoryDirExists: boolean;
    errors: string[];
}

// ============================================
// 检查函数
// ============================================

function checkWorkspace(wsPath: string): SmokeResult {
    const name = path.basename(wsPath);
    const result: SmokeResult = {
        workspace: name,
        configExists: false,
        globalSoulDirExists: false,
        workspaceSoulExists: false,
        memoryDirExists: false,
        errors: [],
    };

    // 1. 检查配置文件
    const configPath = path.join(wsPath, ".msgcode/config.json");
    result.configExists = fs.existsSync(configPath);
    if (!result.configExists) {
        result.errors.push(`配置文件不存在: ${configPath}`);
    }

    // 2. 检查全局 SOUL 目录
    const globalSoulDir = path.join(os.homedir(), ".config/msgcode/souls");
    result.globalSoulDirExists = fs.existsSync(globalSoulDir);
    if (!result.globalSoulDirExists) {
        result.errors.push(`全局 SOUL 目录不存在: ${globalSoulDir}`);
    }

    // 3. 检查工作区 SOUL.md 文件
    const workspaceSoul = path.join(wsPath, ".msgcode/SOUL.md");
    result.workspaceSoulExists = fs.existsSync(workspaceSoul);

    // 4. 检查 memory 目录
    const memoryDir = path.join(wsPath, ".msgcode/memory");
    result.memoryDirExists = fs.existsSync(memoryDir);

    return result;
}

function formatResult(r: SmokeResult): string {
    const lines: string[] = [];
    const status = r.errors.length === 0 ? "✅ PASS" : "❌ FAIL";

    lines.push(`\n### ${r.workspace}`);
    lines.push(`状态: ${status}`);
    lines.push(`- 配置文件: ${r.configExists ? "✅" : "❌"}`);
    lines.push(`- 全局 SOUL 目录: ${r.globalSoulDirExists ? "✅" : "❌"}`);
    lines.push(`- 工作区 SOUL.md: ${r.workspaceSoulExists ? "✅" : "不存在"}`);
    lines.push(`- memory 目录: ${r.memoryDirExists ? "✅" : "不存在"}`);

    if (r.errors.length > 0) {
        lines.push(`\n**错误:**`);
        r.errors.forEach((e) => lines.push(`- ${e}`));
    }

    return lines.join("\n");
}

// ============================================
// 主函数
// ============================================

async function main() {
    console.log("# P5.6.7 R6b 运行时冒烟测试\n");
    console.log("执行时间:", new Date().toISOString());
    console.log("\n---\n");

    const results: SmokeResult[] = [];

    for (const ws of WORKSPACES) {
        const result = checkWorkspace(ws);
        results.push(result);
        console.log(formatResult(result));
    }

    // 汇总
    const passCount = results.filter((r) => r.errors.length === 0).length;
    const failCount = results.length - passCount;

    console.log("\n---\n");
    console.log("## 汇总");
    console.log(`- 通过: ${passCount}/${results.length}`);
    console.log(`- 失败: ${failCount}/${results.length}`);

    if (failCount > 0) {
        console.log("\n**失败工作区:**");
        results
            .filter((r) => r.errors.length > 0)
            .forEach((r) => {
                console.log(`- ${r.workspace}`);
            });
        process.exit(1);
    }

    console.log("\n✅ 所有工作区通过冒烟测试");
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * msgcode: R4d 运行时冒烟预检查脚本
 *
 * 自动验证三工作区的静态配置
 *
 * Usage: node scripts/smoke-r4d-precheck.js
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const WORKSPACES = [
    "/Users/admin/msgcode-workspaces/medicpass",
    "/Users/admin/msgcode-workspaces/charai",
    "/Users/admin/msgcode-workspaces/game01",
];

console.log("🔍 R4d 运行时冒烟预检查\n");
console.log(`执行时间: ${new Date().toISOString()}\n`);

const results = [];

for (const wsPath of WORKSPACES) {
    const name = wsPath.split("/").pop() || wsPath;
    const result = {
        name,
        configExists: false,
        soulExists: false,
        soulPath: join(wsPath, ".msgcode", "SOUL.md"),
        memoryDirExists: false,
        piEnabled: null,
        memoryEnabled: null,
        errors: [],
    };

    console.log(`\n### ${name}`);

    // 1. 检查配置文件
    const configPath = join(wsPath, ".msgcode", "config.json");
    result.configExists = existsSync(configPath);

    if (!result.configExists) {
        result.errors.push(`配置文件不存在: ${configPath}`);
        console.log(`❌ 配置文件不存在`);
    } else {
        console.log(`✅ 配置文件存在`);

        // 读取配置
        try {
            const config = JSON.parse(readFileSync(configPath, "utf-8"));
            result.piEnabled = config["pi.enabled"] ?? false;
            result.memoryEnabled = config["memory.inject.enabled"] ?? false;

            console.log(`   - pi.enabled: ${result.piEnabled}`);
            console.log(`   - memory.inject.enabled: ${result.memoryEnabled}`);
        } catch (e) {
            result.errors.push(`配置文件读取失败: ${e}`);
            console.log(`❌ 配置文件读取失败`);
        }
    }

    // 2. 检查 SOUL.md
    result.soulExists = existsSync(result.soulPath);

    if (!result.soulExists) {
        console.log(`⚠️  SOUL.md 不存在（可选）: ${result.soulPath}`);
    } else {
        console.log(`✅ SOUL.md 存在: ${result.soulPath}`);
    }

    // 3. 检查 memory 目录
    const memoryDir = join(wsPath, ".msgcode", "memory");
    result.memoryDirExists = existsSync(memoryDir);

    if (!result.memoryDirExists) {
        console.log(`⚠️  memory 目录不存在（可选）`);
    } else {
        console.log(`✅ memory 目录存在`);
    }

    // 4. 检查全局 SOUL 目录
    const globalSoulDir = join(homedir(), ".config", "msgcode", "souls", "default");
    const globalSoulExists = existsSync(globalSoulDir);

    if (!globalSoulExists) {
        console.log(`⚠️  全局 SOUL 目录不存在`);
    } else {
        console.log(`✅ 全局 SOUL 目录存在`);
    }

    results.push(result);
}

// 汇总
console.log("\n---\n");
console.log("## 汇总\n");

const passCount = results.filter(r => r.errors.length === 0).length;
const failCount = results.length - passCount;

console.log(`通过: ${passCount}/${results.length}`);
console.log(`失败: ${failCount}/${results.length}`);

if (failCount > 0) {
    console.log("\n**失败工作区:**");
    results
        .filter(r => r.errors.length > 0)
        .forEach(r => {
            console.log(`- ${r.name}:`);
            r.errors.forEach(e => console.log(`  - ${e}`));
        });
    process.exit(1);
}

console.log("\n✅ 所有工作区预检查通过");
console.log("\n**下一步**: 执行手工冒烟测试（见 docs/tasks/p5-6-8-r4d-smoke-checklist.md）");

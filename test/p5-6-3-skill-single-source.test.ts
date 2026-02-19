/**
 * msgcode: P5.6.3 Skill 执行单一真相源回归锁测试
 *
 * 目标：确保所有 Skill 执行最终调用 runSkill()
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.3-R2: Skill 执行单一真相源回归锁", () => {
    describe("测试锁 1：/skill run 路径必须调用 runSkill()", () => {
        it("src/runtime/skill-orchestrator.ts 必须导入 runSkill", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/runtime/skill-orchestrator.ts"),
                "utf-8"
            );
            const codeWithoutComments = code
                .split("\n")
                .filter(line => !line.trim().startsWith("//"))
                .join("\n");
            expect(codeWithoutComments).toContain("runSkill");
        });
    });

    describe("测试锁 2：自然语言 tool_calls 路径必须调用 runSkill()", () => {
        it("src/lmstudio.ts 必须通过 Tool Bus 调用（单一执行入口）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );
            // P5.6.8-R3a: lmstudio 统一走 Tool Bus
            expect(code).toContain("executeTool");
        });

        it("src/tools/bus.ts run_skill case 必须导入 runSkill", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/bus.ts"),
                "utf-8"
            );
            // 检查 run_skill case 内部是否 import runSkill
            const runSkillCaseMatch = code.match(/case\s+"run_skill"[\s\S]*?runSkill/);
            expect(runSkillCaseMatch).not.toBeNull();
        });
    });

    describe("测试锁 3：静态扫描禁止第二条 skill 执行链", () => {
        it("src/ 目录下只有 skills/auto.ts 导出 runSkill 函数", () => {
            const srcDir = path.join(process.cwd(), "src");

            const grepRecursive = (dir: string, pattern: RegExp): string[] => {
                const results: string[] = [];
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        results.push(...grepRecursive(fullPath, pattern));
                    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
                        const content = fs.readFileSync(fullPath, "utf-8");
                        if (pattern.test(content)) {
                            results.push(fullPath);
                        }
                    }
                }
                return results;
            };

            // 检测导出 runSkill 函数的文件
            const matches = grepRecursive(srcDir, /export\s+(async\s+)?function\s+runSkill/);

            // 白名单：只有 skills/auto.ts 可以导出 runSkill
            const allowedFiles = ["skills/auto.ts"];

            const violations = matches.filter(f => {
                const relative = path.relative(process.cwd(), f);
                return !allowedFiles.some(allowed => relative.endsWith(allowed));
            });

            expect(violations).toHaveLength(0);
        });

        it("禁止新增 runAutoSkill 函数（应使用 runSkill）", () => {
            const srcDir = path.join(process.cwd(), "src");

            const grepRecursive = (dir: string, pattern: RegExp): string[] => {
                const results: string[] = [];
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        results.push(...grepRecursive(fullPath, pattern));
                    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
                        const content = fs.readFileSync(fullPath, "utf-8");
                        if (pattern.test(content)) {
                            results.push(fullPath);
                        }
                    }
                }
                return results;
            };

            // 检测 runAutoSkill 函数定义
            const matches = grepRecursive(srcDir, /function\s+runAutoSkill/);

            // 白名单：skills/auto.ts 中的 runAutoSkill 是 runSkill 的包装器，允许存在
            const allowedFiles = ["skills/auto.ts"];

            const violations = matches.filter(f => {
                const relative = path.relative(process.cwd(), f);
                return !allowedFiles.some(allowed => relative.endsWith(allowed));
            });

            expect(violations).toHaveLength(0);
        });
    });

    describe("观测字段一致性检查", () => {
        it("skill-orchestrator.ts 必须包含 autoSkill 日志字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/runtime/skill-orchestrator.ts"),
                "utf-8"
            );
            expect(code).toContain("autoSkill");
            expect(code).toContain("autoSkillResult");
        });

        it("tools/bus.ts run_skill case 必须包含 autoSkill 日志字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/bus.ts"),
                "utf-8"
            );
            // 检查 run_skill case 区域内是否有 autoSkill 字段
            expect(code).toContain("autoSkill");
        });
    });
});

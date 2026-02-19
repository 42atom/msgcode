/**
 * msgcode: P5.6.8-R3e 硬切割回归锁测试
 *
 * 目标：确保 /skill run、run_skill、旧工具名不在主链暴露
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.8-R3e: 硬切割回归锁", () => {
    describe("/skill run 命令面删除验证", () => {
        it("src/runtime/skill-orchestrator.ts 不应导出 handleSkillRunCommand", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/runtime/skill-orchestrator.ts"),
                "utf-8"
            );

            expect(code).not.toContain("export async function handleSkillRunCommand");
        });

        it("src/handlers.ts 不应调用 handleSkillRunCommand", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            expect(code).not.toContain("handleSkillRunCommand");
            expect(code).not.toContain("skill.handleSkillRunCommand");
        });

        it("src/handlers.ts 不应导入 skill-orchestrator", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            // handlers.ts 不应导入 skill 模块
            expect(code).not.toContain('import * as skill from "./runtime/skill-orchestrator"');
            expect(code).not.toContain('import { handleSkillRunCommand }');
        });
    });

    describe("旧工具名清理验证", () => {
        it("src/lmstudio.ts 不应包含 list_directory", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 不应在工具定义中出现
            expect(code).not.toContain('name: "list_directory"');
            expect(code).not.toContain('case "list_directory"');
        });

        it("src/lmstudio.ts 不应包含 read_text_file", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 不应在工具定义中出现
            expect(code).not.toContain('name: "read_text_file"');
            expect(code).not.toContain('case "read_text_file"');
        });

        it("src/lmstudio.ts 不应包含 append_text_file", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 不应在工具定义中出现
            expect(code).not.toContain('name: "append_text_file"');
            expect(code).not.toContain('case "append_text_file"');
        });

        it("src/routes/ 不应包含旧工具名", () => {
            const routesDir = path.join(process.cwd(), "src/routes");

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

            // 检测旧工具名
            const matches = grepRecursive(routesDir, /list_directory|read_text_file|append_text_file/);
            expect(matches).toHaveLength(0);
        });
    });

    describe("run_skill 不暴露验证", () => {
        it("src/lmstudio.ts PI_ON_TOOLS 不应包含 run_skill", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // PI_ON_TOOLS 不应包含 run_skill
            const piOnToolsMatch = code.match(/const PI_ON_TOOLS[\s\S]{0,2000}/);
            expect(piOnToolsMatch).not.toBeNull();
            expect(piOnToolsMatch![0]).not.toContain('name: "run_skill"');
        });

        it("src/routes/ 不应包含 run_skill 工具调用", () => {
            const routesDir = path.join(process.cwd(), "src/routes");

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

            // 检测 run_skill 工具调用（排除注释）
            const matches = grepRecursive(routesDir, /name:\s*"run_skill"|case\s+"run_skill"/);
            expect(matches).toHaveLength(0);
        });
    });

    describe("PI 四工具验证", () => {
        it("src/lmstudio.ts PI_ON_TOOLS 必须仅包含四工具", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 必须包含四工具
            expect(code).toContain('name: "read_file"');
            expect(code).toContain('name: "write_file"');
            expect(code).toContain('name: "edit_file"');
            expect(code).toContain('name: "bash"');
        });

        it("Tool Bus 必须实现四工具", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/bus.ts"),
                "utf-8"
            );

            // 必须包含四工具实现
            expect(code).toContain('case "read_file"');
            expect(code).toContain('case "write_file"');
            expect(code).toContain('case "edit_file"');
            expect(code).toContain('case "bash"');
        });
    });

    describe("全局扫描（排除任务文档）", () => {
        it("主链文件不应包含 /skill run 命令", () => {
            const mainFiles = [
                "src/handlers.ts",
                "src/lmstudio.ts",
                "src/runtime/skill-orchestrator.ts"
            ];

            for (const file of mainFiles) {
                const code = fs.readFileSync(
                    path.join(process.cwd(), file),
                    "utf-8"
                );

                // 排除注释和字符串中的说明文字
                const codeWithoutComments = code
                    .split("\n")
                    .filter(line => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
                    .join("\n");

                // 不应包含 /skill run 的实际实现
                expect(codeWithoutComments).not.toContain('parts[1] === "run"');
                expect(codeWithoutComments).not.toContain('/skill run <skillId>');
            }
        });
    });
});

// P5.6.13-R1A-EXEC: 静态锁 - 禁止 run_skill 回归
// 验收口径：run_skill 在可执行代码路径必须为 0；测试断言与退役注释可保留
describe("run_skill 硬退场静态锁", () => {
    // 工具函数：递归搜索文件
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

    it("src/tools/ 不应包含 case \"run_skill\"", () => {
        const toolsDir = path.join(process.cwd(), "src/tools");
        const matches = grepRecursive(toolsDir, /case\s+"run_skill"/);
        expect(matches.length).toBe(0);
    });

    it("src/tools/types.ts 不应包含 ToolName = \"run_skill\"", () => {
        const code = fs.readFileSync(path.join(process.cwd(), "src/tools/types.ts"), "utf-8");
        // 允许注释中包含 run_skill，但不允许类型定义中包含
        const typeDefMatch = code.match(/type\s+ToolName\s*=\s*[\s\S]*?;\s*\n/);
        if (typeDefMatch) {
            expect(typeDefMatch[0]).not.toContain('"run_skill"');
        }
    });
});

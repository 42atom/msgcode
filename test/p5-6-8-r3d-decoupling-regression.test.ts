/**
 * msgcode: P5.6.8-R3d 彻底去耦回归锁测试
 *
 * P5.6.9-R4: 更新过期断言（/skill run 已在 R3e 硬切删除）
 *
 * 目标：确保主链不依赖 run_skill 与专用 skill orchestrator
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.8-R3d: 彻底去耦回归锁", () => {
    describe("主链不应直接调用 run_skill", () => {
        it("src/handlers.ts 不应包含 run_skill 工具调用", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            // handlers.ts 应通过 executeTool 调用工具，不直接调用
            expect(code).not.toContain('name: "run_skill"');
            expect(code).not.toContain('case "run_skill"');
        });

        it("src/lmstudio.ts 不应包含 run_skill case", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // lmstudio.ts 不应有 run_skill 的 switch case
            expect(code).not.toContain('case "run_skill"');
        });

        it("src/lmstudio.ts 不应特殊处理 run_skill 日志", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 不应有 run_skill 的特殊日志处理
            expect(code).not.toContain("const isSkillCall = tc?.function.name === \"run_skill\"");
        });
    });

    describe("PI 模式验证", () => {
        it("pi.on 必须仅暴露四工具", async () => {
            const { getToolsForLlm } = await import("../src/lmstudio.js");

            // 创建临时工作区
            const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "msgcode-ws-"));
            const msgcodeDir = path.join(tmpDir, ".msgcode");
            fs.mkdirSync(msgcodeDir, { recursive: true });
            fs.writeFileSync(
                path.join(msgcodeDir, "config.json"),
                JSON.stringify({ "pi.enabled": true }),
                "utf-8"
            );

            try {
                const tools = await getToolsForLlm(tmpDir);
                const toolNames = tools.map(t => t.function.name);

                expect(toolNames).toHaveLength(4);
                expect(toolNames).toContain("read_file");
                expect(toolNames).toContain("write_file");
                expect(toolNames).toContain("edit_file");
                expect(toolNames).toContain("bash");

                // 确保不包含 run_skill
                expect(toolNames).not.toContain("run_skill");
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        it("pi.off 必须返回空数组", async () => {
            const { getToolsForLlm } = await import("../src/lmstudio.js");

            // 创建临时工作区
            const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "msgcode-ws-"));
            const msgcodeDir = path.join(tmpDir, ".msgcode");
            fs.mkdirSync(msgcodeDir, { recursive: true });
            fs.writeFileSync(
                path.join(msgcodeDir, "config.json"),
                JSON.stringify({ "pi.enabled": false }),
                "utf-8"
            );

            try {
                const tools = await getToolsForLlm(tmpDir);
                expect(tools).toHaveLength(0);
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    describe("单一执行入口验证", () => {
        it("src/lmstudio.ts 必须通过 executeTool 调用工具", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 必须导入 executeTool
            expect(code).toContain("const { executeTool } = await import");

            // runTool 函数必须调用 executeTool
            const runToolMatch = code.match(/async function runTool[\s\S]{0,500}/);
            expect(runToolMatch).not.toBeNull();
            expect(runToolMatch![0]).toContain("await executeTool");
        });

        it("src/tools/bus.ts 必须是工具执行的唯一真相源", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/bus.ts"),
                "utf-8"
            );

            // 必须导出 executeTool 函数
            expect(code).toContain("export async function executeTool");

            // 必须包含四基础工具的实现
            expect(code).toContain('case "read_file"');
            expect(code).toContain('case "write_file"');
            expect(code).toContain('case "edit_file"');
            expect(code).toContain('case "bash"');
        });
    });
});

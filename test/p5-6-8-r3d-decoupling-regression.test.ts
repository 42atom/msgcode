/**
 * msgcode: P5.6.8-R3d 彻底去耦回归锁测试
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

            // handlers.ts 可以调用 handleSkillRunCommand（/skill run 命令）
            // 但不应直接调用 run_skill 工具（通过 executeTool）
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

    describe("/skill run 降级为调试入口", () => {
        it("src/runtime/skill-orchestrator.ts 必须检查 MSGCODE_DEV_MODE", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/runtime/skill-orchestrator.ts"),
                "utf-8"
            );

            // 必须有开发模式检查
            expect(code).toContain("MSGCODE_DEV_MODE");
            expect(code).toContain('process.env.MSGCODE_DEV_MODE !== "true"');
        });

        it("非开发模式下 /skill run 必须返回错误", async () => {
            // 模拟非开发模式
            const originalDevMode = process.env.MSGCODE_DEV_MODE;
            delete process.env.MSGCODE_DEV_MODE;

            try {
                const { handleSkillRunCommand } = await import("../src/runtime/skill-orchestrator.js");

                const result = await handleSkillRunCommand("/skill run test", {
                    workspacePath: "/tmp"
                });

                expect(result).not.toBeNull();
                expect(result?.success).toBe(false);
                expect(result?.response).toContain("仅在开发模式下可用");
            } finally {
                // 恢复环境变量
                if (originalDevMode !== undefined) {
                    process.env.MSGCODE_DEV_MODE = originalDevMode;
                }
            }
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

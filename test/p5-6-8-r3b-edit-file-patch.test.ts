/**
 * msgcode: P5.6.8-R3b edit_file 补丁语义回归锁测试
 *
 * 目标：确保 edit_file 工具使用补丁语义（禁止整文件覆盖）
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("P5.6.8-R3b: edit_file 补丁语义回归锁", () => {
    describe("静态验证", () => {
        it("tools/handlers.ts 必须包含 edit_file case", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/handlers.ts"),
                "utf-8"
            );
            expect(code).toContain('case "edit_file"');
        });

        it("edit_file 必须通过 registry 归一化为 oldText/newText 补丁模式", () => {
            const handlersCode = fs.readFileSync(
                path.join(process.cwd(), "src/tools/handlers.ts"),
                "utf-8"
            );
            const registryCode = fs.readFileSync(
                path.join(process.cwd(), "src/tools/registry.ts"),
                "utf-8"
            );
            expect(handlersCode).toContain("runEditFileTool");
            expect(handlersCode).toContain("const edits = Array.isArray(args.edits) ? args.edits : []");
            expect(registryCode).toContain("normalizeEditFileEditsInput");
            expect(registryCode).toContain("oldText");
            expect(registryCode).toContain("newText");
            expect(registryCode).toContain("args.edits = edits");
        });

        it("edit_file 必须在 registry 中验证 oldText/newText 类型", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/registry.ts"),
                "utf-8"
            );
            expect(code).toContain("typeof edit.oldText !== \"string\"");
            expect(code).toContain("typeof edit.newText !== \"string\"");
        });
    });

    describe("运行时验证", () => {
        it("edit_file 执行成功：应用补丁", async () => {
            const { executeTool } = await import("../src/tools/bus.js");

            // 创建临时测试文件
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-test-"));
            const testFile = path.join(tmpDir, "test.txt");
            fs.writeFileSync(testFile, "Hello World\nThis is a test\nGoodbye World", "utf-8");

            // 配置 tooling.allow 包含四基础工具
            const msgcodeDir = path.join(tmpDir, ".msgcode");
            fs.mkdirSync(msgcodeDir, { recursive: true });
            fs.writeFileSync(
                path.join(msgcodeDir, "config.json"),
                JSON.stringify({
                    "tooling.mode": "autonomous",
                    "tooling.allow": ["read_file", "write_file", "edit_file", "bash"]
                }),
                "utf-8"
            );

            try {
                const result = await executeTool("edit_file", {
                    path: testFile,
                    edits: [
                        { oldText: "Hello World", newText: "Hi There" },
                        { oldText: "Goodbye World", newText: "See You" }
                    ]
                }, {
                    workspacePath: tmpDir,
                    source: "slash-command",
                    requestId: "test-1"
                });

                expect(result.ok).toBe(true);
                expect(result.data?.editsApplied).toBe(2);

                // 验证文件内容已修改
                const content = fs.readFileSync(testFile, "utf-8");
                expect(content).toContain("Hi There");
                expect(content).toContain("See You");
                expect(content).not.toContain("Hello World");
                expect(content).not.toContain("Goodbye World");
            } finally {
                // 清理临时文件
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        it("edit_file 应兼容 oldText/newText 简写参数", async () => {
            const { executeTool } = await import("../src/tools/bus.js");

            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-test-"));
            const testFile = path.join(tmpDir, "test.txt");
            fs.writeFileSync(testFile, "alpha\nbeta\n", "utf-8");

            const msgcodeDir = path.join(tmpDir, ".msgcode");
            fs.mkdirSync(msgcodeDir, { recursive: true });
            fs.writeFileSync(
                path.join(msgcodeDir, "config.json"),
                JSON.stringify({
                    "tooling.mode": "autonomous",
                    "tooling.allow": ["read_file", "write_file", "edit_file", "bash"]
                }),
                "utf-8"
            );

            try {
                const result = await executeTool("edit_file", {
                    path: testFile,
                    oldText: "alpha",
                    newText: "gamma",
                }, {
                    workspacePath: tmpDir,
                    source: "slash-command",
                    requestId: "test-shorthand-edit"
                });

                expect(result.ok).toBe(true);
                expect(result.data?.editsApplied).toBe(1);
                const content = fs.readFileSync(testFile, "utf-8");
                expect(content).toContain("gamma");
                expect(content).not.toContain("alpha");
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        it("edit_file 执行失败：oldText 不存在", async () => {
            const { executeTool } = await import("../src/tools/bus.js");

            // 创建临时测试文件
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-test-"));
            const testFile = path.join(tmpDir, "test.txt");
            fs.writeFileSync(testFile, "Hello World", "utf-8");

            // 配置 tooling.allow 包含四基础工具
            const msgcodeDir = path.join(tmpDir, ".msgcode");
            fs.mkdirSync(msgcodeDir, { recursive: true });
            fs.writeFileSync(
                path.join(msgcodeDir, "config.json"),
                JSON.stringify({
                    "tooling.mode": "autonomous",
                    "tooling.allow": ["read_file", "write_file", "edit_file", "bash"]
                }),
                "utf-8"
            );

            try {
                const result = await executeTool("edit_file", {
                    path: testFile,
                    edits: [
                        { oldText: "NonExistent", newText: "New" }
                    ]
                }, {
                    workspacePath: tmpDir,
                    source: "slash-command",
                    requestId: "test-2"
                });

                expect(result.ok).toBe(false);
                expect(result.error?.code).toBe("TOOL_EXEC_FAILED");
                expect(result.error?.message).toContain("oldText not found");
            } finally {
                // 清理临时文件
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    describe("工具暴露验证", () => {
        it("agent-backend/types.ts 不应再导出历史硬编码工具白名单", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/agent-backend/types.ts"),
                "utf-8"
            );

            expect(code).not.toContain("export const PI_ON_TOOLS");
            expect(code).not.toContain('name: "run_skill"');
        });

        it("getToolsForLlm 在未显式 allow 时应返回当前默认工具面", async () => {
            const { getToolsForLlm } = await import("../src/lmstudio.js");

            // 创建临时工作区
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-ws-"));
            const msgcodeDir = path.join(tmpDir, ".msgcode");
            fs.mkdirSync(msgcodeDir, { recursive: true });
            fs.writeFileSync(
                path.join(msgcodeDir, "config.json"),
                JSON.stringify({}),
                "utf-8"
            );

            try {
                const tools = await getToolsForLlm(tmpDir);
                const toolNames = tools as string[];
                expect(toolNames).toContain("read_file");
                expect(toolNames).toContain("write_file");
                expect(toolNames).toContain("edit_file");
                expect(toolNames).toContain("bash");
                expect(toolNames).toContain("help_docs");
                expect(toolNames).toContain("vision");
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        it("getToolsForLlm 不应再因缺省配置而被清空", async () => {
            const { getToolsForLlm } = await import("../src/lmstudio.js");

            // 创建临时工作区
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-ws-"));
            const msgcodeDir = path.join(tmpDir, ".msgcode");
            fs.mkdirSync(msgcodeDir, { recursive: true });
            fs.writeFileSync(
                path.join(msgcodeDir, "config.json"),
                JSON.stringify({}),
                "utf-8"
            );

            try {
                const tools = await getToolsForLlm(tmpDir);
                const toolNames = tools as string[];
                expect(toolNames).toContain("read_file");
                expect(toolNames).toContain("write_file");
                expect(toolNames).toContain("edit_file");
                expect(toolNames).toContain("bash");
                expect(toolNames).toContain("help_docs");
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });
});

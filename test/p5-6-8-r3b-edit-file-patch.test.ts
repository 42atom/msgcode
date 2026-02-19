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
        it("tools/bus.ts 必须包含 edit_file case", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/bus.ts"),
                "utf-8"
            );
            expect(code).toContain('case "edit_file"');
        });

        it("edit_file 必须使用 oldText/newText 补丁模式", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/bus.ts"),
                "utf-8"
            );
            // 验证补丁语义
            expect(code).toContain("oldText");
            expect(code).toContain("newText");
            expect(code).toContain("edits");
        });

        it("edit_file 必须验证 oldText 存在", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/bus.ts"),
                "utf-8"
            );
            // 验证 oldText 存在性检查
            const editFileCase = code.match(/case\s+"edit_file"[\s\S]{0,2000}break;/);
            expect(editFileCase).not.toBeNull();
            expect(editFileCase![0]).toContain("includes(edit.oldText)");
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
        it("lmstudio.ts PI_ON_TOOLS 必须仅包含四工具", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );

            // 验证四工具存在
            expect(code).toContain('name: "read_file"');
            expect(code).toContain('name: "write_file"');
            expect(code).toContain('name: "edit_file"');
            expect(code).toContain('name: "bash"');

            // 验证旧工具已移除
            expect(code).not.toContain('name: "list_directory"');
            expect(code).not.toContain('name: "read_text_file"');
            expect(code).not.toContain('name: "append_text_file"');
            expect(code).not.toContain('name: "run_skill"');
        });

        it("getToolsForLlm pi.on 返回四工具", async () => {
            const { getToolsForLlm } = await import("../src/lmstudio.js");

            // 创建临时工作区
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-ws-"));
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
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        it("getToolsForLlm pi.off 返回空数组", async () => {
            const { getToolsForLlm } = await import("../src/lmstudio.js");

            // 创建临时工作区
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-ws-"));
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
});

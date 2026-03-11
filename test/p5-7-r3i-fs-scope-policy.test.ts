/**
 * msgcode: P5.7-R3i 文件权限策略分层回归锁测试
 *
 * 目标：
 * - workspace 模式越界拒绝测试
 * - unrestricted 模式绝对路径通过测试
 * - 两模式切换一致性测试
 */

import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../src/tools/bus.js";

describe("P5.7-R3i: File Scope Policy", () => {
    describe("配置扩展", () => {
        it("WorkspaceConfig 应该包含 fs_scope 字段", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/config/workspace.ts", "utf-8");

            expect(code).toContain('"tooling.fs_scope"');
            expect(code).toContain("FsScope");
        });

        it("FsScope 类型应该包含 workspace 和 unrestricted", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/config/workspace.ts", "utf-8");

            expect(code).toContain('"workspace" | "unrestricted"');
        });

        it("应该导出 getFsScope 和 setFsScope 函数", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/config/workspace.ts", "utf-8");

            expect(code).toContain("export async function getFsScope");
            expect(code).toContain("export async function setFsScope");
        });
    });

    describe("策略接线", () => {
        it("bus.ts 应该导入 getFsScope", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/tools/bus.ts", "utf-8");

            expect(code).toContain("getFsScope");
        });

        it("read_file 应该应用 fs_scope 策略", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/tools/bus.ts", "utf-8");

            expect(code).toContain("case \"read_file\"");
            expect(code).toContain("const fsScope = await getFsScope");
            expect(code).toContain("fsScope === \"workspace\"");
        });

        it("write_file 应该应用 fs_scope 策略", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/tools/bus.ts", "utf-8");

            expect(code).toContain("case \"write_file\"");
            expect(code).toContain("const fsScope = await getFsScope");
            expect(code).toContain("fsScope === \"workspace\"");
        });

        it("edit_file 应该应用 fs_scope 策略", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/tools/bus.ts", "utf-8");

            expect(code).toContain("case \"edit_file\"");
            expect(code).toContain("const fsScope = await getFsScope");
            expect(code).toContain("fsScope === \"workspace\"");
        });
    });

    describe("观测字段", () => {
        it("失败日志应该包含 fsScope 字段", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/tools/bus.ts", "utf-8");

            expect(code).toContain("fsScope");
            expect(code).toContain("File tool path denied by fs_scope policy");
        });

        it("失败日志应该包含 inputPath 和 resolvedPath", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/tools/bus.ts", "utf-8");

            expect(code).toContain("inputPath");
            expect(code).toContain("resolvedPath");
        });
    });

    describe("集成测试", () => {
        it("getFsScope 应该返回默认值 unrestricted", async () => {
            const { getFsScope } = await import("../src/config/workspace.js");

            const tmpDir = await mkdtemp(join(tmpdir(), "r3i-test-"));
            try {
                const scope = await getFsScope(tmpDir);
                expect(scope).toBe("unrestricted");
            } finally {
                await rm(tmpDir, { recursive: true, force: true });
            }
        });

        it("setFsScope 应该能写入 unrestricted", async () => {
            const { getFsScope, setFsScope } = await import("../src/config/workspace.js");

            const tmpDir = await mkdtemp(join(tmpdir(), "r3i-test-"));
            try {
                await setFsScope(tmpDir, "unrestricted");
                const scope = await getFsScope(tmpDir);
                expect(scope).toBe("unrestricted");
            } finally {
                await rm(tmpDir, { recursive: true, force: true });
            }
        });

        it("DEFAULT_WORKSPACE_CONFIG 应该包含 fs_scope 默认值", () => {
            const fs = require("node:fs");
            const code = fs.readFileSync("src/config/workspace.ts", "utf-8");

            expect(code).toContain('"tooling.fs_scope": "unrestricted"');
        });

        it("setFsScope 写入 workspace 后，getFsScope 应返回 workspace", async () => {
            const { getFsScope, setFsScope } = await import("../src/config/workspace.js");

            const tmpDir = await mkdtemp(join(tmpdir(), "r3i-test-"));
            try {
                await setFsScope(tmpDir, "workspace");
                const scope = await getFsScope(tmpDir);
                expect(scope).toBe("workspace");
            } finally {
                await rm(tmpDir, { recursive: true, force: true });
            }
        });

        it("workspace 模式应拒绝 read_file 越界绝对路径", async () => {
            const { setFsScope } = await import("../src/config/workspace.js");

            const workspacePath = await mkdtemp(join(tmpdir(), "r3i-ws-read-"));
            const outsideDir = await mkdtemp(join(tmpdir(), "r3i-outside-read-"));
            const outsideFile = join(outsideDir, "outside.txt");
            await writeFile(outsideFile, "outside-content", "utf-8");

            try {
                await setFsScope(workspacePath, "workspace");
                const result = await executeTool("read_file", { path: outsideFile }, {
                    workspacePath,
                    source: "slash-command",
                    requestId: "r3i-read-deny",
                });

                expect(result.ok).toBe(false);
                expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
                expect(result.error?.message).toContain("path must be under workspace");
            } finally {
                await rm(workspacePath, { recursive: true, force: true });
                await rm(outsideDir, { recursive: true, force: true });
            }
        });

        it("workspace 模式应拒绝 write_file 越界绝对路径", async () => {
            const { setFsScope, setToolingAllow } = await import("../src/config/workspace.js");

            const workspacePath = await mkdtemp(join(tmpdir(), "r3i-ws-write-"));
            const outsideDir = await mkdtemp(join(tmpdir(), "r3i-outside-write-"));
            const outsideFile = join(outsideDir, "outside.txt");

            try {
                await setFsScope(workspacePath, "workspace");
                await setToolingAllow(workspacePath, ["write_file"]);
                const result = await executeTool("write_file", { path: outsideFile, content: "blocked" }, {
                    workspacePath,
                    source: "slash-command",
                    requestId: "r3i-write-deny",
                });

                expect(result.ok).toBe(false);
                expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
                expect(result.error?.message).toContain("path must be under workspace");
            } finally {
                await rm(workspacePath, { recursive: true, force: true });
                await rm(outsideDir, { recursive: true, force: true });
            }
        });

        it("workspace 模式应拒绝 edit_file 越界绝对路径", async () => {
            const { setFsScope, setToolingAllow } = await import("../src/config/workspace.js");

            const workspacePath = await mkdtemp(join(tmpdir(), "r3i-ws-edit-"));
            const outsideDir = await mkdtemp(join(tmpdir(), "r3i-outside-edit-"));
            const outsideFile = join(outsideDir, "outside.txt");
            await writeFile(outsideFile, "alpha", "utf-8");

            try {
                await setFsScope(workspacePath, "workspace");
                await setToolingAllow(workspacePath, ["edit_file"]);
                const result = await executeTool("edit_file", {
                    path: outsideFile,
                    oldText: "alpha",
                    newText: "beta",
                }, {
                    workspacePath,
                    source: "slash-command",
                    requestId: "r3i-edit-deny",
                });

                expect(result.ok).toBe(false);
                expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
                expect(result.error?.message).toContain("path must be under workspace");
            } finally {
                await rm(workspacePath, { recursive: true, force: true });
                await rm(outsideDir, { recursive: true, force: true });
            }
        });

        it("unrestricted 模式应允许 read_file 读取越界绝对路径", async () => {
            const { setFsScope } = await import("../src/config/workspace.js");

            const workspacePath = await mkdtemp(join(tmpdir(), "r3i-ws-read-open-"));
            const outsideDir = await mkdtemp(join(tmpdir(), "r3i-outside-read-open-"));
            const outsideFile = join(outsideDir, "outside.txt");
            await writeFile(outsideFile, "outside-content", "utf-8");

            try {
                await setFsScope(workspacePath, "unrestricted");
                const result = await executeTool("read_file", { path: outsideFile }, {
                    workspacePath,
                    source: "slash-command",
                    requestId: "r3i-read-allow",
                });

                expect(result.ok).toBe(true);
                expect(result.data?.content).toBe("outside-content");
            } finally {
                await rm(workspacePath, { recursive: true, force: true });
                await rm(outsideDir, { recursive: true, force: true });
            }
        });

        it("workspace 模式不应把前缀碰撞路径误判为工作区内", async () => {
            const { setFsScope } = await import("../src/config/workspace.js");

            const workspacePath = await mkdtemp(join(tmpdir(), "r3i-prefix-ws-"));
            const outsideDir = `${workspacePath}-evil`;
            await mkdir(outsideDir, { recursive: true });
            const outsideFile = join(outsideDir, "outside.txt");
            await writeFile(outsideFile, "evil", "utf-8");

            try {
                await setFsScope(workspacePath, "workspace");
                const result = await executeTool("read_file", { path: outsideFile }, {
                    workspacePath,
                    source: "slash-command",
                    requestId: "r3i-prefix-collision",
                });

                expect(result.ok).toBe(false);
                expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
            } finally {
                await rm(workspacePath, { recursive: true, force: true });
                await rm(outsideDir, { recursive: true, force: true });
            }
        });

        it("workspace 模式应允许 workspace 内相对路径写入", async () => {
            const { setFsScope, setToolingAllow } = await import("../src/config/workspace.js");

            const workspacePath = await mkdtemp(join(tmpdir(), "r3i-ws-write-inside-"));
            const targetPath = join(workspacePath, "nested", "file.txt");

            try {
                await setFsScope(workspacePath, "workspace");
                await setToolingAllow(workspacePath, ["write_file"]);
                const writeResult = await executeTool("write_file", {
                    path: "nested/file.txt",
                    content: "inside",
                }, {
                    workspacePath,
                    source: "slash-command",
                    requestId: "r3i-write-inside",
                });

                expect(writeResult.ok).toBe(true);
                expect(await readFile(targetPath, "utf-8")).toBe("inside");
            } finally {
                await rm(workspacePath, { recursive: true, force: true });
            }
        });
    });
});

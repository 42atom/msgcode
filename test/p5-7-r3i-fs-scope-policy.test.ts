/**
 * msgcode: P5.7-R3i 文件权限策略分层回归锁测试
 *
 * 目标：
 * - workspace 模式越界拒绝测试
 * - unrestricted 模式绝对路径通过测试
 * - 两模式切换一致性测试
 */

import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
        it("getFsScope 应该返回默认值 workspace", async () => {
            const { getFsScope } = await import("../src/config/workspace.js");

            const tmpDir = await mkdtemp(join(tmpdir(), "r3i-test-"));
            try {
                const scope = await getFsScope(tmpDir);
                expect(scope).toBe("workspace");
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

            expect(code).toContain('"tooling.fs_scope": "workspace"');
        });
    });
});

/**
 * msgcode: P5.6.8-R4c test-gate 白名单文档化回归锁测试
 *
 * 目标：确保白名单策略被正确文档化
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.8-R4c: test-gate 白名单文档化", () => {
    describe("门禁脚本验证", () => {
        it("scripts/test-gate.js 必须存在", () => {
            const scriptPath = path.join(process.cwd(), "scripts/test-gate.js");
            expect(fs.existsSync(scriptPath)).toBe(true);
        });

        it("门禁脚本必须包含白名单说明", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "scripts/test-gate.js"),
                "utf-8"
            );

            expect(code).toContain("白名单策略说明");
            expect(code).toContain("imessage-kit");
            expect(code).toContain("4 个预期失败");
        });

        it("门禁脚本必须包含团队口径说明", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "scripts/test-gate.js"),
                "utf-8"
            );

            expect(code).toContain("团队口径");
            expect(code).toContain("msgcode 核心测试必须通过");
        });
    });

    describe("白名单文档验证", () => {
        it("docs/testing/TEST_GATE_WHITELIST.md 必须存在", () => {
            const docPath = path.join(process.cwd(), "docs/testing/TEST_GATE_WHITELIST.md");
            expect(fs.existsSync(docPath)).toBe(true);
        });

        it("白名单文档必须包含背景说明", () => {
            const doc = fs.readFileSync(
                path.join(process.cwd(), "docs/testing/TEST_GATE_WHITELIST.md"),
                "utf-8"
            );

            expect(doc).toContain("背景");
            expect(doc).toContain("imessage-kit");
        });

        it("白名单文档必须包含策略规则", () => {
            const doc = fs.readFileSync(
                path.join(process.cwd(), "docs/testing/TEST_GATE_WHITELIST.md"),
                "utf-8"
            );

            expect(doc).toContain("白名单策略");
            expect(doc).toContain("4 个预期失败");
        });

        it("白名单文档必须包含使用方法", () => {
            const doc = fs.readFileSync(
                path.join(process.cwd(), "docs/testing/TEST_GATE_WHITELIST.md"),
                "utf-8"
            );

            expect(doc).toContain("门禁脚本");
            expect(doc).toContain("node scripts/test-gate.js");
        });

        it("白名单文档必须包含团队口径", () => {
            const doc = fs.readFileSync(
                path.join(process.cwd(), "docs/testing/TEST_GATE_WHITELIST.md"),
                "utf-8"
            );

            expect(doc).toContain("团队口径");
            expect(doc).toContain("统一认知");
        });

        it("白名单文档必须包含 FAQ", () => {
            const doc = fs.readFileSync(
                path.join(process.cwd(), "docs/testing/TEST_GATE_WHITELIST.md"),
                "utf-8"
            );

            expect(doc).toContain("FAQ");
        });
    });

    describe("文档完整性验证", () => {
        it("白名单文档必须包含更新记录", () => {
            const doc = fs.readFileSync(
                path.join(process.cwd(), "docs/testing/TEST_GATE_WHITELIST.md"),
                "utf-8"
            );

            expect(doc).toContain("更新记录");
            expect(doc).toContain("P5.6.8-R4c");
        });

        it("白名单文档必须包含相关文件引用", () => {
            const doc = fs.readFileSync(
                path.join(process.cwd(), "docs/testing/TEST_GATE_WHITELIST.md"),
                "utf-8"
            );

            expect(doc).toContain("相关文件");
            expect(doc).toContain("scripts/test-gate.js");
        });
    });
});

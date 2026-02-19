/**
 * msgcode: P5.6.4 状态边界回归锁测试
 *
 * 目标：确保 /clear 边界化正确
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.4-R3: 状态边界回归锁", () => {
    describe("R1: 状态边界定义检查", () => {
        it("src/session-window.ts 必须定义 loadWindow/appendWindow/clearWindow", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/session-window.ts"),
                "utf-8"
            );
            expect(code).toContain("export async function loadWindow");
            expect(code).toContain("export async function appendWindow");
            expect(code).toContain("export async function clearWindow");
        });

        it("session artifacts 清理函数必须存在", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/session-artifacts.ts"),
                "utf-8"
            );
            expect(code).toContain("clearSessionArtifacts");
        });
    });

    describe("R2: /clear 边界化检查", () => {
        it("clearSession 必须调用 clearSessionArtifacts", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/runtime/session-orchestrator.ts"),
                "utf-8"
            );
            // 检查 clearSession 函数中调用了 clearSessionArtifacts
            expect(code).toContain("clearSessionArtifacts(ctx.projectDir, ctx.chatId)");
        });

        it("/clear 必须清理 window（短期窗口）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/session-artifacts.ts"),
                "utf-8"
            );
            // clearSessionArtifacts 必须清理 window
            expect(code).toMatch(/clearWindow|window.*clear|session.*clear/i);
        });

        it("/clear 必须清理 summary（会话摘要）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/session-artifacts.ts"),
                "utf-8"
            );
            // clearSessionArtifacts 必须清理 summary
            expect(code).toMatch(/clearSummary|summary.*clear/i);
        });

        it("memory 目录路径必须独立于 session 目录", () => {
            // memory 在 workspace/memory/
            // session 在 workspace/.msgcode/sessions/
            const memoryPath = path.join(process.cwd(), "src/memory");
            const sessionPath = path.join(process.cwd(), "src/session-window.ts");

            expect(fs.existsSync(memoryPath) || fs.existsSync(path.join(process.cwd(), "src/cli/memory.ts"))).toBe(true);
            expect(fs.existsSync(sessionPath)).toBe(true);
        });
    });

    describe("R3: 回归锁", () => {
        it("/clear 后 window 应该为空（通过检查 clearWindow 被调用）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/session-artifacts.ts"),
                "utf-8"
            );
            // 检查 clearSessionArtifacts 中调用了 clearWindow
            const clearSessionMatch = code.match(/clearSessionArtifacts[\s\S]*?clearWindow/);
            expect(clearSessionMatch).not.toBeNull();
        });

        it("memory 不应该被 /clear 清理", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/session-artifacts.ts"),
                "utf-8"
            );
            // clearSessionArtifacts 不应该包含 memory 清理
            expect(code).not.toContain("memory");
        });

        it("direct 执行臂应该支持 /clear（只清理文件）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/runtime/session-orchestrator.ts"),
                "utf-8"
            );
            // clearSession 应该有 direct runners 的成功分支
            expect(code).toContain("已清理会话文件");
        });
    });
});

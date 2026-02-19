/**
 * msgcode: P5.6.7 R6 集成冒烟静态验证
 *
 * 验证代码层面的关键语义一致性
 * 工作区冒烟需要在运行时环境中手工执行
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// 工作区路径（仅用于测试，不进入运行时代码）
const WORKSPACES = [
    "/Users/admin/msgcode-workspaces/medicpass",
    "/Users/admin/msgcode-workspaces/charai",
    "/Users/admin/msgcode-workspaces/game01",
];

describe("P5.6.7-R6: 集成冒烟静态验证", () => {
    describe("工作区配置检查", () => {
        for (const ws of WORKSPACES) {
            const name = path.basename(ws);
            it(`${name}: .msgcode/config.json 存在`, () => {
                const configPath = path.join(ws, ".msgcode", "config.json");
                expect(fs.existsSync(configPath)).toBe(true);
            });
        }
    });

    describe("关键语义验证", () => {
        it("handlers.ts: direct 路径调用 runLmStudioToolLoop", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );
            expect(code).toContain("runLmStudioToolLoop");
        });

        it("session-orchestrator.ts: /clear 调用 clearSessionArtifacts", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/runtime/session-orchestrator.ts"),
                "utf-8"
            );
            expect(code).toContain("clearSessionArtifacts");
        });

        it("cmd-schedule.ts: /reload 输出 SOUL 字段", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/routes/cmd-schedule.ts"),
                "utf-8"
            );
            expect(code).toContain("SOUL: workspace=");
            expect(code).toContain("SOUL Entries:");
        });

        it("skills/auto.ts: runSkill 是单一执行入口", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/skills/auto.ts"),
                "utf-8"
            );
            expect(code).toContain("export async function runSkill");
        });

        it("session-artifacts.ts: clearSessionArtifacts 清理 window + summary", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/session-artifacts.ts"),
                "utf-8"
            );
            expect(code).toMatch(/clearWindow|clearSummary/);
        });

        it("session-artifacts.ts: 不包含 clearMemory（/clear 不清 memory）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/session-artifacts.ts"),
                "utf-8"
            );
            expect(code).not.toContain("clearMemory");
        });

        it("lmstudio.ts: runLmStudioToolLoop 通过 Tool Bus 调用（统一执行入口）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/lmstudio.ts"),
                "utf-8"
            );
            // P5.6.8-R3a: 验证 lmstudio 统一走 Tool Bus
            expect(code).toContain("const { executeTool } = await import");
            expect(code).toContain("await executeTool(name as any, args");
        });

        it("tools/bus.ts: run_skill 在 Tool Bus 中实现（单一执行入口）", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/tools/bus.ts"),
                "utf-8"
            );
            // 验证 Tool Bus 中有 run_skill 实现
            expect(code).toContain("case \"run_skill\"");
            expect(code).toContain("const { runSkill } = await import");
        });
    });

    describe("回归锁一致性", () => {
        it("P5.6.2-R1 回归锁存在", () => {
            const testPath = path.join(process.cwd(), "test/p5-6-2-r1-regression.test.ts");
            expect(fs.existsSync(testPath)).toBe(true);
        });

        it("P5.6.3 回归锁存在", () => {
            const testPath = path.join(process.cwd(), "test/p5-6-3-skill-single-source.test.ts");
            expect(fs.existsSync(testPath)).toBe(true);
        });

        it("P5.6.4 回归锁存在", () => {
            const testPath = path.join(process.cwd(), "test/p5-6-4-state-boundary.test.ts");
            expect(fs.existsSync(testPath)).toBe(true);
        });
    });
});

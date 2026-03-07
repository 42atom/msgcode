/**
 * msgcode: P5.7-R17 定时任务 skill pointer-only 回归锁
 *
 * 目标：
 * - 验证 prompt 只指向 skills 目录，不再暗示 schedule/cron 为系统内建能力
 * - 验证 scheduler skill 明确是参考实现
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

function readText(relPath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

describe("P5.7-R17: scheduler skill pointer-only", () => {
    it("agents-prompt.md 应指向 skills 目录和 index.json，而非特定 skill 注入", () => {
        const content = readText("prompts/agents-prompt.md");
        // 必须指向 skills 目录
        expect(content).toContain("/Users/admin/.config/msgcode/skills/");
        // 必须指向 index.json
        expect(content).toContain("index.json");
        // 不能对特定 skill（scheduler）做注入说明
        expect(content).not.toContain("scheduler：定时任务");
        // 不能暗示 cron 是内建能力
        expect(content).not.toContain("cron 是内建");
        expect(content).not.toContain("schedule 是内建");
    });

    it("scheduler skill 应明确是参考实现", () => {
        const content = readText("src/skills/runtime/scheduler/SKILL.md");
        expect(content).toContain("参考实现");
    });

    it("scheduler skill 应说明一次性任务由 LLM 自行决定", () => {
        const content = readText("src/skills/runtime/scheduler/SKILL.md");
        expect(content).toContain("一次性任务");
    });

    it("index.json 中 scheduler 描述应符合 pointer-only", () => {
        const content = readText("src/skills/runtime/index.json");
        expect(content).toContain("LLM 自行决定实现");
    });

    it("manifest.ts 应把 cron 列为禁止工具名（非系统内建）", () => {
        const content = readText("src/tools/manifest.ts");
        expect(content).toContain("cron");
        expect(content).toContain("禁止把");
    });
});

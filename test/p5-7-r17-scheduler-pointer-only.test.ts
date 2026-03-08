/**
 * msgcode: P5.7-R17 定时任务 skill pointer-only 回归锁
 *
 * 目标：
 * - 验证 prompt 明确要求先读 skills index，再读对应 skill，禁止猜 CLI 参数
 * - 验证 scheduler skill 明确 add/remove/list 的最短正确合同
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

function readText(relPath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

describe("P5.7-R17: scheduler skill pointer-only", () => {
    it("agents-prompt.md 应要求先读 skills index，再读对应 skill，禁止猜参数", () => {
        const content = readText("prompts/agents-prompt.md");
        expect(content).toContain("/Users/admin/.config/msgcode/skills/");
        expect(content).toContain("index.json");
        expect(content).toContain("必须先读 /Users/admin/.config/msgcode/skills/index.json");
        expect(content).toContain("必须再读对应 skill");
        expect(content).toContain("禁止猜参数");
        expect(content).toContain("scheduler：定时任务 CLI 合同；add/remove/list 都先读 skill，再按模板执行");
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

    it("scheduler skill 应明确 scheduleId 是位置参数，不能写成 --scheduleId", () => {
        const content = readText("src/skills/runtime/scheduler/SKILL.md");
        expect(content).toContain("`<schedule-id>` 是位置参数，不是 `--scheduleId`");
        expect(content).toContain("不要发明 `cron_add`、`schedule_add`");
    });

    it("scheduler skill 应明确 add 的 --tz 是必填参数", () => {
        const content = readText("src/skills/runtime/scheduler/SKILL.md");
        expect(content).toContain("bash ~/.config/msgcode/skills/scheduler/main.sh add <schedule-id> --workspace <workspace-abs-path> --cron '<expr>' --tz <iana> --message '<text>'");
        expect(content).toContain("bash ~/.config/msgcode/skills/scheduler/main.sh remove <schedule-id> --workspace <workspace-abs-path>");
        expect(content).toContain("bash ~/.config/msgcode/skills/scheduler/main.sh list --workspace <workspace-abs-path>");
        expect(content).toContain("禁止省略 `--cron` / `--tz` / `--message`");
        expect(content).toContain("漏 --tz");
        expect(content).toContain("漏 --cron 或漏 --message");
        expect(content).toContain("先读 `~/.config/msgcode/skills/index.json`");
        expect(content).toContain("禁止跳过本 skill 直接猜");
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

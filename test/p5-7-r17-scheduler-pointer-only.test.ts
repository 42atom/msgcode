import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TOOL_MANIFESTS } from "../src/tools/manifest.js";

function readText(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

describe("P5.7-R17: scheduler skill pointer-only", () => {
  it("agents-prompt.md 应使用占位符而非硬编码路径", () => {
    const content = readText("prompts/agents-prompt.md");
    expect(content).toContain("{{MSGCODE_SKILLS_DIR}}");
    expect(content).toContain("{{MSGCODE_CONFIG_DIR}}");
    expect(content).not.toContain("/Users/admin/.config/msgcode");
  });

  it("scheduler skill 应明确是参考实现，并约束一次性任务由 LLM 自行决定", () => {
    const content = readText("src/skills/runtime/scheduler/SKILL.md");
    expect(content).toContain("参考实现");
    expect(content).toContain("一次性任务");
  });

  it("scheduler skill 应冻结 add/remove/list 的最短正确合同", () => {
    const content = readText("src/skills/runtime/scheduler/SKILL.md");
    expect(content).toContain("`<schedule-id>` 是位置参数，不是 `--scheduleId`");
    expect(content).toContain("不要发明 `cron_add`、`schedule_add`");
    expect(content).toContain("bash ~/.config/msgcode/skills/scheduler/main.sh add <schedule-id> --workspace <workspace-abs-path> --cron '<expr>' --tz <iana> --message '<text>'");
    expect(content).toContain("bash ~/.config/msgcode/skills/scheduler/main.sh remove <schedule-id> --workspace <workspace-abs-path>");
    expect(content).toContain("bash ~/.config/msgcode/skills/scheduler/main.sh list --workspace <workspace-abs-path>");
    expect(content).toContain("禁止省略 `--cron` / `--tz` / `--message`");
    expect(content).toContain("先读 `~/.config/msgcode/skills/index.json`");
    expect(content).toContain("禁止跳过本 skill 直接猜");
  });

  it("index.json 中 scheduler 描述应符合 pointer-only", () => {
    const raw = readText("src/skills/runtime/index.json");
    const parsed = JSON.parse(raw) as {
      skills: Array<{ id: string; description?: string }>;
    };
    const scheduler = parsed.skills.find((skill) => skill.id === "scheduler");

    expect(scheduler).toBeDefined();
    expect(scheduler?.description).toContain("先读本 skill");
    expect(scheduler?.description).toContain("一次性任务由 LLM 自行决定实现");
  });

  it("TOOL_MANIFESTS 不应把 cron/schedule_add 暴露成系统内建工具名", () => {
    const toolNames = Object.keys(TOOL_MANIFESTS);
    expect(toolNames).not.toContain("cron");
    expect(toolNames).not.toContain("schedule_add");
    expect(toolNames).not.toContain("schedule_remove");
  });
});

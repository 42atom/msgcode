/**
 * msgcode: P5.7-R38 ghost-mcp skill 风险确认口径回归锁
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readText(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf-8");
}

describe("P5.7-R38: ghost-mcp skill 风险确认口径", () => {
  it("ghost skill 应明确高风险动作先问用户，而不是新增系统 gate", () => {
    const content = readText("src/skills/runtime/ghost-mcp/SKILL.md");

    expect(content).toContain("高风险动作");
    expect(content).toContain("默认先向用户确认");
    expect(content).toContain("msgcode 不为它额外加 confirm gate");
    expect(content).toContain("不要把“高风险动作先问用户”实现成新的系统 gate");
  });

  it("system prompt 应锁定 ghost 高风险动作走用户确认，而不是系统审批层", () => {
    const content = readText("prompts/agents-prompt.md");

    expect(content).toContain("`ghost_*` 是当前正式桌面能力面");
    expect(content).toContain("不要为 `ghost_*` 新增系统级 confirm gate");
    expect(content).toContain("先向用户确认，再执行");
    expect(content).toContain("这里的确认责任属于模型与用户交互");
  });
});

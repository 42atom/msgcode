/**
 * msgcode: P5.7-R35 subagent optional skill 合同回归锁
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readText(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf-8");
}

describe("P5.7-R35: subagent optional skill 合同", () => {
  it("optional 索引应暴露 subagent skill", () => {
    const index = readText("src/skills/optional/index.json");

    expect(index).toContain('"id": "subagent"');
    expect(index).toContain("codex 或 claude-code");
  });

  it("skill 正文应强调正式合同优先、安装提示与贪吃蛇 BDD", () => {
    const content = readText("src/skills/optional/subagent/SKILL.md");

    expect(content).toContain("name: subagent");
    expect(content).toContain("msgcode subagent run codex --goal");
    expect(content).toContain("subagent list");
    expect(content).toContain("列出**当前 workspace 下已有的子代理任务**");
    expect(content).toContain("msgcode subagent stop <task-id>");
    expect(content).toContain("假装已经把任务派出去了");
    expect(content).toContain("codex --version");
    expect(content).toContain("claude --version");
    expect(content).toContain("@anthropic-ai/claude-code");
    expect(content).toContain("不要把 `list` 误读成“查看有哪些执行臂可安装/可用”");
    expect(content).toContain("贪吃蛇 HTML 游戏");
    expect(content).toContain("主脑负责决策、监控、验收；子代理负责执行");
  });
});

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("tk0217: reflection protocol and templates", () => {
  it("R1: REFLECTION 协议固定 daily log 与 candidate 落点", () => {
    const protocol = read("docs/protocol/REFLECTION.md");

    expect(protocol).toContain("AIDOCS/reports/daily/<YYYY-MM-DD>.md");
    expect(protocol).toContain(".msgcode/reflection/memory-candidates/<candidate-id>.md");
    expect(protocol).toContain(".msgcode/reflection/skill-candidates/<candidate-id>.md");
    expect(protocol).toContain("candidate 不自动升级成正式 memory / skill");
  });

  it("R2: daily log 模板存在且包含最小章节", () => {
    const template = read("docs/protocol/reflection-daily-log.template.md");

    expect(template).toContain("# Daily Log - YYYY-MM-DD");
    expect(template).toContain("## Summary");
    expect(template).toContain("## Memory Candidates");
    expect(template).toContain("## Skill Candidates");
    expect(template).toContain("## Next");
  });

  it("R3: memory/skill candidate 模板存在且默认 pending", () => {
    const memoryTemplate = read("docs/protocol/reflection-memory-candidate.template.md");
    const skillTemplate = read("docs/protocol/reflection-skill-candidate.template.md");

    expect(memoryTemplate).toContain("status: pending");
    expect(memoryTemplate).toContain("# Memory Candidate:");
    expect(memoryTemplate).toContain("## Suggested Action");

    expect(skillTemplate).toContain("status: pending");
    expect(skillTemplate).toContain("# Skill Candidate:");
    expect(skillTemplate).toContain("## Trigger");
  });
});

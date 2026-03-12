import { describe, expect, it } from "bun:test";
import { execCliStdoutIsolated, runCliIsolated } from "./helpers/cli-process.js";

describe("P5.7-R34: skill CLI retired compat shell", () => {
  it("root help 不应公开 skill", () => {
    const out = execCliStdoutIsolated(["--help"]);
    expect(out).not.toContain("skill");
    expect(out).not.toContain("skills");
  });

  it("skill --help 应明确显示已退役", () => {
    const out = execCliStdoutIsolated(["skill", "--help"]);
    expect(out).toContain("已退役");
    expect(out).not.toContain("list");
    expect(out).not.toContain("run <name>");
  });

  it("skill run demo 应返回 retired 提示", () => {
    const res = runCliIsolated(["skill", "run", "demo"]);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(res.status).toBe(1);
    expect(output).toContain("msgcode skill 已退役");
    expect(output).toContain("help-docs");
    expect(output).toContain("SKILL.md");
  });

  it("skills run demo 应映射到同一 retired 壳", () => {
    const res = runCliIsolated(["skills", "run", "demo"]);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(res.status).toBe(1);
    expect(output).toContain("msgcode skill 已退役");
  });
});

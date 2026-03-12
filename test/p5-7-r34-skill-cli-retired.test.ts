import { describe, expect, it } from "bun:test";
import { execCliStdoutIsolated, runCliIsolated } from "./helpers/cli-process.js";

describe("P5.7-R34: skill CLI retired compat shell", () => {
  it("root help 不应公开 skill", () => {
    const out = execCliStdoutIsolated(["--help"]);
    expect(out).not.toContain("skill");
    expect(out).not.toContain("skills");
  });

  it("skill --help 应回落到根帮助且不公开 skill", () => {
    const out = execCliStdoutIsolated(["skill", "--help"]);
    expect(out).not.toContain("\n  skill");
    expect(out).not.toContain("\n  skills");
  });

  it("skill run demo 应直接报 unknown command", () => {
    const res = runCliIsolated(["skill", "run", "demo"]);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(res.status).toBe(1);
    expect(output).toContain("unknown command");
    expect(output).toContain("skill");
  });

  it("skills run demo 应直接报 unknown command", () => {
    const res = runCliIsolated(["skills", "run", "demo"]);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(res.status).toBe(1);
    expect(output).toContain("unknown command");
    expect(output).toContain("skills");
  });
});

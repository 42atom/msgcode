import { describe, expect, it } from "bun:test";
import { execCliStdoutIsolated } from "./helpers/cli-process.js";

describe("P5.7-R36: subagent CLI 合同", () => {
  it("root help 应公开 subagent 命令组", () => {
    const out = execCliStdoutIsolated(["--help"]);
    expect(out).toContain("subagent");
  });

  it("subagent --help 应只公开 run/status/stop", () => {
    const out = execCliStdoutIsolated(["subagent", "--help"]);
    expect(out).toContain("run");
    expect(out).toContain("status");
    expect(out).toContain("stop");
    expect(out).not.toContain("queue");
  });

  it("help-docs --json 应暴露 subagent 正式合同", () => {
    const out = execCliStdoutIsolated(["help-docs", "--json"]);
    const parsed = JSON.parse(out) as {
      data: {
        commands: Array<{ name: string }>;
      };
    };
    const names = parsed.data.commands.map((item) => item.name);
    expect(names).toContain("msgcode subagent run");
    expect(names).toContain("msgcode subagent status");
    expect(names).toContain("msgcode subagent stop");
  });
});

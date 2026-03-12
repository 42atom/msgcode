/**
 * msgcode: P5.7-R6-1 Media CLI 删除墓碑后回归测试
 */

import { describe, it, expect } from "bun:test";
import { execCliStdoutIsolated, runCliIsolated } from "./helpers/cli-process.js";

describe("P5.7-R6-1: Media CLI tombstone removed", () => {

  it("help-docs --json 不应再包含 msgcode media screen 合同", () => {
    const output = execCliStdoutIsolated(["help-docs", "--json"]);
    const envelope = JSON.parse(output);

    expect(envelope.status).toBe("pass");
    expect(
      envelope.data.commands.find((cmd: { name: string }) => cmd.name === "msgcode media screen")
    ).toBeUndefined();
  });

  it("media screen --json 应返回 unknown command", () => {
    const result = runCliIsolated(["media", "screen", "--json"]);

    expect(result.status).toBe(1);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(output).toContain("unknown command");
    expect(output).toContain("media");
  });

  it("media --help 应回落到根帮助且不公开 media", () => {
    const output = execCliStdoutIsolated(["media", "--help"]);

    expect(output).not.toContain("\n  media");
  });
});

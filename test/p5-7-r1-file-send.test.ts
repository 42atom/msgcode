import { describe, it, expect } from "bun:test";
import { execCliStdoutIsolated, runCliIsolated } from "./helpers/cli-process.js";

function runCli(args: string[]) {
  return runCliIsolated(args, { cwd: "/Users/admin/GitProjects/msgcode" });
}

describe("P5.7-R1: legacy file send should be retired cleanly", () => {
  it("file --help 不应再公开 retired file send", () => {
    const out = execCliStdoutIsolated(["file", "--help"]);
    expect(out).not.toMatch(/\n\s+file\b/);
    expect(out).not.toContain("\n  send");
  });

  it("help-docs --json 不应再暴露 file send 合同", () => {
    const result = runCli(["help-docs", "--json"]);
    expect(result.status).toBe(0);

    const envelope = JSON.parse(result.stdout);
    const names = envelope.data.commands.map((command: { name: string }) => command.name);

    expect(names).not.toContain("file send");
  });

  it("file send --json 应返回 unknown command", () => {
    const result = runCli([
      "file",
      "send",
      "--path",
      "/tmp/example.txt",
      "--to",
      "iMessage;+;chat123",
      "--json",
    ]);

    expect(result.status).toBe(1);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(output).toContain("unknown command");
    expect(output).toContain("file");
  });

  it("file send 文本模式应直接报 unknown command", () => {
    const result = runCli(["file", "send"]);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("unknown command");
    expect(output).toContain("file");
  });
});

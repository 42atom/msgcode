import { describe, it, expect } from "bun:test";
import { runCliIsolated } from "./helpers/cli-process.js";

function runCli(args: string[]) {
  return runCliIsolated(args, { cwd: "/Users/admin/GitProjects/msgcode" });
}

describe("P5.7-R1: legacy file send should be retired cleanly", () => {
  it("help-docs --json 不应再暴露 file send 合同", () => {
    const result = runCli(["help-docs", "--json"]);
    expect(result.status).toBe(0);

    const envelope = JSON.parse(result.stdout);
    const names = envelope.data.commands.map((command: { name: string }) => command.name);

    expect(names).not.toContain("file send");
  });

  it("file send --json 应返回固定 retired 错误码", () => {
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

    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe("error");
    expect(envelope.exitCode).toBe(1);
    expect(envelope.data.ok).toBe(false);
    expect(envelope.data.errorCode).toBe("FILE_SEND_RETIRED");
    expect(envelope.errors[0].code).toBe("FILE_SEND_RETIRED");
  });

  it("file send 文本模式应明确提示已退役与新方向", () => {
    const result = runCli(["file", "send"]);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("已退役");
    expect(output).toContain("Feishu");
    expect(output).toContain("app/web");
  });
});

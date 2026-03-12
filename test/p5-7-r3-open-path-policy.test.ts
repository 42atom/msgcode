/**
 * msgcode: file/system CLI 退役回归锁
 *
 * 目标：
 * 1. root help 不再公开 file/system
 * 2. help-docs 不再暴露 file/system 合同
 * 3. direct invoke 时返回 retired 提示
 */

import { describe, it, expect } from "bun:test";
import { execCliStdoutIsolated, runCliIsolated } from "./helpers/cli-process.js";

describe("P5.7-R3: retire file/system CLI wrappers", () => {
  it("R3-open-1: root help 不应再公开 file 与 system", () => {
    const out = execCliStdoutIsolated(["--help"]);
    expect(out).not.toMatch(/\n\s+file\b/);
    expect(out).not.toMatch(/\n\s+system\b/);
  });

  it("R3-open-2: help-docs --json 不应再暴露 file 与 system 合同", () => {
    const out = execCliStdoutIsolated(["help-docs", "--json"]);
    const envelope = JSON.parse(out);
    const names = envelope.data.commands.map((command: { name: string }) => command.name);

    expect(names.some((name: string) => name.startsWith("file "))).toBe(false);
    expect(names.some((name: string) => name.startsWith("system "))).toBe(false);
  });

  it("R3-open-3: file direct invoke 应返回 unknown command", () => {
    const res = runCliIsolated(["file", "read", "README.md"]);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;

    expect(res.status).toBe(1);
    expect(output).toContain("unknown command");
    expect(output).toContain("file");
  });

  it("R3-open-4: system direct invoke 应返回 unknown command", () => {
    const res = runCliIsolated(["system", "info"]);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;

    expect(res.status).toBe(1);
    expect(output).toContain("unknown command");
    expect(output).toContain("system");
  });
});

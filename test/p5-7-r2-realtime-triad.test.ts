/**
 * msgcode: web/system/media CLI 退役回归测试
 *
 * 验证：
 * 1. root help 不再公开 web/system/media
 * 2. help-docs 不再暴露 web/system/media
 * 3. direct invoke 返回 retired 提示
 */

import { describe, it, expect } from "bun:test";
import { execCliStdoutIsolated, runCliIsolated } from "./helpers/cli-process.js";

describe("P5.7-R2: retire web/system/media CLI wrappers", () => {
  it("R2-1: root help 不再公开 web、system 与 media", () => {
    const out = execCliStdoutIsolated(["--help"]);
    expect(out).not.toMatch(/\n\s+web\b/);
    expect(out).not.toMatch(/\n\s+system\b/);
    expect(out).not.toMatch(/\n\s+media\b/);
  });

  it("R2-2: help-docs --json 不再暴露 web、system 与 media 包装层", () => {
    const output = execCliStdoutIsolated(["help-docs", "--json"]);
    const envelope = JSON.parse(output);
    const names = envelope.data.commands.map((command: { name: string }) => command.name);

    expect(names).not.toContain("web search");
    expect(names).not.toContain("web fetch");
    expect(names).not.toContain("system info");
    expect(names).not.toContain("system env");
    expect(names).not.toContain("msgcode media screen");
  });

  it("R2-3: web search direct invoke 应返回 unknown command", () => {
    const res = runCliIsolated(["web", "search", "--q", "msgcode"]);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;

    expect(res.status).toBe(1);
    expect(output).toContain("unknown command");
    expect(output).toContain("web");
  });

  it("R2-4: web fetch direct invoke 应返回 unknown command", () => {
    const res = runCliIsolated(["web", "fetch", "--url", "https://example.com"]);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;

    expect(res.status).toBe(1);
    expect(output).toContain("unknown command");
    expect(output).toContain("web");
  });

  it("R2-5: media screen direct invoke 应返回 unknown command", () => {
    const res = runCliIsolated(["media", "screen", "--json"]);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;

    expect(res.status).toBe(1);
    expect(output).toContain("unknown command");
    expect(output).toContain("media");
  });
});

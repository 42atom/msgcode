/**
 * P5.7-R6 HOTFIX 回归锁
 *
 * 目标：
 * 1. 缺省 workspace 配置时，ToolLoop 工具不应被意外清空
 * 2. CLI 必须支持 `msgcode gen ...` 主入口
 */

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execCliStdoutIsolated, runCliIsolated } from "./helpers/cli-process.js";

describe("P5.7-R6 HOTFIX: gen 入口 + tools 缺省值", () => {
  it("getToolsForLlm: config 缺少 tooling.allow 时应返回第一公民文件工具基线", async () => {
    const { getToolsForLlm } = await import("../src/lmstudio.js");

    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-ws-r6-hotfix-"));
    fs.mkdirSync(path.join(ws, ".msgcode"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, ".msgcode", "config.json"),
      JSON.stringify({ "runner.default": "lmstudio" }, null, 2),
      "utf-8"
    );

    try {
      const tools = await getToolsForLlm(ws);
      const toolNames = tools as string[];

      expect(toolNames.length).toBeGreaterThan(0);
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("write_file");
      expect(toolNames).toContain("edit_file");
      expect(toolNames).toContain("bash");
      expect(toolNames).toContain("help_docs");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("getToolsForLlm: workspace 显式 allow 只放开 feishu_send_file 时，应保留最小探索基线并暴露它", async () => {
    const { getToolsForLlm } = await import("../src/lmstudio.js");

    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-ws-r6-feishu-tools-"));
    fs.mkdirSync(path.join(ws, ".msgcode"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, ".msgcode", "config.json"),
      JSON.stringify({ "tooling.allow": ["feishu_send_file"] }, null, 2),
      "utf-8"
    );

    try {
      const tools = await getToolsForLlm(ws);
      const toolNames = tools as string[];
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("bash");
      expect(toolNames).toContain("help_docs");
      expect(toolNames).toContain("feishu_send_file");
      expect(toolNames).not.toContain("write_file");
      expect(toolNames).not.toContain("edit_file");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("getToolsForLlm: 无 workspace 时也应基于默认配置暴露当前默认工具面", async () => {
    const { getToolsForLlm } = await import("../src/lmstudio.js");

    const tools = await getToolsForLlm(undefined);
    const toolNames = tools as string[];

    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("edit_file");
    expect(toolNames).toContain("bash");
    expect(toolNames).toContain("help_docs");
    expect(toolNames).toContain("feishu_send_file");
    expect(toolNames).toContain("feishu_list_members");
    expect(toolNames).not.toContain("vision");
  });

  it("CLI: `msgcode gen --help` 应包含 image/selfie/tts/music 子命令", () => {
    const out = execCliStdoutIsolated(["gen", "--help"]);
    expect(out).toContain("image");
    expect(out).toContain("selfie");
    expect(out).toContain("tts");
    expect(out).toContain("music");
  });

  it("CLI: `msgcode gen image --prompt '' --json` 应返回固定错误码", () => {
    const res = runCliIsolated(["gen", "image", "--prompt", "", "--json"]);
    expect(res.status).toBe(1);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(output).toContain("GEN_INVALID_PROMPT");
  });
});

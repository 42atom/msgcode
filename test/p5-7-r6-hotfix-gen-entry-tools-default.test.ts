/**
 * P5.7-R6 HOTFIX 回归锁
 *
 * 目标：
 * 1. 缺省 workspace 配置时，ToolLoop 工具不应被意外清空
 * 2. CLI 必须支持 `msgcode gen ...` 主入口
 */

import { describe, expect, it } from "bun:test";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("P5.7-R6 HOTFIX: gen 入口 + tools 缺省值", () => {
  it("getToolsForLlm: config 缺少 pi.enabled 时应回退默认值（返回空数组）", async () => {
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
      // 没有 pi.enabled 配置时返回空数组
      expect(tools).toHaveLength(0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("CLI: `msgcode gen --help` 应包含 image/selfie/tts/music 子命令", () => {
    const out = execSync("NODE_OPTIONS='--import tsx' node src/cli.ts gen --help", {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    expect(out).toContain("image");
    expect(out).toContain("selfie");
    expect(out).toContain("tts");
    expect(out).toContain("music");
  });

  it("CLI: `msgcode gen image --prompt '' --json` 应返回固定错误码", () => {
    const res = spawnSync("node", ["src/cli.ts", "gen", "image", "--prompt", "", "--json"], {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, NODE_OPTIONS: "--import tsx" },
    });
    expect(res.status).toBe(1);
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(output).toContain("GEN_INVALID_PROMPT");
  });
});

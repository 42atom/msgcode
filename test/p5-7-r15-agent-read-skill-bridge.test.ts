/**
 * P5.7-R15 + P5.7-R16: Agent Skill 桥 - 完整工具暴露
 *
 * 确保在没有 workspace 配置时，LLM 能获得完整工具面
 * - read_file: 读取 skill
 * - bash: 执行后续命令
 * - browser: 浏览器操作
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getToolsForLlm } from "../src/agent-backend/tool-loop.js";

describe("P5.7-R15 + P5.7-R16: skill 场景完整工具暴露", () => {
  it("无 workspacePath 时应返回完整工具列表", async () => {
    // 当没有 workspace 配置时，skill 场景应该暴露完整工具
    const tools = await getToolsForLlm(undefined);

    // 必须包含 read_file（skill 读取）
    expect(tools).toContain("read_file");
    // 必须包含 bash（后续执行）
    expect(tools).toContain("bash");
    // 必须包含 browser（浏览器操作）
    expect(tools).toContain("browser");
    // 不应包含未实现的 mem tool
    expect(tools).not.toContain("mem");
    // 不应包含被默认抑制的工具
    expect(tools).not.toContain("write_file");
    expect(tools).not.toContain("edit_file");
  });

  it("workspace 未显式配置 tooling.allow 时也应保留 read_file + bash 基线", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r15-skill-bridge-"));
    await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
    await writeFile(join(workspacePath, ".msgcode", "config.json"), JSON.stringify({}, null, 2), "utf-8");

    const tools = await getToolsForLlm(workspacePath);

    try {
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toContain("read_file");
      expect(tools).toContain("bash");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

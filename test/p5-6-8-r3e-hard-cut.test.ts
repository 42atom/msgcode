/**
 * msgcode: P5.6.8-R3e 硬切割回归锁测试
 *
 * 目标：
 * - 确保退役 skill 编排文件不回流
 * - 确保历史 PI / run_skill / 旧工具名不再进入运行时真相源
 * - 保留真正有价值的硬切断言，不锁无关源码写法
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("P5.6.8-R3e: 硬切割回归锁", () => {
  it("退役的 skill 编排文件应不存在", () => {
    expect(
      fs.existsSync(path.join(process.cwd(), "src/runtime/skill-orchestrator.ts"))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(process.cwd(), "src/skills/registry.ts"))
    ).toBe(false);
  });

  it("repo 侧 skills 入口只应保留最小 auto-skill 兼容导出", async () => {
    const module = await import("../src/skills/index.js");

    expect(module.detectAutoSkill).toBeDefined();
    expect(module.runSkill).toBeDefined();
    expect((module as Record<string, unknown>).runLegacySkill).toBeUndefined();
    expect((module as Record<string, unknown>).getSkillIndex).toBeUndefined();
  });

  it("agent-backend 不应回流 PI 幽灵导出", async () => {
    const facade = await import("../src/agent-backend.js");
    const core = await import("../src/agent-backend/index.js");

    expect((facade as Record<string, unknown>).AGENT_TOOLS).toBeUndefined();
    expect((core as Record<string, unknown>).PI_ON_TOOLS).toBeUndefined();
  });

  it("TOOL_MANIFESTS 应只包含当前正式工具，不回流旧工具名", async () => {
    const { TOOL_MANIFESTS, resolveLlmToolExposure } = await import("../src/tools/manifest.js");

    const toolNames = Object.keys(TOOL_MANIFESTS);
    expect(toolNames).toContain("bash");
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("edit_file");

    for (const retiredName of ["run_skill", "list_directory", "read_text_file", "append_text_file"]) {
      expect(toolNames).not.toContain(retiredName);
    }

    const exposure = resolveLlmToolExposure(["bash", "read_file", "list_directory" as any]);
    expect(exposure.exposedTools).toContain("bash");
    expect(exposure.exposedTools).toContain("read_file");
    expect(exposure.exposedTools).not.toContain("list_directory" as any);
    expect(exposure.missingManifests).toContain("list_directory" as any);
  });

  it("lmstudio 兼容层的工具入口应直接复用执行核真相源", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-r3e-"));

    try {
      fs.mkdirSync(path.join(tmpWorkspace, ".msgcode"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpWorkspace, ".msgcode", "config.json"),
        JSON.stringify({
          "tooling.allow": ["bash", "read_file"],
        }),
        "utf-8"
      );

      const compat = await import("../src/lmstudio.js");
      const core = await import("../src/agent-backend/index.js");

      expect(compat.getToolsForLlm).toBe(core.getToolsForLlm);
      expect(compat.getToolsForAgent).toBe(core.getToolsForLlm);

      const tools = await compat.getToolsForLlm(tmpWorkspace);
      expect(tools).toContain("bash");
      expect(tools).toContain("read_file");
      expect(tools).toContain("help_docs");
      expect(tools).not.toContain("write_file");
      expect(tools).not.toContain("edit_file");
      expect(tools).not.toContain("run_skill" as any);
    } finally {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    }
  });
});

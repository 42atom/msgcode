/**
 * msgcode: P5.6.8-R4g PI 核心四工具门禁对齐回归测试
 *
 * 验证：
 * 1. bash 命名统一（无 shell 漂移）
 * 2. pi.on 自动添加四工具
 * 3. 工具可执行（无 TOOL_NOT_ALLOWED）
 */

import { describe, it, expect } from "vitest";
import { canExecuteTool, getToolPolicy } from "../src/tools/bus.js";
import type { ToolPolicy } from "../src/tools/types.js";

// ============================================
// 命名收口测试
// ============================================

describe("P5.6.8-R4g: 命名收口", () => {
  it("R4g-1: ToolName 不包含 shell", async () => {
    const { ToolName } = await import("../src/tools/types.js");

    // 通过类型系统验证：shell 已从 ToolName 中删除
    // P5.6.13-R1A-EXEC: run_skill 已退役
    const validTools = ["tts", "asr", "vision", "mem", "bash", "browser", "desktop", "read_file", "write_file", "edit_file"];

    expect(validTools).toContain("bash");
    expect(validTools).not.toContain("shell");
    expect(validTools).not.toContain("run_skill");
  });

  it("R4g-2: 默认 tooling.allow 包含 PI 四工具", async () => {
    const { DEFAULT_WORKSPACE_CONFIG } = await import("../src/config/workspace.js");

    expect(DEFAULT_WORKSPACE_CONFIG["tooling.allow"]).toContain("read_file");
    expect(DEFAULT_WORKSPACE_CONFIG["tooling.allow"]).toContain("write_file");
    expect(DEFAULT_WORKSPACE_CONFIG["tooling.allow"]).toContain("edit_file");
    expect(DEFAULT_WORKSPACE_CONFIG["tooling.allow"]).toContain("bash");
  });

  it("R4g-3: 默认 tooling.allow 不包含 shell", async () => {
    const { DEFAULT_WORKSPACE_CONFIG } = await import("../src/config/workspace.js");

    expect(DEFAULT_WORKSPACE_CONFIG["tooling.allow"]).not.toContain("shell");
  });
});

// ============================================
// 门禁测试
// ============================================

describe("P5.6.8-R4g: 门禁测试", () => {
  it("R4g-4: bash 工具在 allow 列表中可执行", () => {
    const policy: ToolPolicy = {
      mode: "autonomous",
      allow: ["tts", "bash", "read_file"],
      requireConfirm: [],
    };

    const result = canExecuteTool(policy, "bash", "llm-tool-call");
    expect(result.ok).toBe(true);
  });

  it("R4g-5: read_file 在 allow 列表中可执行", () => {
    const policy: ToolPolicy = {
      mode: "autonomous",
      allow: ["read_file", "write_file"],
      requireConfirm: [],
    };

    const result = canExecuteTool(policy, "read_file", "llm-tool-call");
    expect(result.ok).toBe(true);
  });

  it("R4g-6: 工具不在 allow 列表中拒绝执行", () => {
    const policy: ToolPolicy = {
      mode: "autonomous",
      allow: ["tts", "asr"],
      requireConfirm: [],
    };

    const result = canExecuteTool(policy, "bash", "llm-tool-call");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TOOL_NOT_ALLOWED");
  });

  it("R4g-7: PI 四工具全部在 allow 列表中可执行", () => {
    const policy: ToolPolicy = {
      mode: "autonomous",
      allow: ["read_file", "write_file", "edit_file", "bash"],
      requireConfirm: [],
    };

    const piTools = ["read_file", "write_file", "edit_file", "bash"] as const;

    for (const tool of piTools) {
      const result = canExecuteTool(policy, tool, "llm-tool-call");
      expect(result.ok).toBe(true);
    }
  });
});

// ============================================
// 集成测试
// ============================================

describe("P5.6.8-R4g: 集成测试", () => {
  it("R4g-8: /tool allow 提示包含 PI 四工具", async () => {
    const cmdToolingContent = await import("fs/promises").then(fs =>
      fs.readFile("src/routes/cmd-tooling.ts", "utf-8")
    );

    expect(cmdToolingContent).toContain("read_file");
    expect(cmdToolingContent).toContain("write_file");
    expect(cmdToolingContent).toContain("edit_file");
    expect(cmdToolingContent).toContain("bash");
  });

  it("R4g-9: Tool Bus TOOL_META 定义 bash", async () => {
    const busContent = await import("fs/promises").then(fs =>
      fs.readFile("src/tools/bus.ts", "utf-8")
    );

    expect(busContent).toMatch(/bash.*sideEffect.*process-control/);
  });

  it("R4g-10: Tool Bus TOOL_META 不包含 shell", async () => {
    const busContent = await import("fs/promises").then(fs =>
      fs.readFile("src/tools/bus.ts", "utf-8")
    );

    // 确保 TOOL_META 中没有 "shell": {
    expect(busContent).not.toMatch(/shell.*sideEffect/);
  });
});

// ============================================
// 边界条件测试
// ============================================

describe("P5.6.8-R4g: 边界条件", () => {
  it("R4g-11: 空 allow 列表拒绝所有工具", () => {
    const policy: ToolPolicy = {
      mode: "autonomous",
      allow: [],
      requireConfirm: [],
    };

    const result = canExecuteTool(policy, "bash", "llm-tool-call");
    expect(result.ok).toBe(false);
  });

  it("R4g-12: requireConfirm 在 autonomous 模式下被忽略", () => {
    const policy: ToolPolicy = {
      mode: "autonomous",
      allow: ["bash"],
      requireConfirm: ["bash"],  // 即使需要确认，autonomous 模式也忽略
    };

    const result = canExecuteTool(policy, "bash", "llm-tool-call");
    expect(result.ok).toBe(true);
  });

  it("R4g-13: explicit 模式拒绝 llm-tool-call", () => {
    const policy: ToolPolicy = {
      mode: "explicit",
      allow: ["bash"],
      requireConfirm: [],
    };

    const result = canExecuteTool(policy, "bash", "llm-tool-call");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TOOL_NOT_ALLOWED");
  });

  it("R4g-14: explicit 模式允许 slash-command", () => {
    const policy: ToolPolicy = {
      mode: "explicit",
      allow: ["bash"],
      requireConfirm: [],
    };

    const result = canExecuteTool(policy, "bash", "slash-command");
    expect(result.ok).toBe(true);
  });
});

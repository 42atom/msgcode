/**
 * msgcode: P5.6.8-R4h 工具根路径与失败防幻想回归测试
 *
 * 验证：
 * 1. 根路径一致性（workspacePath 正确传递）
 * 2. 失败防幻想（error 时直接返回结构化错误）
 * 3. bash 唯一命名锁（无 shell 残留）
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ============================================
// R4h-1: 根路径一致性测试
// ============================================

describe("P5.6.8-R4h-1: 根路径一致性", () => {
  it("R4h-1.1: runTool 使用 workspacePath 而非 root", async () => {
    const lmstudioContent = await readFile(
      join(process.cwd(), "src", "lmstudio.ts"),
      "utf-8"
    );

    // 验证：runTool 调用传递 workspacePath
    expect(lmstudioContent).toContain("toolResult = await runTool(tc.function.name, args, workspacePath)");
  });

  it("R4h-1.2: executeTool 使用 workspacePath 参数", async () => {
    const busContent = await readFile(
      join(process.cwd(), "src", "tools", "bus.ts"),
      "utf-8"
    );

    // 验证：executeTool 接收 workspacePath
    expect(busContent).toContain("workspacePath: string");
  });
});

// ============================================
// R4h-2: 失败防幻想测试
// ============================================

describe("P5.6.8-R4h-2: 失败防幻想", () => {
  it("R4h-2.1: runTool 返回 errorCode 字段", async () => {
    const lmstudioContent = await readFile(
      join(process.cwd(), "src", "lmstudio.ts"),
      "utf-8"
    );

    // 验证：runTool 返回 errorCode
    expect(lmstudioContent).toContain("errorCode: result.error?.code");
  });

  it("R4h-2.2: 工具失败时短路（不生成伪执行文本）", async () => {
    const lmstudioContent = await readFile(
      join(process.cwd(), "src", "lmstudio.ts"),
      "utf-8"
    );

    // 验证：检测 error 时直接返回结构化失败文案
    expect(lmstudioContent).toContain("失败短路");
    expect(lmstudioContent).toContain("工具执行失败");
    expect(lmstudioContent).toContain("toolErrorCode");
  });

  it("R4h-2.3: 短路返回结构化错误格式", async () => {
    const lmstudioContent = await readFile(
      join(process.cwd(), "src", "lmstudio.ts"),
      "utf-8"
    );

    // 验证：错误格式包含工具名、错误码、错误消息
    expect(lmstudioContent).toMatch(/工具执行失败.*工具:.*错误码:.*错误:/s);
  });
});

// ============================================
// R4h-3: bash 唯一命名锁测试
// ============================================

describe("P5.6.8-R4h-3: bash 唯一命名锁", () => {
  it("R4h-3.1: ToolName 不包含 shell（tools/types.ts）", async () => {
    const typesContent = await readFile(
      join(process.cwd(), "src", "tools", "types.ts"),
      "utf-8"
    );

    // 验证：ToolName 类型不包含 "shell"
    const toolNameMatch = typesContent.match(/export type ToolName[\s\S]*?;/);
    expect(toolNameMatch).not.toBeNull();
    expect(toolNameMatch![0]).not.toContain('"shell"');
    expect(toolNameMatch![0]).toContain('"bash"');
  });

  it("R4h-3.2: ToolName 不包含 shell（config/workspace.ts）", async () => {
    const workspaceContent = await readFile(
      join(process.cwd(), "src", "config", "workspace.ts"),
      "utf-8"
    );

    // 验证：ToolName 类型不包含 "shell"
    const toolNameMatch = workspaceContent.match(/export type ToolName[\s\S]*?;/);
    expect(toolNameMatch).not.toBeNull();
    expect(toolNameMatch![0]).not.toContain('"shell"');
    expect(toolNameMatch![0]).toContain('"bash"');
  });

  it("R4h-3.3: TOOL_META 不包含 shell", async () => {
    const busContent = await readFile(
      join(process.cwd(), "src", "tools", "bus.ts"),
      "utf-8"
    );

    // 验证：TOOL_META 不包含 shell
    const toolMetaMatch = busContent.match(/const TOOL_META[\s\S]*?^};/m);
    expect(toolMetaMatch).not.toBeNull();
    expect(toolMetaMatch![0]).not.toContain('shell:');
    expect(toolMetaMatch![0]).toContain('bash:');
  });

  it("R4h-3.4: 默认 tooling.allow 不包含 shell", async () => {
    const workspaceContent = await readFile(
      join(process.cwd(), "src", "config", "workspace.ts"),
      "utf-8"
    );

    // 验证：DEFAULT_WORKSPACE_CONFIG 的 allow 包含 bash，不包含 shell
    const defaultConfigMatch = workspaceContent.match(/DEFAULT_WORKSPACE_CONFIG[\s\S]*?"tooling\.allow"[\s\S]*?\[[\s\S]*?\]/);
    expect(defaultConfigMatch).not.toBeNull();
    expect(defaultConfigMatch![0]).toContain('"bash"');
    expect(defaultConfigMatch![0]).not.toContain('"shell"');
  });
});

// ============================================
// R4h-4: 观测补全测试
// ============================================

describe("P5.6.8-R4h-4: 观测补全", () => {
  it("R4h-4.1: 日志包含 toolErrorCode", async () => {
    const lmstudioContent = await readFile(
      join(process.cwd(), "src", "lmstudio.ts"),
      "utf-8"
    );

    // 验证：日志包含 toolErrorCode
    expect(lmstudioContent).toContain("toolErrorCode:");
  });

  it("R4h-4.2: 日志包含 toolErrorMessage", async () => {
    const lmstudioContent = await readFile(
      join(process.cwd(), "src", "lmstudio.ts"),
      "utf-8"
    );

    // 验证：日志包含 toolErrorMessage
    expect(lmstudioContent).toContain("toolErrorMessage:");
  });

  it("R4h-4.3: 日志包含 exitCode", async () => {
    const lmstudioContent = await readFile(
      join(process.cwd(), "src", "lmstudio.ts"),
      "utf-8"
    );

    // 验证：日志包含 exitCode
    expect(lmstudioContent).toContain("exitCode:");
  });
});

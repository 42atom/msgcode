/**
 * P5.7-R15 + P5.7-R16: Agent Skill 桥 - 完整工具暴露
 *
 * 确保在没有 workspace 配置时，LLM 能获得完整工具面
 * - read_file: 读取 skill
 * - bash: 执行后续命令
 * - browser: 浏览器操作
 */

import { describe, expect, it } from "bun:test";
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

  it("有 workspacePath 但无 pi.enabled 时也应返回完整工具列表", async () => {
    // 当 workspace 没有 pi.enabled 时，skill 场景也应该暴露完整工具
    const tools = await getToolsForLlm("/fake/nonexistent/path");

    // 即使 workspace 不存在，也应该返回工具（而不是空数组）
    // 因为 skill 场景需要默认工具能力
    expect(tools.length).toBeGreaterThan(0);
    expect(tools).toContain("read_file");
    expect(tools).toContain("bash");
  });
});

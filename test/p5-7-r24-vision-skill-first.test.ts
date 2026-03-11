/**
 * msgcode: P5.7-R24 详细视觉 skill-first 回归锁
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readText(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf-8");
}

describe("P5.7-R24: vision skill-first", () => {
  it("vision-index 应明确系统只做预览摘要，并只保留原生看图 + 本地 LM Studio", () => {
    const content = readText("src/skills/runtime/vision-index/SKILL.md");
    expect(content).toContain("系统层只负责图片收取、落盘和预览摘要");
    expect(content).toContain("如果当前模型原生支持图片输入，优先直接继续看图");
    expect(content).toContain("~/.config/msgcode/skills/local-vision-lmstudio/SKILL.md");
    expect(content).toContain("不要假设所有 skill 都统一走 `main.sh` wrapper");
    expect(content).not.toContain("zai-vision-mcp");
    expect(content).not.toContain("统一视觉控制面");
  });

  it("local-vision-lmstudio wrapper 应直接转发到 runtime skill 自带脚本", () => {
    const content = readText("src/skills/runtime/local-vision-lmstudio/main.sh");
    expect(content).toContain('skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"');
    expect(content).toContain('script_path="$skill_dir/scripts/analyze_image.py"');
    expect(content).toContain('exec python3 "$script_path" "$@"');
    expect(content).not.toContain(".agents/skills/local-vision-lmstudio");
    expect(content).not.toContain(".codex/skills/local-vision-lmstudio");
  });

  it("runtime skill 索引不应再暴露 zai-vision-mcp", () => {
    const content = readText("src/skills/runtime/index.json");
    expect(content).not.toContain("zai-vision-mcp");
  });
});

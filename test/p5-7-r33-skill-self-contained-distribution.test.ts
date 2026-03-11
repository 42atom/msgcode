/**
 * msgcode: P5.7-R33 skill 自包含分发静态锁
 *
 * 目标：
 * - runtime/optional skills 必须以 repo 为真相源
 * - 不允许引用 ~/.agents ~/.codex ~/.claude 外部 skill 目录
 * - 不允许 skill 目录内出现 symlink
 */

import { describe, expect, it } from "bun:test";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const skillRoots = [
  join(root, "src", "skills", "runtime"),
  join(root, "src", "skills", "optional"),
];

const forbiddenPatterns = [
  ".agents/skills",
  ".codex/skills",
  ".claude/skills",
  "~/.agents",
  "~/.codex",
  "~/.claude",
];

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absPath = join(dir, entry.name);
    const stat = lstatSync(absPath);

    if (stat.isSymbolicLink()) {
      throw new Error(`skill 目录不允许 symlink: ${relative(root, absPath)}`);
    }

    if (entry.isDirectory()) {
      files.push(...walk(absPath));
      continue;
    }

    if (entry.isFile() && entry.name !== ".DS_Store") {
      files.push(absPath);
    }
  }

  return files;
}

describe("P5.7-R33: skill 自包含分发静态锁", () => {
  it("runtime/optional skills 不应引用外部 skill 目录", () => {
    const violations: string[] = [];

    for (const skillRoot of skillRoots) {
      for (const filePath of walk(skillRoot)) {
        const content = readFileSync(filePath, "utf-8");
        for (const pattern of forbiddenPatterns) {
          if (content.includes(pattern)) {
            violations.push(`${relative(root, filePath)} -> ${pattern}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("runtime/optional skills 目录内不应存在 symlink", () => {
    for (const skillRoot of skillRoots) {
      expect(() => walk(skillRoot)).not.toThrow();
    }
  });
});

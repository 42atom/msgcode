/**
 * msgcode: P5.7-R33 patchright-browser skill 合同回归锁
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readText(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf-8");
}

describe("P5.7-R33: patchright-browser skill 合同", () => {
  it("长文网页主链应优先复用 browser 返回的 textPath，不再写死 article 文件名", () => {
    const content = readText("src/skills/runtime/patchright-browser/SKILL.md");

    expect(content).toContain("textPath");
    expect(content).toContain("唯一文件名");
    expect(content).not.toContain("article.raw.txt");
    expect(content).not.toContain("article.md");
  });

  it("runtime 索引描述应与 textPath 主链一致", () => {
    const index = readText("src/skills/runtime/index.json");

    expect(index).toContain("tabs.text 返回的 textPath");
    expect(index).toContain("唯一文件名");
  });
});

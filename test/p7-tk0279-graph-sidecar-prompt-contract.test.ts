import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("tk0279: graph sidecar prompt contract", () => {
  it("agents prompt 应把 ts-graph-cli 定位为优先尝试的 sidecar，而不是强制控制层", () => {
    const promptPath = path.join(process.cwd(), "prompts", "agents-prompt.md");
    const content = fs.readFileSync(promptPath, "utf8");

    expect(content).toContain("scripts/ts-graph-cli.ts context");
    expect(content).toContain("scripts/ts-graph-cli.ts context` 或 `impact");
    expect(content).toContain("把它当成上下文先验，不当成裁决器");
    expect(content).toContain("再自然退回 `rg`、`read_file`、`bash`");
    expect(content).toContain("不要把它变成新的前置审批层");
  });
});

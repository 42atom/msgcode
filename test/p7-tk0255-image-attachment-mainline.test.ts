import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("tk0255: image attachment mainline contract and derived reason", () => {
  it("agent-backend 图片附件上下文应前置图片主链规则并保留 unavailable reason", async () => {
    const mod = await import(`../src/listener.js?case=tk0255-${Date.now()}`);
    const testApi = mod.__test;
    expect(testApi).toBeDefined();

    const attachmentText = [
      "[attachment]",
      "type=image",
      "mime=image/png",
      "path=/tmp/report.png",
      "digest=abc123",
      "[derived]",
      "kind=vision",
      "status=unavailable",
      "reason=tool not allowed: vision",
    ].join("\n");

    const content = testApi?.buildAgentAttachmentContext("帮我提取左眼数据", attachmentText) ?? "";

    expect(content).toContain("图片处理规则：");
    expect(content).toContain("禁止对图片附件路径使用 read_file");
    expect(content).toContain("若当前正式工具面未暴露 vision，先读 vision-index skill");
    expect(content).toContain("不要说“我没有视觉能力”");
    expect(content).toContain("图片处理状态：");
    expect(content).toContain("图片预处理: status=unavailable reason=tool not allowed: vision");
    expect(content).toContain("附件信息：");
    expect(content).toContain("附件 type=image mime=image/png path=/tmp/report.png digest=abc123");
  });

  it("listener 日志应记录派生文本 unavailable 的 reason", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src", "listener.ts"), "utf-8");

    expect(code).toContain("reason: pipelineResult.derived.reason ?? null");
    expect(code).toContain("error: pipelineResult.derived.error ?? null");
  });
});

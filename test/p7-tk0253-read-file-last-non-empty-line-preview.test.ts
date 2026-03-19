import { describe, expect, it } from "bun:test";
import { buildReadFilePreviewText } from "../src/tools/previews.js";

describe("tk0253: read_file truncated preview last non-empty line", () => {
  it("截断预览应显式暴露 tail 的最后一条非空行", () => {
    const tailLine = "TAIL-LINE-END tk0253";
    const preview = buildReadFilePreviewText({
      filePath: "/tmp/large.txt",
      byteLength: 80_000,
      truncated: true,
      content: [
        "[head]",
        "HEAD-LINE-START",
        "[... truncated 70000 bytes ...]",
        "[tail]",
        `${"A".repeat(200)}`,
        tailLine,
        "",
      ].join("\n"),
    });

    expect(preview).toContain("[lastNonEmptyLine]");
    expect(preview).toContain(tailLine);
    expect(preview).toContain("[tail]");
    expect(preview.length).toBeLessThanOrEqual(512);
  });
});

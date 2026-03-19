import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReadFileTool } from "../src/runners/file-tools.js";
import { buildReadFilePreviewText } from "../src/tools/previews.js";

describe("tk0252: read_file head-tail preview", () => {
  it("大文件截断预览同时保留 head 和 tail", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-tk0252-"));
    const filePath = join(workspacePath, "large.txt");
    const headLine = "HEAD-LINE-START";
    const tailLine = "TAIL-LINE-END";
    const body = `${headLine}\n${"A".repeat(80_000)}\n${tailLine}\n`;
    await writeFile(filePath, body, "utf-8");

    try {
      const result = await runReadFileTool({ path: filePath }, { workspacePath, timeoutMs: 30_000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.truncated).toBe(true);
      expect(result.content).toContain("[head]");
      expect(result.content).toContain("[tail]");
      expect(result.content).toContain(headLine);
      expect(result.content).toContain(tailLine);

      const preview = buildReadFilePreviewText({
        filePath: result.filePath,
        content: result.content,
        byteLength: result.byteLength,
        truncated: Boolean(result.truncated),
      });

      expect(preview).toContain("[head]");
      expect(preview).toContain("[tail]");
      expect(preview).toContain(headLine);
      expect(preview).toContain(tailLine);
      expect(preview.length).toBeLessThanOrEqual(512);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});


import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReadFileTool } from "../src/runners/file-tools.js";
import { buildReadFilePreviewText } from "../src/tools/previews.js";

describe("tk0252: read_file paginated preview", () => {
  it("大文件应返回连续分页而不是 head tail 拼接", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-tk0252-"));
    const filePath = join(workspacePath, "large.txt");
    const headLine = "HEAD-LINE-START";
    const middleLine = "PAGE-TWO-MARKER";
    const tailLine = "TAIL-LINE-END";
    const body = `${headLine}\n${"A".repeat(12_000)}\n${middleLine}\n${"B".repeat(72_000)}\n${tailLine}\n`;
    await writeFile(filePath, body, "utf-8");

    try {
      const result = await runReadFileTool({ path: filePath }, { workspacePath, timeoutMs: 30_000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.kind).toBe("text");
      expect(result.truncated).toBe(true);
      expect(result.offset).toBe(0);
      expect(result.limit).toBeGreaterThan(0);
      expect(result.hasMore).toBe(true);
      expect(result.nextOffset).toBeGreaterThan(0);
      expect(result.content).toContain(headLine);
      expect(result.content).not.toContain(tailLine);
      expect(result.content).not.toContain("[head]");
      expect(result.content).not.toContain("[tail]");

      const secondPage = await runReadFileTool(
        { path: filePath, offset: result.nextOffset ?? 0 },
        { workspacePath, timeoutMs: 30_000 }
      );
      expect(secondPage.ok).toBe(true);
      if (!secondPage.ok) return;

      expect(secondPage.kind).toBe("text");
      expect(secondPage.offset).toBe(result.nextOffset);
      expect(`${result.content}${secondPage.content}`).toContain(middleLine);
      expect(secondPage.content).not.toContain(headLine);

      const preview = buildReadFilePreviewText({
        filePath: result.filePath,
        content: result.content,
        byteLength: result.byteLength,
        totalBytes: result.totalBytes,
        offset: result.offset,
        limit: result.limit,
        hasMore: result.hasMore,
        nextOffset: result.nextOffset,
        kind: result.kind,
        truncated: Boolean(result.truncated),
      });

      expect(preview).toContain("[status] paginated");
      expect(preview).toContain("[nextOffset]");
      expect(preview).toContain(headLine);
      expect(preview).not.toContain("[head]");
      expect(preview).not.toContain("[tail]");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

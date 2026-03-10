import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { resetModelServiceLeaseManager } from "../src/runtime/model-service-lease.js";

function writeTinyPng(filePath: string): void {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0fcAAAAASUVORK5CYII=";
  writeFileSync(filePath, Buffer.from(pngBase64, "base64"));
}

function asJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("P5.7-R23: vision 主链收口", () => {
  let workspacePath = "";
  let imagePath = "";
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    workspacePath = join(tmpdir(), `msgcode-vision-${randomUUID()}`);
    imagePath = join(workspacePath, "table.png");
    mkdirSync(workspacePath, { recursive: true });
    writeTinyPng(imagePath);
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    mock.restore();
    globalThis.fetch = originalFetch;
    await resetModelServiceLeaseManager();
    if (workspacePath && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("自动图片摘要主链不应偷用用户提问做预处理", async () => {
    const listenerCode = fs.readFileSync(join(process.cwd(), "src", "listener.ts"), "utf-8");
    const pipelineCode = fs.readFileSync(join(process.cwd(), "src", "media", "pipeline.ts"), "utf-8");

    expect(listenerCode).toContain("processAttachment(copyResult.localPath, attachment, workspacePath)");
    expect(listenerCode).not.toContain("processAttachment(copyResult.localPath, attachment, workspacePath, text)");
    expect(listenerCode).not.toContain("请用一句话概括主要内容。");
    expect(pipelineCode).toContain('executeTool("vision", { imagePath: vaultPath }');
    expect(pipelineCode).not.toContain("userQuery");
    expect(pipelineCode).toContain('kind: "vision"');
  });

  it("用户带任务调用 vision 时，不应被摘要缓存污染", async () => {
    const digest = createHash("sha256").update(await readFile(imagePath)).digest("hex").slice(0, 12);
    const visionDir = join(workspacePath, "artifacts", "vision");
    mkdirSync(visionDir, { recursive: true });
    const summaryPath = join(visionDir, `${digest}.txt`);
    writeFileSync(summaryPath, "这是一张表格截图。", "utf-8");

    const prompts: string[] = [];
    const maxTokens: number[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const prompt = body?.messages?.[0]?.content?.[0]?.text;
      if (typeof prompt === "string") {
        prompts.push(prompt);
      }
      if (typeof body?.max_tokens === "number") {
        maxTokens.push(body.max_tokens);
      }
      return asJsonResponse({
        choices: [
          {
            message: {
              content: "List of Liquids\nFreezing Point\nVaporization Point",
            },
          },
        ],
      });
    }) as typeof globalThis.fetch;

    const { runVision } = await import("../src/runners/vision.js");

    const result = await runVision({
      workspacePath,
      imagePath,
      userQuery: "请提取图片中的表格文字并尽量保留结构",
    });

    expect(result.success).toBe(true);
    expect(result.textPreview).toContain("List of Liquids");
    expect(result.textPath).toContain(".q-");
    expect(result.textPath).not.toBe(summaryPath);
    expect(prompts).toHaveLength(1);
    expect(maxTokens).toEqual([2048]);
    expect(prompts[0]).toContain("用户要求：请提取图片中的表格文字并尽量保留结构");
    expect(prompts[0]).not.toContain("一句话说清楚");
    expect(prompts[0]).not.toContain("用一句话简洁描述");
  });

  it("无用户任务时，应继续复用摘要缓存", async () => {
    const digest = createHash("sha256").update(await readFile(imagePath)).digest("hex").slice(0, 12);
    const visionDir = join(workspacePath, "artifacts", "vision");
    mkdirSync(visionDir, { recursive: true });
    const summaryPath = join(visionDir, `${digest}.txt`);
    writeFileSync(summaryPath, "这是一张表格截图。", "utf-8");

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return asJsonResponse({
        choices: [{ message: { content: "unexpected" } }],
      });
    }) as typeof globalThis.fetch;

    const { runVision } = await import("../src/runners/vision.js");

    const result = await runVision({
      workspacePath,
      imagePath,
    });

    expect(result.success).toBe(true);
    expect(result.textPath).toBe(summaryPath);
    expect(result.textPreview).toBe("这是一张表格截图。");
    expect(fetchCalls).toBe(0);
  });
});

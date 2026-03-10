import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runLmStudioToolLoop } from "../src/lmstudio.js";

const tempWorkspaces: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const workspaceId = `tool-result-clip-${randomUUID().slice(0, 8)}`;
  const workspacePath = join(process.env.TMPDIR || "/tmp", workspaceId);
  await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
  await writeFile(
    join(workspacePath, ".msgcode", "config.json"),
    JSON.stringify({
      "pi.enabled": true,
      "tooling.mode": "autonomous",
      "tooling.allow": ["read_file"],
      "tooling.require_confirm": [],
    }, null, 2),
    "utf-8",
  );
  tempWorkspaces.push(workspacePath);
  return workspacePath;
}

afterEach(async () => {
  for (const workspacePath of tempWorkspaces) {
    await rm(workspacePath, { recursive: true, force: true });
  }
  tempWorkspaces.length = 0;
});

describe("P5.7-R25: tool_result 上下文截断", () => {
  it("openai 兼容路径应截断大 read_file 结果后再回灌给模型", async () => {
    const workspacePath = await createTempWorkspace();
    const targetPath = join(workspacePath, "large.txt");
    await writeFile(targetPath, "A".repeat(12_000), "utf-8");

    const originalFetch = globalThis.fetch;
    let callCount = 0;
    let observedToolContent = "";

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const body = init && typeof init.body === "string"
        ? JSON.parse(init.body)
        : {};

      if (callCount === 1) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call_read_large",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: targetPath }),
                },
              }],
            },
            finish_reason: "tool_calls",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      const toolMessage = Array.isArray(body.messages)
        ? body.messages.find((msg: Record<string, unknown>) => msg.role === "tool")
        : undefined;
      observedToolContent = typeof toolMessage?.content === "string" ? toolMessage.content : "";

      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: "ok",
          },
          finish_reason: "stop",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const result = await runLmStudioToolLoop({
        baseUrl: "http://127.0.0.1:1234",
        model: "test-model",
        prompt: "读取大文件",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: {
          id: "local-openai",
          baseUrl: "http://127.0.0.1:1234",
          model: "test-model",
          timeoutMs: 10_000,
          nativeApiEnabled: false,
        },
      });

      expect(result.answer).toContain("ok");
      expect(observedToolContent.length).toBeLessThanOrEqual(4003);
      expect(observedToolContent.endsWith("...")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("minimax anthropic 路径也应复用同一截断函数", () => {
    const code = readFileSync(
      join(process.cwd(), "src", "agent-backend", "tool-loop.ts"),
      "utf-8",
    );

    expect(code).toContain("const TOOL_RESULT_CONTEXT_MAX_CHARS = 4000");
    expect(code).toContain("function serializeToolResultForConversation");
    expect(code).toContain("content: serializeToolResultForConversation(result)");
  });
});

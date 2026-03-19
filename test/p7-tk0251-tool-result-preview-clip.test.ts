import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLmStudioToolLoop } from "../src/lmstudio.js";
import type { MiniMaxMessagesResponse } from "./helpers/minimax-anthropic.js";

const localOpenAiRuntime = {
  id: "local-openai" as const,
  baseUrl: "http://127.0.0.1:1234",
  model: "test-model",
  timeoutMs: 10_000,
  nativeApiEnabled: false,
};

const minimaxRuntime = {
  id: "minimax" as const,
  baseUrl: "https://api.minimax.chat/v1",
  apiKey: "test-minimax-key",
  model: "MiniMax-Text-01",
  timeoutMs: 10_000,
  nativeApiEnabled: false,
};

type ChatCompletionPayload = {
  choices: Array<{
    message: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
};

function asJsonResponse(payload: ChatCompletionPayload | MiniMaxMessagesResponse): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function createToolEnabledWorkspace(): Promise<{ workspacePath: string; hugeFilePath: string }> {
  const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-tk0251-"));
  await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
  await writeFile(
    join(workspacePath, ".msgcode", "config.json"),
    JSON.stringify({
      "tooling.mode": "autonomous",
      "tooling.allow": ["read_file"],
      "tooling.require_confirm": [],
    }, null, 2),
    "utf-8"
  );
  const hugeFilePath = join(workspacePath, "huge.txt");
  await writeFile(hugeFilePath, `${"A".repeat(7000)}\nTAIL-MARKER-SHOULD-NOT-LEAK`, "utf-8");
  return { workspacePath, hugeFilePath };
}

describe("tk0251: tool result preview clip", () => {
  it("OpenAI tool result replay clips oversized previewText", async () => {
    const originalFetch = globalThis.fetch;
    const { workspacePath, hugeFilePath } = await createToolEnabledWorkspace();
    let callCount = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};

      if (callCount === 1) {
        return asJsonResponse({
          choices: [{
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call_read_big_file",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: hugeFilePath }),
                },
              }],
            },
            finish_reason: "tool_calls",
          }],
        });
      }

      const secondMessages = body.messages as Array<Record<string, unknown>>;
      const toolMessage = secondMessages.findLast((message) => message.role === "tool");
      const replayed = String(toolMessage?.content || "");
      expect(replayed.length).toBeLessThanOrEqual(515);
      expect(replayed).not.toContain("TAIL-MARKER-SHOULD-NOT-LEAK");
      expect(replayed).toContain("...");

      return asJsonResponse({
        choices: [{
          message: {
            role: "assistant",
            content: "OpenAI preview clipped",
          },
          finish_reason: "stop",
        }],
      });
    }) as typeof fetch;

    try {
      const result = await runLmStudioToolLoop({
        baseUrl: "http://127.0.0.1:1234",
        model: "test-model",
        prompt: "读取大文件但回灌只给预览",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: localOpenAiRuntime,
      });

      expect(callCount).toBe(2);
      expect(result.answer).toContain("OpenAI preview clipped");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("MiniMax tool result replay clips oversized previewText", async () => {
    const originalFetch = globalThis.fetch;
    const { workspacePath, hugeFilePath } = await createToolEnabledWorkspace();
    let callCount = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};

      if (callCount === 1) {
        return asJsonResponse({
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "toolu_read_big_file",
            name: "read_file",
            input: { path: hugeFilePath },
          }],
          stop_reason: "tool_use",
        } satisfies MiniMaxMessagesResponse);
      }

      const secondMessages = body.messages as Array<Record<string, unknown>>;
      const userReplay = secondMessages[secondMessages.length - 1];
      const userBlocks = userReplay?.content as Array<Record<string, unknown>>;
      const replayed = String(userBlocks[0]?.content || "");
      expect(replayed.length).toBeLessThanOrEqual(515);
      expect(replayed).not.toContain("TAIL-MARKER-SHOULD-NOT-LEAK");
      expect(replayed).toContain("...");

      return asJsonResponse({
        role: "assistant",
        content: [{ type: "text", text: "MiniMax preview clipped" }],
        stop_reason: "end_turn",
      } satisfies MiniMaxMessagesResponse);
    }) as typeof fetch;

    try {
      const result = await runLmStudioToolLoop({
        prompt: "读取大文件但回灌只给预览",
        workspacePath,
        backendRuntime: minimaxRuntime,
        timeoutMs: 10_000,
      });

      expect(callCount).toBe(2);
      expect(result.answer).toContain("MiniMax preview clipped");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

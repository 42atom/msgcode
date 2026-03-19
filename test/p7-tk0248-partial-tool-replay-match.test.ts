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

async function createToolEnabledWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-tk0248-"));
  await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
  await writeFile(
    join(workspacePath, ".msgcode", "config.json"),
    JSON.stringify({
      "tooling.mode": "autonomous",
      "tooling.allow": ["bash", "read_file", "write_file", "edit_file"],
      "tooling.require_confirm": [],
    }, null, 2),
    "utf-8"
  );
  return workspacePath;
}

describe("tk0248: partial tool replay match contract", () => {
  it("OpenAI replay 只应带上已执行的 tool_calls", async () => {
    const originalFetch = globalThis.fetch;
    const workspacePath = await createToolEnabledWorkspace();
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
              tool_calls: [
                {
                  id: "call_fail_first",
                  type: "function",
                  function: {
                    name: "bash",
                    arguments: JSON.stringify({ command: "this_command_should_not_exist_12345" }),
                  },
                },
                {
                  id: "call_never_replayed",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({ path: ".msgcode/should-not-run.txt" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          }],
        });
      }

      const secondMessages = body.messages as Array<Record<string, unknown>>;
      const assistantReplay = secondMessages.findLast((message) => message.role === "assistant");
      const replayedToolCalls = assistantReplay?.tool_calls as Array<Record<string, unknown>>;
      expect(replayedToolCalls).toHaveLength(1);
      expect(replayedToolCalls[0]?.id).toBe("call_fail_first");

      const toolMessages = secondMessages.filter((message) => message.role === "tool");
      expect(toolMessages).toHaveLength(1);
      expect(toolMessages[0]?.tool_call_id).toBe("call_fail_first");

      return asJsonResponse({
        choices: [{
          message: {
            role: "assistant",
            content: "OpenAI partial replay ok",
          },
          finish_reason: "stop",
        }],
      });
    }) as typeof fetch;

    try {
      const result = await runLmStudioToolLoop({
        baseUrl: "http://127.0.0.1:1234",
        model: "test-model",
        prompt: "第一把工具失败，第二把不应被回灌",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: localOpenAiRuntime,
      });

      expect(callCount).toBe(2);
      expect(result.answer).toContain("OpenAI partial replay ok");
      expect(result.actionJournal.map((entry) => `${entry.tool}:${entry.ok}`)).toEqual(["bash:false"]);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("MiniMax replay 只应带上已执行的 tool_use", async () => {
    const originalFetch = globalThis.fetch;
    const workspacePath = await createToolEnabledWorkspace();
    let callCount = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};

      if (callCount === 1) {
        return asJsonResponse({
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_fail_first",
              name: "bash",
              input: { command: "sh -c \"echo minimax-partial >&2; exit 7\"" },
            },
            {
              type: "tool_use",
              id: "toolu_never_replayed",
              name: "read_file",
              input: { path: ".msgcode/never.txt" },
            },
          ],
          stop_reason: "tool_use",
        } satisfies MiniMaxMessagesResponse);
      }

      const secondMessages = body.messages as Array<Record<string, unknown>>;
      const assistantReplay = secondMessages[secondMessages.length - 2];
      const assistantBlocks = assistantReplay?.content as Array<Record<string, unknown>>;
      expect(assistantReplay?.role).toBe("assistant");
      expect(assistantBlocks.filter((block) => block.type === "tool_use")).toHaveLength(1);
      expect(assistantBlocks.find((block) => block.type === "tool_use")?.id).toBe("toolu_fail_first");

      const userReplay = secondMessages[secondMessages.length - 1];
      const userBlocks = userReplay?.content as Array<Record<string, unknown>>;
      expect(userReplay?.role).toBe("user");
      expect(userBlocks).toHaveLength(1);
      expect(userBlocks[0]?.type).toBe("tool_result");
      expect(userBlocks[0]?.tool_use_id).toBe("toolu_fail_first");

      return asJsonResponse({
        role: "assistant",
        content: [
          { type: "text", text: "MiniMax partial replay ok" },
        ],
        stop_reason: "end_turn",
      } satisfies MiniMaxMessagesResponse);
    }) as typeof fetch;

    try {
      const result = await runLmStudioToolLoop({
        prompt: "第一把失败，第二把不应被回灌",
        workspacePath,
        backendRuntime: minimaxRuntime,
        timeoutMs: 10_000,
      });

      expect(callCount).toBe(2);
      expect(result.answer).toContain("MiniMax partial replay ok");
      expect(result.actionJournal.map((entry) => `${entry.tool}:${entry.ok}`)).toEqual(["bash:false"]);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

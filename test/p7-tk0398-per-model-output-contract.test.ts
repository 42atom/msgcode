import { afterEach, describe, expect, it } from "bun:test";

import {
  resolveAgentModelOutputContract,
  resolveTmuxModelOutputContract,
  runAgentChat,
  type AgentBackendRuntime,
} from "../src/agent-backend/index.js";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("tk0398: per-model output contract baseline", () => {
  it("应按 backend runtime 解析 agent 合同", () => {
    expect(resolveAgentModelOutputContract({ id: "minimax" }).modelSelector).toBe("agent:minimax");
    expect(resolveAgentModelOutputContract({ id: "openai" }).modelSelector).toBe("agent:openai-compat");
    expect(resolveAgentModelOutputContract({ id: "local-openai" }).parse.parserKind).toBe("openai-compat-tool-call");
  });

  it("应按 tmux runner 解析 parser 合同", () => {
    expect(resolveTmuxModelOutputContract("codex").parse.parserKind).toBe("codex-jsonl");
    expect(resolveTmuxModelOutputContract("claude-code").parse.parserKind).toBe("assistant-jsonl");
    expect(resolveTmuxModelOutputContract("claude").parse.completionSignal).toBe("stop-hook-summary");
  });

  it("openai-compatible request 应显式绑定 max_tokens 与 stop", async () => {
    const runtime: AgentBackendRuntime = {
      id: "openai",
      baseUrl: "https://api.openai.test",
      apiKey: "test-key",
      model: "gpt-test",
      timeoutMs: 10_000,
      nativeApiEnabled: false,
    };
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return new Response(JSON.stringify({
        choices: [
          {
            message: { content: "compat ok" },
            finish_reason: "stop",
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const answer = await runAgentChat({
      prompt: "直接回答",
      system: "测试系统提示",
      backendRuntime: runtime,
    });

    expect(answer).toBe("compat ok");
    expect(capturedBody.model).toBe("gpt-test");
    expect(capturedBody.max_tokens).toBeNumber();
    expect(capturedBody.stop).toEqual([]);
  });

  it("minimax request 应继续走 anthropic content 协议，不注入 stop", async () => {
    const runtime: AgentBackendRuntime = {
      id: "minimax",
      baseUrl: "https://api.minimax.test/anthropic",
      apiKey: "test-key",
      model: "MiniMax-M2.5",
      timeoutMs: 10_000,
      nativeApiEnabled: false,
    };
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return new Response(JSON.stringify({
        role: "assistant",
        content: [
          { type: "text", text: "minimax ok" },
        ],
        stop_reason: "end_turn",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const answer = await runAgentChat({
      prompt: "直接回答",
      system: "测试系统提示",
      backendRuntime: runtime,
    });

    expect(answer).toBe("minimax ok");
    expect(capturedBody.model).toBe("MiniMax-M2.5");
    expect(capturedBody.max_tokens).toBeNumber();
    expect(capturedBody).not.toHaveProperty("stop");
  });
});

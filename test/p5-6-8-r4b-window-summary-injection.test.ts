import { afterEach, describe, expect, it } from "bun:test";
import {
  buildConversationContextBlocks,
  buildDialogPromptWithContext,
  runAgentToolLoop,
  type AgentBackendRuntime,
} from "../src/agent-backend/index.js";

describe("P5.6.8-R4b: window/summary 注入回归锁", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("buildConversationContextBlocks 应按 summary/window 预算裁剪上下文", () => {
    const result = buildConversationContextBlocks({
      summaryContext: "摘要".repeat(40),
      windowMessages: [
        { role: "user", content: "第 1 条消息，长度较长，需要被裁剪处理。" },
        { role: "assistant", content: "第 2 条回答，应该保留在最近窗口里。" },
        { role: "user", content: "第 3 条问题，必须优先保留，因为它离当前轮次最近。" },
      ],
      budget: {
        maxSummaryChars: 30,
        maxWindowMessages: 2,
        maxWindowChars: 60,
        maxTotalContextChars: 90,
        maxMessageChars: 20,
      },
    });

    expect(result.summaryText).toBeDefined();
    expect(result.summaryText!.length).toBeLessThanOrEqual(30);
    expect(result.windowMessages).toHaveLength(2);
    expect(result.windowMessages[0]?.role).toBe("assistant");
    expect(result.windowMessages[1]?.role).toBe("user");
    expect(result.windowMessages[1]?.content).toContain("第 3 条问");
    expect(result.usedChars).toBeLessThanOrEqual(90);
  });

  it("buildDialogPromptWithContext 应保持 workstate -> summary -> window -> user 顺序", () => {
    const prompt = buildDialogPromptWithContext({
      prompt: "请继续回答当前问题",
      workstateContext: "当前意图：先恢复工作态",
      summaryContext: "这里是历史摘要",
      windowMessages: [
        { role: "user", content: "上一轮用户提问" },
        { role: "assistant", content: "上一轮助手回答" },
      ],
    });

    const workstateIndex = prompt.indexOf("[当前工作态骨架]");
    const summaryIndex = prompt.indexOf("[历史对话摘要]");
    const windowIndex = prompt.indexOf("[最近对话窗口]");
    const userIndex = prompt.indexOf("[当前用户问题]");

    expect(workstateIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThan(workstateIndex);
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(windowIndex).toBeGreaterThan(summaryIndex);
    expect(userIndex).toBeGreaterThan(windowIndex);
    expect(prompt).toContain("当前意图：先恢复工作态");
    expect(prompt).toContain("[user] 上一轮用户提问");
    expect(prompt).toContain("[assistant] 上一轮助手回答");
    expect(prompt).toContain("请继续回答当前问题");
  });

  it("runAgentToolLoop 应把 summary/window 真实注入发给模型的 messages", async () => {
    const capturedBodies: Array<{ messages?: Array<{ role: string; content?: string }> }> = [];

    globalThis.fetch = async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "最终答复",
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    };

    const backendRuntime: AgentBackendRuntime = {
      id: "openai",
      baseUrl: "http://unit-test.local",
      apiKey: "test-key",
      model: "unit-test-model",
      timeoutMs: 500,
      nativeApiEnabled: false,
    };

    const result = await runAgentToolLoop({
      prompt: "当前用户问题",
      summaryContext: "这里是历史摘要",
      windowMessages: [
        { role: "user", content: "上轮用户问题" },
        { role: "assistant", content: "上轮助手回答" },
      ],
      backendRuntime,
      model: "unit-test-model",
      tools: [],
      timeoutMs: 500,
    });

    expect(result.answer).toBe("最终答复");
    expect(capturedBodies).toHaveLength(1);

    const messages = capturedBodies[0]?.messages ?? [];
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toContain("[历史对话摘要]");
    expect(messages[1]?.content).toContain("这里是历史摘要");
    expect(messages[2]).toEqual({ role: "user", content: "上轮用户问题" });
    expect(messages[3]).toEqual({ role: "assistant", content: "上轮助手回答" });
    expect(messages[4]).toEqual({ role: "user", content: "当前用户问题" });
  });

  it("runAgentToolLoop 应把 workstate 放在 summary 前注入", async () => {
    const capturedBodies: Array<{ messages?: Array<{ role: string; content?: string }> }> = [];

    globalThis.fetch = async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "最终答复",
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    };

    const backendRuntime: AgentBackendRuntime = {
      id: "openai",
      baseUrl: "http://unit-test.local",
      apiKey: "test-key",
      model: "unit-test-model",
      timeoutMs: 500,
      nativeApiEnabled: false,
    };

    await runAgentToolLoop({
      prompt: "当前用户问题",
      workstateContext: "当前意图：先恢复工作骨架",
      summaryContext: "这里是历史摘要",
      windowMessages: [
        { role: "user", content: "上轮用户问题" },
        { role: "assistant", content: "上轮助手回答" },
      ],
      backendRuntime,
      model: "unit-test-model",
      tools: [],
      timeoutMs: 500,
    });

    const messages = capturedBodies[0]?.messages ?? [];
    expect(messages[1]?.content).toContain("[当前工作态骨架]");
    expect(messages[1]?.content).toContain("当前意图：先恢复工作骨架");
    expect(messages[2]?.content).toContain("[历史对话摘要]");
  });
});

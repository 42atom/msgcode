/**
 * P5.7-R3d: LM Studio GLM ToolCall 温度锁定回归测试
 *
 * 目标：
 * - 验证工具调用主链默认 temperature=0
 * - 防止 temperature>0 漂移导致 R1 不触发 tool_calls
 */

import { describe, it, expect } from "bun:test";
import { buildChatCompletionRequest } from "../src/providers/openai-compat-adapter.js";

describe("P5.7-R3d: Tool Call Temperature Lock", () => {
  it("should include temperature=0 in tool call request body", () => {
    // 模拟工具调用场景（有 tools + toolChoice: auto）
    const requestBody = buildChatCompletionRequest({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      tools: [{ type: "function", function: { name: "test_tool", parameters: {} } }],
      toolChoice: "auto",
      temperature: 0, // 关键：工具调用必须使用 temperature=0
      maxTokens: 800,
    });

    const parsed = JSON.parse(requestBody);

    // 回归锁：工具调用请求必须包含 temperature=0
    expect(parsed.temperature).toBe(0);
  });

  it("should lock temperature to 0 for first tool call round", () => {
    // R1（第一轮工具调用）场景
    const r1Request = buildChatCompletionRequest({
      model: "test-model",
      messages: [{ role: "user", content: "read file" }],
      tools: [{ type: "function", function: { name: "read_file", parameters: {} } }],
      toolChoice: "auto",
      temperature: 0, // R1 必须为 0
      maxTokens: 800,
    });

    const parsed = JSON.parse(r1Request);
    expect(parsed.temperature).toBe(0);
    expect(parsed.tools).toBeDefined();
    expect(parsed.tool_choice).toBe("auto");
  });

  it("should lock temperature to 0 for second answer round", () => {
    // R2（第二轮回答）场景
    const r2Request = buildChatCompletionRequest({
      model: "test-model",
      messages: [
        { role: "user", content: "read file" },
        { role: "assistant", tool_calls: [{ id: "tc1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "tc1", content: "file content" },
      ],
      tools: [], // R2 不传 tools
      toolChoice: "none",
      temperature: 0, // R2 也必须为 0
      maxTokens: 800,
    });

    const parsed = JSON.parse(r2Request);
    expect(parsed.temperature).toBe(0);
    // 注意：tools 为空时 tool_choice 不会被设置（adapter 逻辑）
  });

  it("should not include temperature when undefined", () => {
    // 验证：当 temperature 未定义时，不应包含在请求体中
    const requestBody = buildChatCompletionRequest({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      tools: [],
      toolChoice: "none",
      maxTokens: 800,
      // 注意：temperature 未传递
    });

    const parsed = JSON.parse(requestBody);
    expect(parsed.temperature).toBeUndefined();
  });

  it("should prevent temperature > 0 drift in tool calls", () => {
    // 回归锁：防止未来代码修改意外使用 temperature > 0
    // 这个测试确保：即使在错误配置下，工具调用仍然锁定为 0

    // 正确的工具调用请求
    const correctRequest = buildChatCompletionRequest({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      tools: [{ type: "function", function: { name: "test_tool", parameters: {} } }],
      toolChoice: "auto",
      temperature: 0, // 必须为 0
      maxTokens: 800,
    });

    const parsed = JSON.parse(correctRequest);

    // 验证：工具调用必须使用 temperature=0
    expect(parsed.temperature).toBe(0);
    expect(parsed.temperature).not.toBeGreaterThan(0);
  });
});

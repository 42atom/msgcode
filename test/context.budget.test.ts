/**
 * msgcode: Budget Layer BDD 测试
 *
 * 测试场景：
 * - Scenario A: 预算计算正确性
 * - Scenario B: 分区比例正确
 * - Scenario C: Token 估算功能
 * - Scenario D: 超预算裁剪顺序
 * - Scenario E: 回退路径（count-based）
 * - Scenario F: 预算摘要
 */

import { describe, test, expect } from "bun:test";
import type { WindowMessage } from "../src/session-window";

describe("Budget Layer", () => {
  describe("Scenario A: 预算计算", () => {
    test("应该正确计算输入预算（contextWindow - reservedOutput）", async () => {
      const { getCapabilities, getInputBudget } = await import("../src/capabilities");

      const caps = getCapabilities("mlx");
      expect(caps.contextWindowTokens).toBe(16384);  // MLX 实用上限 16k
      expect(caps.reservedOutputTokens).toBe(2048);  // 预留更多输出空间

      const inputBudget = getInputBudget("mlx");
      expect(inputBudget).toBe(14336); // 16384 - 2048
    });

    test("未知 target 应该返回安全默认值", async () => {
      const { getCapabilities } = await import("../src/capabilities");

      const caps = getCapabilities("unknown" as any);
      expect(caps.contextWindowTokens).toBe(4096);   // 保守降级
      expect(caps.reservedOutputTokens).toBe(1024);
      expect(caps.charsPerToken).toBe(2);
    });
  });

  describe("Scenario B: 分区比例", () => {
    test("应该按正确比例分配预算", async () => {
      const { computeInputBudget, allocateSections } = await import("../src/budget");
      const { getCapabilities } = await import("../src/capabilities");

      const caps = getCapabilities("mlx");
      const inputBudget = computeInputBudget(caps);
      const allocation = allocateSections(inputBudget);

      // 验证比例：system 10%, summary 20%, recent 50%, current 20%
      expect(allocation.system).toBe(Math.floor(inputBudget * 0.10));
      expect(allocation.summary).toBe(Math.floor(inputBudget * 0.20));
      expect(allocation.recent).toBe(Math.floor(inputBudget * 0.50));
      expect(allocation.current).toBe(Math.floor(inputBudget * 0.20));

      // 验证总和不超过 inputBudget（由于 floor 可能略有差异）
      const total = allocation.system + allocation.summary + allocation.recent + allocation.current;
      expect(total).toBeLessThanOrEqual(inputBudget);
    });

    test("应该可以使用自定义比例", async () => {
      const { allocateSections } = await import("../src/budget");

      const allocation = allocateSections(1000, {
        system: 0.20,
        summary: 0.30,
        recent: 0.30,
        current: 0.20,
      });

      expect(allocation.system).toBe(200);
      expect(allocation.summary).toBe(300);
      expect(allocation.recent).toBe(300);
      expect(allocation.current).toBe(200);
    });
  });

  describe("Scenario C: Token 估算", () => {
    test("应该正确估算简单消息的 token 数", async () => {
      const { estimateMessageTokens } = await import("../src/budget");

      const message: WindowMessage = {
        role: "user",
        content: "Hello, world!",
      };

      const tokens = estimateMessageTokens(message);
      // "Hello, world!" = 13 chars, "user" = 4 chars, total ~17 / 2 = 8.5 -> 9
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });

    test("应该正确估算带 tool_calls 的消息", async () => {
      const { estimateMessageTokens } = await import("../src/budget");

      const message: WindowMessage = {
        role: "assistant",
        content: "I'll help you.",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "shell",
              arguments: JSON.stringify({ command: "ls" }),
            },
          },
        ],
      };

      const tokens = estimateMessageTokens(message);
      // Should be higher than simple message due to tool_calls
      expect(tokens).toBeGreaterThan(10);
    });

    test("应该正确估算消息数组的总 token 数", async () => {
      const { estimateTotalTokens } = await import("../src/budget");

      const messages: WindowMessage[] = [
        { role: "user", content: "First message" },
        { role: "assistant", content: "First response" },
        { role: "user", content: "Second message" },
      ];

      const total = estimateTotalTokens(messages);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeGreaterThan(estimateTotalTokens([messages[0]]));
    });
  });

  describe("Scenario D: 超预算裁剪顺序", () => {
    test("应该优先保留最近的 user 消息", async () => {
      const { trimByBudget } = await import("../src/budget");

      const messages: WindowMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i} with some content to use tokens`,
        });
      }

      // Set a very low budget to force aggressive trimming
      const result = trimByBudget(messages, 50); // ~50 tokens

      expect(result.trimmed).toBe(true);
      expect(result.messages.length).toBeLessThan(messages.length);

      // Last message should be kept (index 19 is assistant, so we check for most recent)
      const lastMsg = result.messages[result.messages.length - 1];
      // With 20 messages, index 19 is assistant (19 % 2 = 1)
      expect(lastMsg.content).toContain("19");

      // Most recent user message (index 18) should also be kept
      const userMsgs = result.messages.filter((m) => m.role === "user");
      const lastUser = userMsgs[userMsgs.length - 1];
      expect(lastUser.content).toContain("18");
    });

    test("应该优先保留 tool 结果消息", async () => {
      const { trimByBudget } = await import("../src/budget");

      const messages: WindowMessage[] = [
        { role: "user", content: "Execute command" },
        { role: "assistant", content: "I'll do it", tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "Result data here" },
        { role: "assistant", content: "Done" },
      ];

      const result = trimByBudget(messages, 20); // Low budget

      expect(result.trimmed).toBe(true);

      // Tool message should be kept (high priority)
      const hasToolMsg = result.messages.some((m) => m.role === "tool");
      expect(hasToolMsg).toBe(true);
    });

    test("应该保持消息顺序不变", async () => {
      const { trimByBudget } = await import("../src/budget");

      const messages: WindowMessage[] = [
        { role: "user", content: "First" },
        { role: "assistant", content: "Response 1" },
        { role: "user", content: "Second" },
        { role: "assistant", content: "Response 2" },
        { role: "user", content: "Third (most recent)" },
      ];

      const result = trimByBudget(messages, 30);

      // Check order is preserved
      for (let i = 1; i < result.messages.length; i++) {
        const prevContent = result.messages[i - 1].content || "";
        const currContent = result.messages[i].content || "";

        // Verify the order matches original sequence
        const prevIndex = messages.findIndex((m) => m.content === prevContent);
        const currIndex = messages.findIndex((m) => m.content === currContent);
        expect(currIndex).toBeGreaterThan(prevIndex);
      }
    });
  });

  describe("Scenario E: 回退路径", () => {
    test("预算裁剪失败时应该回退到 count-based", async () => {
      const { trimMessagesByBudget } = await import("../src/budget");

      const messages: WindowMessage[] = [];
      for (let i = 0; i < 30; i++) {
        messages.push({ role: "user", content: `Message ${i}` });
      }

      // This should use budget-based trim, but if it fails, fall back to count-based
      const result = trimMessagesByBudget(messages, 100, 20);

      // Should have at most 20 messages (count-based fallback)
      expect(result.length).toBeLessThanOrEqual(20);
    });

    test("未超预算时不应裁剪", async () => {
      const { trimByBudget } = await import("../src/budget");

      const messages: WindowMessage[] = [
        { role: "user", content: "Short" },
        { role: "assistant", content: "Response" },
      ];

      const result = trimByBudget(messages, 1000); // High budget

      expect(result.trimmed).toBe(false);
      expect(result.messages).toEqual(messages);
    });
  });

  describe("Scenario F: 预算摘要", () => {
    test("应该生成正确的预算摘要", async () => {
      const { getBudgetSummary, allocateSections } = await import("../src/budget");

      const messages: WindowMessage[] = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];

      const { getCapabilities } = await import("../src/capabilities");
      const caps = getCapabilities("mlx");
      const inputBudget = caps.contextWindowTokens - caps.reservedOutputTokens;
      const allocation = allocateSections(inputBudget);

      const summary = getBudgetSummary(messages, allocation);

      expect(summary.estimated.total).toBeGreaterThan(0);
      expect(summary.allocation).toEqual(allocation);
      expect(summary.withinBudget).toBe(true); // Short messages should be within budget
    });

    test("超预算时应该标记 withinBudget=false", async () => {
      const { getBudgetSummary, allocateSections } = await import("../src/budget");

      // Create a very long message that exceeds budget
      const longContent = "A".repeat(50000); // ~25000 tokens（超过 14336 预算）
      const messages: WindowMessage[] = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: longContent },
      ];

      const { getCapabilities } = await import("../src/capabilities");
      const caps = getCapabilities("mlx");
      const inputBudget = caps.contextWindowTokens - caps.reservedOutputTokens;
      const allocation = allocateSections(inputBudget);

      const summary = getBudgetSummary(messages, allocation);

      expect(summary.estimated.total).toBeGreaterThan(summary.allocation.total);
      expect(summary.withinBudget).toBe(false);
    });
  });
});

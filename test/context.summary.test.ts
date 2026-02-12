/**
 * msgcode: Summary Compression Layer BDD 测试
 *
 * 测试场景：
 * - Scenario A: 摘要提取规则（约束、决策、工具事实）
 * - Scenario B: 摘要格式与解析
 * - Scenario C: 摘要存储加载
 * - Scenario D: 摘要生成触发条件
 * - Scenario E: 上下文拼装（system + summary + recent）
 * - Scenario F: 无摘要时兼容老流程
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import type { WindowMessage } from "../src/session-window";

describe("Summary Layer", () => {
  let tempWorkspace: string;
  let testChatId: string;

  beforeEach(() => {
    tempWorkspace = join(tmpdir(), `msgcode-test-${randomUUID()}`);
    mkdirSync(tempWorkspace, { recursive: true });
    testChatId = `test-chat-${randomUUID()}`;
  });

  afterEach(() => {
    if (existsSync(tempWorkspace)) {
      rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });

  describe("Scenario A: 摘要提取规则", () => {
    test("应该从用户消息中提取约束关键词", async () => {
      const { extractSummary } = await import("../src/summary");

      const messages: WindowMessage[] = [
        { role: "user", content: "你必须使用 TypeScript 来实现" },
        { role: "user", content: "不要使用任何外部库" },
        { role: "user", content: "只返回 JSON 格式" },
        { role: "assistant", content: "好的，我明白了" },
      ];

      const summary = extractSummary(messages, messages);

      expect(summary.constraints).toContainEqual("你必须使用 TypeScript 来实现");
      expect(summary.constraints).toContainEqual("不要使用任何外部库");
      expect(summary.constraints).toContainEqual("只返回 JSON 格式");
    });

    test("应该从助手消息中提取决策关键词", async () => {
      const { extractSummary } = await import("../src/summary");

      const messages: WindowMessage[] = [
        { role: "user", content: "帮我实现一个功能" },
        { role: "assistant", content: "我决定采用 React 作为框架" },
        { role: "assistant", content: "改为使用 TypeScript 重写" },
        { role: "assistant", content: "选择使用 Vite 作为构建工具" },
      ];

      const summary = extractSummary(messages, messages);

      expect(summary.decisions).toContainEqual("我决定采用 React 作为框架");
      expect(summary.decisions).toContainEqual("改为使用 TypeScript 重写");
      expect(summary.decisions).toContainEqual("选择使用 Vite 作为构建工具");
    });

    test("应该从工具结果中提取可复用事实", async () => {
      const { extractSummary } = await import("../src/summary");

      const messages: WindowMessage[] = [
        { role: "user", content: "执行 ls 命令" },
        { role: "assistant", content: "我来执行", tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ success: true, data: { path: "/home/user/project" } }) },
      ];

      const summary = extractSummary(messages, messages);

      expect(summary.toolFacts.length).toBeGreaterThan(0);
      expect(summary.toolFacts.some((f) => f.includes("path"))).toBe(true);
    });

    test("应该从用户问题中提取待办项", async () => {
      const { extractSummary } = await import("../src/summary");

      const messages: WindowMessage[] = [
        { role: "user", content: "如何实现用户认证？" },
        { role: "user", content: "怎么处理错误？" },
        { role: "assistant", content: "我来解答" },
      ];

      const summary = extractSummary(messages, messages);

      expect(summary.openItems).toContainEqual("如何实现用户认证？");
      expect(summary.openItems).toContainEqual("怎么处理错误？");
    });
  });

  describe("Scenario B: 摘要格式与解析", () => {
    test("应该生成正确的 Markdown 格式", async () => {
      const { formatSummaryMarkdown } = await import("../src/summary");

      const summary = {
        goal: ["实现用户认证功能"],
        constraints: ["必须使用 TypeScript", "不要使用外部库"],
        decisions: ["采用 React 框架"],
        openItems: ["如何处理错误？"],
        toolFacts: ["path: /home/user/project"],
      };

      const markdown = formatSummaryMarkdown(summary);

      expect(markdown).toContain("# Chat Summary");
      expect(markdown).toContain("## Goal");
      expect(markdown).toContain("## Constraints");
      expect(markdown).toContain("## Decisions");
      expect(markdown).toContain("## Open Items");
      expect(markdown).toContain("## Tool Facts");
      expect(markdown).toContain("- 实现用户认证功能");
      expect(markdown).toContain("- 必须使用 TypeScript");
    });

    test("应该能解析 Markdown 格式的摘要", async () => {
      const { parseSummaryMarkdown } = await import("../src/summary");

      const markdown = `# Chat Summary

## Goal
- 实现用户认证功能

## Constraints
- 必须使用 TypeScript

## Decisions
- 采用 React 框架

## Open Items
- 如何处理错误？

## Tool Facts
- path: /home/user/project
`;

      const summary = parseSummaryMarkdown(markdown);

      expect(summary.goal).toEqual(["实现用户认证功能"]);
      expect(summary.constraints).toEqual(["必须使用 TypeScript"]);
      expect(summary.decisions).toEqual(["采用 React 框架"]);
      expect(summary.openItems).toEqual(["如何处理错误？"]);
      expect(summary.toolFacts).toEqual(["path: /home/user/project"]);
    });
  });

  describe("Scenario C: 摘要存储加载", () => {
    test("应该能保存和加载摘要", async () => {
      const { saveSummary, loadSummary } = await import("../src/summary");

      const summary = {
        goal: ["测试目标"],
        constraints: [],
        decisions: [],
        openItems: [],
        toolFacts: [],
      };

      await saveSummary(tempWorkspace, testChatId, summary);
      const loaded = await loadSummary(tempWorkspace, testChatId);

      expect(loaded.goal).toEqual(["测试目标"]);
    });

    test("摘要文件不存在时应该返回空结构", async () => {
      const { loadSummary } = await import("../src/summary");

      const summary = await loadSummary(tempWorkspace, testChatId);

      expect(summary.goal).toEqual([]);
      expect(summary.constraints).toEqual([]);
      expect(summary.decisions).toEqual([]);
      expect(summary.openItems).toEqual([]);
      expect(summary.toolFacts).toEqual([]);
    });
  });

  describe("Scenario D: 摘要生成触发条件", () => {
    test("超过阈值且发生裁剪时应该触发摘要生成", async () => {
      const { shouldGenerateSummary } = await import("../src/summary");

      // Original: 25 messages, trimmed: 20 messages
      const shouldGenerate = shouldGenerateSummary(25, 20, { triggerThreshold: 20 });

      expect(shouldGenerate).toBe(true);
    });

    test("未超过阈值时不应触发摘要生成", async () => {
      const { shouldGenerateSummary } = await import("../src/summary");

      // Original: 15 messages, trimmed: 15 messages (no trimming)
      const shouldGenerate = shouldGenerateSummary(15, 15, { triggerThreshold: 20 });

      expect(shouldGenerate).toBe(false);
    });

    test("可以强制重新生成摘要", async () => {
      const { shouldGenerateSummary } = await import("../src/summary");

      const shouldGenerate = shouldGenerateSummary(10, 10, { forceRegenerate: true });

      expect(shouldGenerate).toBe(true);
    });
  });

  describe("Scenario E: 上下文拼装", () => {
    test("应该正确拼装 system + summary + recent window", async () => {
      const { buildContextWithSummary } = await import("../src/summary");

      const system = "You are helpful.";
      const summary = {
        goal: ["测试目标"],
        constraints: [],
        decisions: [],
        openItems: [],
        toolFacts: [],
      };
      const recentWindow: WindowMessage[] = [
        { role: "user", content: "最近的消息" },
        { role: "assistant", content: "最近的回复" },
      ];

      const context = buildContextWithSummary(system, summary, recentWindow);

      // Should have 4 messages: system + summary (as system) + 2 recent
      expect(context.length).toBe(4);
      expect(context[0].role).toBe("system");
      expect(context[0].content).toBe("You are helpful.");
      expect(context[1].role).toBe("system");
      expect(context[1].content).toContain("Previous Context Summary");
      expect(context[2].role).toBe("user");
      expect(context[3].role).toBe("assistant");
    });

    test("空摘要时不应添加额外的 system 消息", async () => {
      const { buildContextWithSummary } = await import("../src/summary");

      const system = "You are helpful.";
      const emptySummary = {
        goal: [],
        constraints: [],
        decisions: [],
        openItems: [],
        toolFacts: [],
      };
      const recentWindow: WindowMessage[] = [
        { role: "user", content: "最近的消息" },
      ];

      const context = buildContextWithSummary(system, emptySummary, recentWindow);

      // Should have 2 messages: system + 1 recent (no summary injected)
      expect(context.length).toBe(2);
      expect(context[0].role).toBe("system");
      expect(context[0].content).toBe("You are helpful.");
      expect(context[1].role).toBe("user");
    });
  });

  describe("Scenario F: 无摘要时兼容老流程", () => {
    test("没有摘要文件时应该能正常构建上下文", async () => {
      const { buildContextWithSummary } = await import("../src/summary");

      const system = "You are helpful.";
      const emptySummary = {
        goal: [],
        constraints: [],
        decisions: [],
        openItems: [],
        toolFacts: [],
      };
      const recentWindow: WindowMessage[] = [
        { role: "user", content: "消息内容" },
      ];

      // Should not throw
      const context = buildContextWithSummary(system, emptySummary, recentWindow);

      expect(context.length).toBeGreaterThanOrEqual(1);
      expect(context[0].role).toBe("system");
    });

    test("加载不存在的摘要应该返回空结构", async () => {
      const { loadSummary } = await import("../src/summary");

      // Load summary for non-existent chat
      const summary = await loadSummary(tempWorkspace, "non-existent-chat");

      expect(summary).toEqual({
        goal: [],
        constraints: [],
        decisions: [],
        openItems: [],
        toolFacts: [],
      });
    });
  });

  describe("Scenario G: 集成测试", () => {
    test("完整流程：裁剪触发摘要生成，下一轮可读取摘要", async () => {
      const {
        extractSummary,
        saveSummary,
        loadSummary,
        shouldGenerateSummary,
        buildContextWithSummary,
      } = await import("../src/summary");

      // Simulate trimming: original 25 messages, kept 20
      const originalMessages: WindowMessage[] = [];
      for (let i = 0; i < 25; i++) {
        originalMessages.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}`,
        });
      }

      const keptMessages = originalMessages.slice(-20);
      const trimmedMessages = originalMessages.slice(0, 5);

      // Check if summary should be generated
      const shouldGenerate = shouldGenerateSummary(25, 20, { triggerThreshold: 20 });
      expect(shouldGenerate).toBe(true);

      // Generate and save summary
      const summary = extractSummary(trimmedMessages, originalMessages);
      await saveSummary(tempWorkspace, testChatId, summary);

      // Load summary
      const loadedSummary = await loadSummary(tempWorkspace, testChatId);
      expect(loadedSummary.goal.length).toBeGreaterThan(0);

      // Build context with summary
      const context = buildContextWithSummary(
        "You are helpful.",
        loadedSummary,
        keptMessages
      );

      // Verify context includes summary
      expect(context.some((m) => m.content?.includes("Previous Context Summary"))).toBe(true);
    });
  });
});

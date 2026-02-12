/**
 * msgcode: Session Window BDD 测试
 *
 * 测试场景：
 * - Scenario A: 基础窗口操作（load/append/prune）
 * - Scenario B: 多轮对话记忆（第二轮引用第一轮信息）
 * - Scenario C: 超过 maxMessages 时裁剪
 * - Scenario D: Tool Loop 后可读到工具结果摘要
 * - Scenario E: 窗口统计功能
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import type { WindowMessage } from "../src/session-window";

describe("Session Window", () => {
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

  describe("Scenario A: 基础窗口操作", () => {
    test("应该能加载空窗口", async () => {
      const { loadWindow } = await import("../src/session-window.js");
      const messages = await loadWindow(tempWorkspace, testChatId);

      expect(messages).toEqual([]);
    });

    test("应该能追加消息到窗口", async () => {
      const { loadWindow, appendWindow } = await import("../src/session-window.js");

      await appendWindow(tempWorkspace, testChatId, {
        role: "user",
        content: "Hello",
      });

      const messages = await loadWindow(tempWorkspace, testChatId);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello");
    });

    test("应该能追加多条消息", async () => {
      const { loadWindow, appendWindow } = await import("../src/session-window.js");

      await appendWindow(tempWorkspace, testChatId, {
        role: "user",
        content: "Hello",
      });

      await appendWindow(tempWorkspace, testChatId, {
        role: "assistant",
        content: "Hi there!",
      });

      const messages = await loadWindow(tempWorkspace, testChatId);

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
    });

    test("应该能裁剪窗口到指定条数", async () => {
      const { pruneWindow } = await import("../src/session-window.js");

      const history: WindowMessage[] = [];
      for (let i = 0; i < 30; i++) {
        history.push({ role: i % 2 === 0 ? "user" : "assistant", content: `Message ${i}` });
      }

      const pruned = pruneWindow(history, 20);

      expect(pruned).toHaveLength(20);
      expect(pruned[0].content).toBe("Message 10"); // Keep last 20
      expect(pruned[19].content).toBe("Message 29");
    });

    test("当历史不超过 maxMessages 时不应裁剪", async () => {
      const { pruneWindow } = await import("../src/session-window.js");

      const history: WindowMessage[] = [
        { role: "user", content: "Message 1" },
        { role: "assistant", content: "Message 2" },
      ];

      const pruned = pruneWindow(history, 20);

      expect(pruned).toHaveLength(2);
      expect(pruned).toEqual(history);
    });
  });

  describe("Scenario B: 多轮对话记忆", () => {
    test("连续两轮问答，第二轮能引用第一轮信息", async () => {
      const { loadWindow, appendWindow, buildWindowContext } = await import("../src/session-window.js");

      // 第一轮
      await appendWindow(tempWorkspace, testChatId, {
        role: "user",
        content: "My name is Alice",
      });

      await appendWindow(tempWorkspace, testChatId, {
        role: "assistant",
        content: "Nice to meet you, Alice!",
      });

      // 第二轮：加载窗口应该包含第一轮的信息
      const history = await loadWindow(tempWorkspace, testChatId);

      await appendWindow(tempWorkspace, testChatId, {
        role: "user",
        content: "What's my name?",
      });

      const context = buildWindowContext({
        system: "You are a helpful assistant.",
        history,
        currentUser: "",
        maxMessages: 20,
      });

      // 应该包含第一轮的消息
      const userMessages = context.filter((m: WindowMessage) => m.role === "user");
      expect(userMessages.length).toBeGreaterThanOrEqual(1);
      expect(userMessages.some((m: WindowMessage) => m.content === "My name is Alice")).toBe(true);
    });
  });

  describe("Scenario C: 超过 maxMessages 时裁剪", () => {
    test("超过 maxMessages 时会裁剪，不报错", async () => {
      const { loadWindow, appendWindow, buildWindowContext } = await import("../src/session-window.js");

      // 添加 25 条消息（超过默认的 20）
      for (let i = 0; i < 25; i++) {
        await appendWindow(tempWorkspace, testChatId, {
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}`,
        });
      }

      const history = await loadWindow(tempWorkspace, testChatId);

      // buildWindowContext 应该裁剪到 20 条
      const context = buildWindowContext({
        system: "You are helpful.",
        history,
        currentUser: "",
        maxMessages: 20,
      });

      // system message + 20 history messages = 21 total
      expect(context.length).toBe(21);

      // 验证保留的是最后 20 条消息
      const historyMessages = context.slice(1);
      expect(historyMessages[0].content).toBe("Message 5"); // Messages 5-24 are kept
      expect(historyMessages[19].content).toBe("Message 24");
    });

    test("自定义 maxMessages 应该生效", async () => {
      const { loadWindow, appendWindow, buildWindowContext } = await import("../src/session-window.js");

      // 添加 15 条消息
      for (let i = 0; i < 15; i++) {
        await appendWindow(tempWorkspace, testChatId, {
          role: "user",
          content: `Message ${i}`,
        });
      }

      const history = await loadWindow(tempWorkspace, testChatId);

      // 设置 maxMessages = 5
      const context = buildWindowContext({
        system: "You are helpful.",
        history,
        currentUser: "",
        maxMessages: 5,
      });

      // system message + 5 history messages = 6 total
      expect(context.length).toBe(6);

      // 验证保留的是最后 5 条消息
      const historyMessages = context.slice(1);
      expect(historyMessages[0].content).toBe("Message 10");
      expect(historyMessages[4].content).toBe("Message 14");
    });
  });

  describe("Scenario D: Tool Loop 后可读到工具结果摘要", () => {
    test("Tool Loop 消息应该正确存储和加载", async () => {
      const { loadWindow, appendWindow } = await import("../src/session-window.js");

      // 模拟 tool loop 的消息序列
      await appendWindow(tempWorkspace, testChatId, {
        role: "user",
        content: "Execute ls -la",
      });

      await appendWindow(tempWorkspace, testChatId, {
        role: "assistant",
        content: "I'll execute that command.",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "shell",
              arguments: JSON.stringify({ command: "ls -la" }),
            },
          },
        ],
      });

      await appendWindow(tempWorkspace, testChatId, {
        role: "tool",
        tool_call_id: "call_123",
        content: JSON.stringify({ success: true, data: "file1.txt\nfile2.txt" }),
      });

      await appendWindow(tempWorkspace, testChatId, {
        role: "assistant",
        content: "The directory contains file1.txt and file2.txt",
      });

      const history = await loadWindow(tempWorkspace, testChatId);

      expect(history).toHaveLength(4);

      // 验证 tool_calls 结构
      const assistantMsg = history[1];
      expect(assistantMsg.tool_calls).toBeDefined();
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls![0].function.name).toBe("shell");

      // 验证 tool 消息结构
      const toolMsg = history[2];
      expect(toolMsg.role).toBe("tool");
      expect(toolMsg.tool_call_id).toBe("call_123");

      // 验证最终响应
      const finalMsg = history[3];
      expect(finalMsg.role).toBe("assistant");
      expect(finalMsg.content).toContain("file1.txt");
    });
  });

  describe("Scenario E: 窗口统计功能", () => {
    test("应该能获取窗口统计信息", async () => {
      const { appendWindow, getWindowStats } = await import("../src/session-window.js");

      await appendWindow(tempWorkspace, testChatId, {
        role: "user",
        content: "Hello",
      });

      await appendWindow(tempWorkspace, testChatId, {
        role: "assistant",
        content: "Hi there!",
      });

      const stats = await getWindowStats(tempWorkspace, testChatId);

      expect(stats.count).toBe(2);
      expect(stats.size).toBeGreaterThan(0);
    });

    test("空窗口应该返回零统计", async () => {
      const { getWindowStats } = await import("../src/session-window.js");

      const stats = await getWindowStats(tempWorkspace, testChatId);

      expect(stats.count).toBe(0);
      expect(stats.size).toBe(0);
    });

    test("应该能清空窗口", async () => {
      const { appendWindow, clearWindow, loadWindow } = await import("../src/session-window.js");

      await appendWindow(tempWorkspace, testChatId, {
        role: "user",
        content: "Hello",
      });

      await clearWindow(tempWorkspace, testChatId);

      const messages = await loadWindow(tempWorkspace, testChatId);

      expect(messages).toHaveLength(0);
    });
  });
});

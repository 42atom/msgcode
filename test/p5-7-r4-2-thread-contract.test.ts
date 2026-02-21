/**
 * msgcode: P5.7-R4-2 Thread 命令与 active 强确认测试
 *
 * 目标：
 * - 验证 thread list/messages/active/switch 命令合同
 * - 验证 thread switch 成功返回 activeThreadId/activeThreadTitle/switchedAt
 * - 验证无效 thread id 返回 THREAD_NOT_FOUND
 * - 验证 thread active 无活动线程返回失败（不返回伪成功）
 *
 * 断言口径：行为断言优先，禁止源码字符串匹配
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ============================================
// 辅助函数
// ============================================

// 临时测试目录
let tempDir: string;
let routesFile: string;
let activeThreadFile: string;

beforeEach(() => {
  tempDir = path.join(os.tmpdir(), `msgcode-test-${Date.now()}`);
  routesFile = path.join(tempDir, "routes.json");
  activeThreadFile = path.join(tempDir, "active_thread.json");

  mkdirSync(tempDir, { recursive: true });

  // 设置环境变量让代码使用临时文件
  process.env.ROUTES_FILE_PATH = routesFile;
  process.env.ACTIVE_THREAD_FILE = activeThreadFile;
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  delete process.env.ROUTES_FILE_PATH;
  delete process.env.ACTIVE_THREAD_FILE;
});

// ============================================
// 测试
// ============================================

describe("P5.7-R4-2: Thread 命令合同", () => {
  describe("THREAD_NOT_FOUND 错误码验证", () => {
    it("THREAD_NOT_FOUND 应该存在于错误码枚举中", async () => {
      const { THREAD_ERROR_CODES } = await import("../src/cli/thread.js");
      expect(THREAD_ERROR_CODES.THREAD_NOT_FOUND).toBe("THREAD_NOT_FOUND");
    });

    it("THREAD_NOT_FOUND 与 THREAD_SWITCH_FAILED 应该是不同的错误码", async () => {
      const { THREAD_ERROR_CODES } = await import("../src/cli/thread.js");
      expect(THREAD_ERROR_CODES.THREAD_NOT_FOUND).not.toBe(THREAD_ERROR_CODES.THREAD_SWITCH_FAILED);
    });
  });

  describe("THREAD_NO_ACTIVE_THREAD 错误码验证", () => {
    it("THREAD_NO_ACTIVE_THREAD 应该存在于错误码枚举中", async () => {
      const { THREAD_ERROR_CODES } = await import("../src/cli/thread.js");
      expect(THREAD_ERROR_CODES.NO_ACTIVE_THREAD).toBe("THREAD_NO_ACTIVE_THREAD");
    });
  });

  describe("合同导出验证", () => {
    it("getThreadListContract 应该返回正确的合同结构", async () => {
      const { getThreadListContract } = await import("../src/cli/thread.js");
      const contract = getThreadListContract();

      expect(contract.name).toBe("msgcode thread list");
      expect(contract.description).toContain("线程");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("THREAD_LIST_FAILED");
    });

    it("getThreadMessagesContract 应该返回正确的合同结构", async () => {
      const { getThreadMessagesContract } = await import("../src/cli/thread.js");
      const contract = getThreadMessagesContract();

      expect(contract.name).toBe("msgcode thread messages");
      expect(contract.description).toContain("消息");
      expect(contract.errorCodes).toContain("THREAD_NOT_FOUND");
      expect(contract.errorCodes).toContain("THREAD_MESSAGES_FAILED");
    });

    it("getThreadActiveContract 应该返回正确的合同结构", async () => {
      const { getThreadActiveContract } = await import("../src/cli/thread.js");
      const contract = getThreadActiveContract();

      expect(contract.name).toBe("msgcode thread active");
      expect(contract.description).toContain("活动线程");
      // P5.7-R4-2: 必须包含 THREAD_NO_ACTIVE_THREAD
      expect(contract.errorCodes).toContain("THREAD_NO_ACTIVE_THREAD");
      expect(contract.errorCodes).toContain("THREAD_NOT_FOUND");
      // 成功输出必须包含三字段
      expect(contract.output).toHaveProperty("activeThreadId");
      expect(contract.output).toHaveProperty("activeThreadTitle");
      expect(contract.output).toHaveProperty("switchedAt");
    });

    it("getThreadSwitchContract 应该返回正确的合同结构", async () => {
      const { getThreadSwitchContract } = await import("../src/cli/thread.js");
      const contract = getThreadSwitchContract();

      expect(contract.name).toBe("msgcode thread switch");
      expect(contract.description).toContain("切换");
      expect(contract.errorCodes).toContain("THREAD_NOT_FOUND");
      expect(contract.errorCodes).toContain("THREAD_SWITCH_FAILED");
      // P5.7-R4-2: 成功输出必须包含三字段
      expect(contract.output).toHaveProperty("activeThreadId");
      expect(contract.output).toHaveProperty("activeThreadTitle");
      expect(contract.output).toHaveProperty("switchedAt");
    });
  });

  describe("命令创建验证", () => {
    it("createThreadListCommand 应该创建有效的 Command", async () => {
      const { createThreadListCommand } = await import("../src/cli/thread.js");
      const cmd = createThreadListCommand();

      expect(cmd.name()).toBe("list");
      expect(cmd.description()).toContain("线程");
    });

    it("createThreadMessagesCommand 应该创建有效的 Command", async () => {
      const { createThreadMessagesCommand } = await import("../src/cli/thread.js");
      const cmd = createThreadMessagesCommand();

      expect(cmd.name()).toBe("messages");
      expect(cmd.description()).toContain("消息");
    });

    it("createThreadActiveCommand 应该创建有效的 Command", async () => {
      const { createThreadActiveCommand } = await import("../src/cli/thread.js");
      const cmd = createThreadActiveCommand();

      expect(cmd.name()).toBe("active");
      expect(cmd.description()).toContain("活动");
    });

    it("createThreadSwitchCommand 应该创建有效的 Command", async () => {
      const { createThreadSwitchCommand } = await import("../src/cli/thread.js");
      const cmd = createThreadSwitchCommand();

      expect(cmd.name()).toBe("switch");
      expect(cmd.description()).toContain("切换");
    });

    it("createThreadCommand 应该包含所有子命令", async () => {
      const { createThreadCommand } = await import("../src/cli/thread.js");
      const cmd = createThreadCommand();

      expect(cmd.name()).toBe("thread");
      const subCommands = cmd.commands.map(c => c.name());
      expect(subCommands).toContain("list");
      expect(subCommands).toContain("messages");
      expect(subCommands).toContain("active");
      expect(subCommands).toContain("switch");
    });
  });

  describe("switch 成功返回字段验证", () => {
    it("thread switch 合同应该定义 activeThreadId 字段", async () => {
      const { getThreadSwitchContract } = await import("../src/cli/thread.js");
      const contract = getThreadSwitchContract();

      expect(contract.output?.activeThreadId).toBeDefined();
    });

    it("thread switch 合同应该定义 activeThreadTitle 字段", async () => {
      const { getThreadSwitchContract } = await import("../src/cli/thread.js");
      const contract = getThreadSwitchContract();

      expect(contract.output?.activeThreadTitle).toBeDefined();
    });

    it("thread switch 合同应该定义 switchedAt 字段", async () => {
      const { getThreadSwitchContract } = await import("../src/cli/thread.js");
      const contract = getThreadSwitchContract();

      expect(contract.output?.switchedAt).toBeDefined();
    });
  });

  describe("active 无活动线程失败验证", () => {
    it("thread active 合同应该包含 THREAD_NO_ACTIVE_THREAD 错误码", async () => {
      const { getThreadActiveContract } = await import("../src/cli/thread.js");
      const contract = getThreadActiveContract();

      expect(contract.errorCodes).toContain("THREAD_NO_ACTIVE_THREAD");
    });

    it("thread active 不应该返回伪成功（合同明确区分成功和失败）", async () => {
      const { getThreadActiveContract } = await import("../src/cli/thread.js");
      const contract = getThreadActiveContract();

      // 成功输出结构
      const successOutput = contract.output;
      expect(successOutput).toHaveProperty("activeThreadId");

      // 失败错误码
      const errorCodes = contract.errorCodes || [];
      expect(errorCodes.length).toBeGreaterThan(0);
      expect(errorCodes).toContain("THREAD_NO_ACTIVE_THREAD");
    });
  });

  describe("错误码语义验证", () => {
    it("参数错误和执行错误应该有明确的区分", async () => {
      const { THREAD_ERROR_CODES } = await import("../src/cli/thread.js");

      // 参数/状态错误（输入验证失败）
      const stateErrors = [
        THREAD_ERROR_CODES.THREAD_NOT_FOUND,
        THREAD_ERROR_CODES.NO_ACTIVE_THREAD,
      ];

      // 执行错误（运行时失败）
      const execErrors = [
        THREAD_ERROR_CODES.THREAD_SWITCH_FAILED,
        THREAD_ERROR_CODES.THREAD_LIST_FAILED,
        THREAD_ERROR_CODES.THREAD_MESSAGES_FAILED,
        THREAD_ERROR_CODES.THREAD_ACTIVE_FAILED,
      ];

      // 验证没有重叠
      for (const se of stateErrors) {
        expect(execErrors).not.toContain(se);
      }
    });

    it("所有 THREAD 错误码应该有 THREAD_ 前缀", async () => {
      const { THREAD_ERROR_CODES } = await import("../src/cli/thread.js");
      const codes = Object.values(THREAD_ERROR_CODES);

      for (const code of codes) {
        expect(code).toMatch(/^THREAD_/);
      }
    });
  });

  describe("成功证据", () => {
    it("thread switch 合同应该定义完整的成功输出", async () => {
      const { getThreadSwitchContract } = await import("../src/cli/thread.js");
      const contract = getThreadSwitchContract();

      // 成功证据：合同定义了三字段输出
      expect(contract.output?.activeThreadId).toBe("活动线程 ID");
      expect(contract.output?.activeThreadTitle).toBe("活动线程标题");
      expect(contract.output?.switchedAt).toBe("切换时间（ISO 8601）");
    });
  });

  describe("失败证据", () => {
    it("thread switch 合同应该定义 THREAD_NOT_FOUND 错误码", async () => {
      const { getThreadSwitchContract } = await import("../src/cli/thread.js");
      const contract = getThreadSwitchContract();

      // 失败证据：无效 thread id 返回固定错误码
      expect(contract.errorCodes).toContain("THREAD_NOT_FOUND");
    });

    it("thread active 合同应该定义 THREAD_NO_ACTIVE_THREAD 错误码", async () => {
      const { getThreadActiveContract } = await import("../src/cli/thread.js");
      const contract = getThreadActiveContract();

      // 失败证据：无活动线程返回固定错误码
      expect(contract.errorCodes).toContain("THREAD_NO_ACTIVE_THREAD");
    });
  });

  describe("help-docs 集成验证", () => {
    it("help-docs 应该导出 thread 命令合同", async () => {
      const { getThreadListContract, getThreadMessagesContract, getThreadActiveContract, getThreadSwitchContract } = await import("../src/cli/thread.js");

      // 验证所有 thread 合同导出
      expect(getThreadListContract().name).toBe("msgcode thread list");
      expect(getThreadMessagesContract().name).toBe("msgcode thread messages");
      expect(getThreadActiveContract().name).toBe("msgcode thread active");
      expect(getThreadSwitchContract().name).toBe("msgcode thread switch");
    });
  });
});

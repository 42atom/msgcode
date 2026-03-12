/**
 * msgcode: P5.7-R4-T1 Memory/Thread Smoke Verification
 *
 * 目标:
 * - 验证 memory 命令合同完整性
 * - 验证 thread 命令合同完整性
 * - 验证 help-docs 合同导出
 * - 验证错误码语义正确性
 *
 * 测试类型: 冒烟测试（合同验证）
 */

import { describe, it, expect } from "bun:test";

// ============================================
// Memory 命令合同验证
// ============================================

describe("P5.7-R4-T1: Memory 合同冒烟验证", () => {
  describe("合同导出验证", () => {
    it("getMemoryAddContract 应该返回正确的合同结构", async () => {
      const { getMemoryAddContract } = await import("../src/cli/memory.js");
      const contract = getMemoryAddContract();

      expect(contract.name).toBe("msgcode memory add");
      expect(contract.description).toContain("记忆");
      expect(contract).not.toHaveProperty("aliases");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.errorCodes).toContain("MEMORY_WORKSPACE_NOT_FOUND");
      expect(contract.output).toHaveProperty("path");
      expect(contract.output).toHaveProperty("appendedAt");
    });

    it("getMemorySearchContract 应该返回正确的合同结构", async () => {
      const { getMemorySearchContract } = await import("../src/cli/memory.js");
      const contract = getMemorySearchContract();

      expect(contract.name).toBe("msgcode memory search");
      expect(contract.description).toContain("搜索");
      expect(contract.errorCodes).toContain("MEMORY_EMPTY_QUERY");
      expect(contract.errorCodes).toContain("MEMORY_SEARCH_FAILED");
      expect(contract.output).toHaveProperty("query");
      expect(contract.output).toHaveProperty("results");
      expect(contract.output).toHaveProperty("count");
    });

    it("getMemoryStatsContract 应该返回正确的合同结构", async () => {
      const { getMemoryStatsContract } = await import("../src/cli/memory.js");
      const contract = getMemoryStatsContract();

      expect(contract.name).toBe("msgcode memory stats");
      expect(contract.description).toContain("统计");
      expect(contract).not.toHaveProperty("aliases");
      expect(contract.output).toHaveProperty("store");
      expect(contract.output).toHaveProperty("dirty");
    });
  });

  describe("错误码验证", () => {
    it("MEMORY_EMPTY_QUERY 应该存在于错误码枚举中", async () => {
      const { MEMORY_ERROR_CODES } = await import("../src/memory/types.js");
      expect(MEMORY_ERROR_CODES.EMPTY_QUERY).toBe("MEMORY_EMPTY_QUERY");
    });

    it("MEMORY_EMPTY_QUERY 与 MEMORY_SEARCH_FAILED 应该是不同的错误码", async () => {
      const { MEMORY_ERROR_CODES } = await import("../src/memory/types.js");
      expect(MEMORY_ERROR_CODES.EMPTY_QUERY).not.toBe(
        MEMORY_ERROR_CODES.SEARCH_FAILED
      );
    });
  });
});

// ============================================
// Thread 命令合同验证
// ============================================

describe("P5.7-R4-T1: Thread 合同冒烟验证", () => {
  describe("合同导出验证", () => {
    it("getThreadListContract 应该返回正确的合同结构", async () => {
      const { getThreadListContract } = await import("../src/cli/thread.js");
      const contract = getThreadListContract();

      expect(contract.name).toBe("msgcode thread list");
      expect(contract.description).toContain("线程");
      expect(contract.output).toHaveProperty("count");
      expect(contract.output).toHaveProperty("threads");
      expect(contract.errorCodes).toContain("THREAD_LIST_FAILED");
    });

    it("getThreadMessagesContract 应该返回正确的合同结构", async () => {
      const { getThreadMessagesContract } = await import(
        "../src/cli/thread.js"
      );
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
      expect(contract.description).toContain("活动");
      // P5.7-R4-T1: 必须包含 THREAD_NO_ACTIVE_THREAD
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
      // P5.7-R4-T1: 成功输出必须包含三字段
      expect(contract.output).toHaveProperty("activeThreadId");
      expect(contract.output).toHaveProperty("activeThreadTitle");
      expect(contract.output).toHaveProperty("switchedAt");
    });
  });

  describe("错误码验证", () => {
    it("THREAD_NO_ACTIVE_THREAD 应该存在于错误码枚举中", async () => {
      const { THREAD_ERROR_CODES } = await import("../src/cli/thread.js");
      expect(THREAD_ERROR_CODES.NO_ACTIVE_THREAD).toBe(
        "THREAD_NO_ACTIVE_THREAD"
      );
    });

    it("THREAD_NOT_FOUND 与 THREAD_SWITCH_FAILED 应该是不同的错误码", async () => {
      const { THREAD_ERROR_CODES } = await import("../src/cli/thread.js");
      expect(THREAD_ERROR_CODES.THREAD_NOT_FOUND).not.toBe(
        THREAD_ERROR_CODES.THREAD_SWITCH_FAILED
      );
    });

    it("所有 THREAD 错误码应该有 THREAD_ 前缀", async () => {
      const { THREAD_ERROR_CODES } = await import("../src/cli/thread.js");
      const codes = Object.values(THREAD_ERROR_CODES);

      for (const code of codes) {
        expect(code).toMatch(/^THREAD_/);
      }
    });
  });
});

// ============================================
// help-docs 集成验证
// ============================================

describe("P5.7-R4-T1: help-docs 集成验证", () => {
  it("help-docs 应该导出所有 memory 命令合同", async () => {
    const {
      getMemoryAddContract,
      getMemoryIndexContract,
      getMemorySearchContract,
      getMemoryGetContract,
      getMemoryStatsContract,
    } = await import("../src/cli/memory.js");

    // 验证所有 memory 合同导出
    expect(getMemoryAddContract().name).toBe("msgcode memory add");
    expect(getMemoryIndexContract().name).toBe("msgcode memory index");
    expect(getMemorySearchContract().name).toBe("msgcode memory search");
    expect(getMemoryGetContract().name).toBe("msgcode memory get");
    expect(getMemoryStatsContract().name).toBe("msgcode memory stats");
  });

  it("help-docs --json 应包含所有 memory canonical 命令", async () => {
    const { execCliStdoutIsolated } = await import("./helpers/cli-process.js");
    const output = execCliStdoutIsolated(["help-docs", "--json"]);
    const envelope = JSON.parse(output);
    const commands = envelope.data.commands.map((item: { name: string }) => item.name);

    expect(commands).toContain("msgcode memory add");
    expect(commands).toContain("msgcode memory index");
    expect(commands).toContain("msgcode memory search");
    expect(commands).toContain("msgcode memory get");
    expect(commands).toContain("msgcode memory stats");
  });

  it("help-docs 应该导出所有 thread 命令合同", async () => {
    const {
      getThreadListContract,
      getThreadMessagesContract,
      getThreadActiveContract,
      getThreadSwitchContract,
    } = await import("../src/cli/thread.js");

    // 验证所有 thread 合同导出
    expect(getThreadListContract().name).toBe("msgcode thread list");
    expect(getThreadMessagesContract().name).toBe("msgcode thread messages");
    expect(getThreadActiveContract().name).toBe("msgcode thread active");
    expect(getThreadSwitchContract().name).toBe("msgcode thread switch");
  });

  it("memory search 合同应该包含 MEMORY_EMPTY_QUERY 错误码", async () => {
    const { getMemorySearchContract } = await import("../src/cli/memory.js");
    const contract = getMemorySearchContract();

    // P5.7-R4-T1: 空查询必须返回固定错误码
    expect(contract.errorCodes).toContain("MEMORY_EMPTY_QUERY");
  });

  it("thread active 合同应该包含 THREAD_NO_ACTIVE_THREAD 错误码", async () => {
    const { getThreadActiveContract } = await import("../src/cli/thread.js");
    const contract = getThreadActiveContract();

    // P5.7-R4-T1: 无活动线程必须返回固定错误码（非伪成功）
    expect(contract.errorCodes).toContain("THREAD_NO_ACTIVE_THREAD");
  });

  it("thread switch 合同应该定义三字段输出", async () => {
    const { getThreadSwitchContract } = await import("../src/cli/thread.js");
    const contract = getThreadSwitchContract();

    // P5.7-R4-T1: 成功证据必须包含三字段
    expect(contract.output?.activeThreadId).toBe("活动线程 ID");
    expect(contract.output?.activeThreadTitle).toBe("活动线程标题");
    expect(contract.output?.switchedAt).toBe("切换时间（ISO 8601）");
  });
});

// ============================================
// 成功/失败证据验证
// ============================================

describe("P5.7-R4-T1: 成功/失败证据验证", () => {
  describe("成功证据", () => {
    it("memory add 合同应该定义完整的成功输出", async () => {
      const { getMemoryAddContract } = await import("../src/cli/memory.js");
      const contract = getMemoryAddContract();

      // 成功证据：合同定义了输出字段
      expect(contract.output?.path).toBe("写入的文件路径");
      expect(contract.output?.textLength).toBe("文本长度");
      expect(contract.output?.appendedAt).toBe("写入时间（ISO 8601）");
    });

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
    it("memory search 合同应该定义 MEMORY_EMPTY_QUERY 错误码", async () => {
      const { getMemorySearchContract } = await import("../src/cli/memory.js");
      const contract = getMemorySearchContract();

      // 失败证据：空查询返回固定错误码
      expect(contract.errorCodes).toContain("MEMORY_EMPTY_QUERY");
    });

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
});

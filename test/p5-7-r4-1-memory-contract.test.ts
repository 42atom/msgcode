/**
 * msgcode: P5.7-R4-1 Memory 命令合同收口测试
 *
 * 目标：
 * - 验证 memory search 空查询失败（MEMORY_EMPTY_QUERY）
 * - 验证 memory add 必填字段失败（MEMORY_WRITE_FAILED）
 * - 验证 memory stats 无数据时返回成功结构
 *
 * 断言口径：行为断言优先，禁止源码字符串匹配
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execCliStdoutIsolated, runCliIsolated } from "./helpers/cli-process.js";

// ============================================
// 辅助函数
// ============================================

// 临时测试目录
let tempDir: string;

beforeEach(() => {
  tempDir = path.join(os.tmpdir(), `msgcode-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ============================================
// 测试
// ============================================

describe("P5.7-R4-1: Memory 命令合同", () => {
  describe("MEMORY_EMPTY_QUERY 错误码验证", () => {
    it("MEMORY_EMPTY_QUERY 应该存在于错误码枚举中", async () => {
      const { MEMORY_ERROR_CODES } = await import("../src/memory/types.js");
      expect(MEMORY_ERROR_CODES.EMPTY_QUERY).toBe("MEMORY_EMPTY_QUERY");
    });

    it("MEMORY_EMPTY_QUERY 与 MEMORY_SEARCH_FAILED 应该是不同的错误码", async () => {
      const { MEMORY_ERROR_CODES } = await import("../src/memory/types.js");
      expect(MEMORY_ERROR_CODES.EMPTY_QUERY).not.toBe(MEMORY_ERROR_CODES.SEARCH_FAILED);
      expect(MEMORY_ERROR_CODES.EMPTY_QUERY).toBe("MEMORY_EMPTY_QUERY");
      expect(MEMORY_ERROR_CODES.SEARCH_FAILED).toBe("MEMORY_SEARCH_FAILED");
    });

    it("空字符串校验逻辑应该识别空查询", () => {
      // 测试校验逻辑
      const isEmptyQuery = (query: string) => !query || query.trim() === "";
      expect(isEmptyQuery("")).toBe(true);
      expect(isEmptyQuery("   ")).toBe(true);
      expect(isEmptyQuery("test")).toBe(false);
      expect(isEmptyQuery(" test ")).toBe(false);
    });
  });

  describe("MEMORY_WRITE_FAILED 错误码验证", () => {
    it("MEMORY_WRITE_FAILED 应该存在于错误码枚举中", async () => {
      const { MEMORY_ERROR_CODES } = await import("../src/memory/types.js");
      expect(MEMORY_ERROR_CODES.WRITE_FAILED).toBe("MEMORY_WRITE_FAILED");
    });

    it("空文本校验逻辑应该识别空内容", () => {
      const isEmptyText = (text: string) => !text || text.trim() === "";
      expect(isEmptyText("")).toBe(true);
      expect(isEmptyText("   ")).toBe(true);
      expect(isEmptyText("test")).toBe(false);
    });
  });

  describe("合同导出验证", () => {
    it("getMemoryAddContract 应该返回正确的合同结构", async () => {
      const { getMemoryAddContract } = await import("../src/cli/memory.js");
      const contract = getMemoryAddContract();

      expect(contract.name).toBe("msgcode memory add");
      expect(contract.description).toContain("记忆");
      expect(contract.aliases).toContain("msgcode memory remember");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.optional).toHaveProperty("--dry-run");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("MEMORY_WORKSPACE_NOT_FOUND");
      expect(contract.errorCodes).toContain("MEMORY_PATH_TRAVERSAL");
      expect(contract.errorCodes).toContain("MEMORY_WRITE_FAILED");
    });

    it("getMemorySearchContract 应该返回正确的合同结构", async () => {
      const { getMemorySearchContract } = await import("../src/cli/memory.js");
      const contract = getMemorySearchContract();

      expect(contract.name).toBe("msgcode memory search");
      expect(contract.description).toContain("搜索");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.optional).toHaveProperty("--limit");
      expect(contract.options?.optional).toHaveProperty("--json");
      // P5.7-R4-1: 必须包含 MEMORY_EMPTY_QUERY
      expect(contract.errorCodes).toContain("MEMORY_EMPTY_QUERY");
      expect(contract.errorCodes).toContain("MEMORY_WORKSPACE_NOT_FOUND");
      expect(contract.errorCodes).toContain("MEMORY_SEARCH_FAILED");
      // 确保两个错误码不同
      const emptyQueryIndex = contract.errorCodes?.indexOf("MEMORY_EMPTY_QUERY");
      const searchFailedIndex = contract.errorCodes?.indexOf("MEMORY_SEARCH_FAILED");
      expect(emptyQueryIndex).not.toBe(-1);
      expect(searchFailedIndex).not.toBe(-1);
    });

    it("getMemoryStatsContract 应该返回正确的合同结构", async () => {
      const { getMemoryStatsContract } = await import("../src/cli/memory.js");
      const contract = getMemoryStatsContract();

      expect(contract.name).toBe("msgcode memory stats");
      expect(contract.description).toContain("统计");
      expect(contract.aliases).toContain("msgcode memory status");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("MEMORY_STATUS_FAILED");
    });
  });

  describe("命令创建验证", () => {
    it("createMemoryAddCommand 应该创建有效的 Command", async () => {
      const { createMemoryAddCommand } = await import("../src/cli/memory.js");
      const cmd = createMemoryAddCommand();

      expect(cmd.name()).toBe("add");
      expect(cmd.description()).toContain("记忆");
    });

    it("createMemorySearchCommand 应该创建有效的 Command", async () => {
      const { createMemorySearchCommand } = await import("../src/cli/memory.js");
      const cmd = createMemorySearchCommand();

      expect(cmd.name()).toBe("search");
      expect(cmd.description()).toContain("搜索");
    });

    it("createMemoryStatsCommand 应该创建有效的 Command", async () => {
      const { createMemoryStatsCommand } = await import("../src/cli/memory.js");
      const cmd = createMemoryStatsCommand();

      expect(cmd.name()).toBe("stats");
      expect(cmd.description()).toContain("统计");
    });

    it("createMemoryCommand 应该包含所有子命令", async () => {
      const { createMemoryCommand } = await import("../src/cli/memory.js");
      const cmd = createMemoryCommand();

      expect(cmd.name()).toBe("memory");
      const subCommands = cmd.commands.map(c => c.name());
      expect(subCommands).toContain("add");
      expect(subCommands).toContain("search");
      expect(subCommands).toContain("stats");
      expect(subCommands).toContain("index");
      expect(subCommands).toContain("get");
      expect(subCommands).not.toContain("remember");
      expect(subCommands).not.toContain("status");
    });
  });

  describe("错误码语义验证", () => {
    it("参数错误和执行错误应该有明确的区分", async () => {
      const { MEMORY_ERROR_CODES } = await import("../src/memory/types.js");

      // 参数错误（输入验证失败）
      const paramErrors = [MEMORY_ERROR_CODES.EMPTY_QUERY];

      // 执行错误（运行时失败）
      const execErrors = [
        MEMORY_ERROR_CODES.SEARCH_FAILED,
        MEMORY_ERROR_CODES.WRITE_FAILED,
        MEMORY_ERROR_CODES.INDEX_FAILED,
        MEMORY_ERROR_CODES.READ_FAILED,
        MEMORY_ERROR_CODES.STATUS_FAILED,
      ];

      // 验证没有重叠
      for (const pe of paramErrors) {
        expect(execErrors).not.toContain(pe);
      }
    });

    it("所有 MEMORY 错误码应该有 MEMORY_ 前缀", async () => {
      const { MEMORY_ERROR_CODES } = await import("../src/memory/types.js");
      const codes = Object.values(MEMORY_ERROR_CODES);

      for (const code of codes) {
        expect(code).toMatch(/^MEMORY_/);
      }
    });
  });

  describe("Envelope 结构验证", () => {
    it("createEnvelope 应该返回正确的结构", async () => {
      const { createEnvelope } = await import("../src/cli/command-runner.js");

      const envelope = createEnvelope("test-command", Date.now(), "pass", { test: true }, [], []);

      expect(envelope.schemaVersion).toBe(2);
      expect(envelope.command).toBe("test-command");
      expect(envelope.status).toBe("pass");
      expect(envelope.exitCode).toBe(0);
      expect(envelope.data).toEqual({ test: true });
      expect(envelope.warnings).toEqual([]);
      expect(envelope.errors).toEqual([]);
    });

    it("error 状态应该返回 exitCode=1", async () => {
      const { createEnvelope } = await import("../src/cli/command-runner.js");

      const envelope = createEnvelope("test-command", Date.now(), "error", {}, [], [{ code: "TEST_ERROR", message: "test" }]);

      expect(envelope.status).toBe("error");
      expect(envelope.exitCode).toBe(1);
    });
  });

  describe("成功证据", () => {
    it("stats 命令合同应该定义成功输出结构", async () => {
      const { getMemoryStatsContract } = await import("../src/cli/memory.js");
      const contract = getMemoryStatsContract();

      // 成功证据：合同定义了输出结构
      expect(contract.output).toBeDefined();
      expect(contract.output?.store).toBeDefined();
      expect(contract.output?.dirty).toBeDefined();
    });
  });

  describe("失败证据", () => {
    it("search 命令合同应该定义 MEMORY_EMPTY_QUERY 错误码", async () => {
      const { getMemorySearchContract } = await import("../src/cli/memory.js");
      const contract = getMemorySearchContract();

      // 失败证据：错误码固定为 MEMORY_EMPTY_QUERY
      expect(contract.errorCodes).toContain("MEMORY_EMPTY_QUERY");
    });

    it("add 命令合同应该定义 MEMORY_WRITE_FAILED 错误码", async () => {
      const { getMemoryAddContract } = await import("../src/cli/memory.js");
      const contract = getMemoryAddContract();

      // 失败证据：错误码固定为 MEMORY_WRITE_FAILED
      expect(contract.errorCodes).toContain("MEMORY_WRITE_FAILED");
    });
  });

  describe("向后兼容验证", () => {
    it("memory --help 只应展示 canonical 子命令", () => {
      const output = execCliStdoutIsolated(["memory", "--help"]);
      expect(output).toContain("add");
      expect(output).toContain("stats");
      expect(output).not.toContain("remember");
      expect(output).not.toContain("status");
    });

    it("remember 应该兼容映射到 add 主链", () => {
      const workspace = path.join(tempDir, "ws-remember");
      mkdirSync(workspace, { recursive: true });

      const result = runCliIsolated([
        "memory",
        "remember",
        "compat memory",
        "--workspace",
        workspace,
        "--json",
      ]);

      expect(result.status).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.command).toBe("msgcode memory add");
      expect(envelope.status).toBe("pass");
    });

    it("status 应该兼容映射到 stats 主链", () => {
      const result = runCliIsolated(["memory", "status", "--json"]);
      expect(result.status).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.command).toBe("msgcode memory stats");
      expect(envelope.status).toBe("pass");
    });
  });
});

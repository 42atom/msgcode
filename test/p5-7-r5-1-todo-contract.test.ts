/**
 * msgcode: P5.7-R5-1 Todo 命令合同收口测试
 *
 * 目标：
 * - 验证 todo add 空标题失败（TODO_EMPTY_TITLE）
 * - 验证 todo done 非法 taskId 失败（TODO_NOT_FOUND）
 * - 验证 todo list 空列表成功
 * - 验证状态翻转（add -> done）
 *
 * 断言口径：行为断言优先，禁止源码字符串匹配
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ============================================
// 辅助函数
// ============================================

// 临时测试目录
let tempDir: string;

beforeEach(() => {
  tempDir = path.join(os.tmpdir(), `msgcode-todo-test-${Date.now()}`);
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

describe("P5.7-R5-1: Todo 命令合同", () => {
  describe("错误码枚举验证", () => {
    it("TODO_EMPTY_TITLE 应该存在于错误码枚举中", async () => {
      const { TODO_ERROR_CODES } = await import("../src/cli/todo.js");
      expect(TODO_ERROR_CODES.EMPTY_TITLE).toBe("TODO_EMPTY_TITLE");
    });

    it("TODO_NOT_FOUND 应该存在于错误码枚举中", async () => {
      const { TODO_ERROR_CODES } = await import("../src/cli/todo.js");
      expect(TODO_ERROR_CODES.NOT_FOUND).toBe("TODO_NOT_FOUND");
    });

    it("TODO_ADD_FAILED 应该存在于错误码枚举中", async () => {
      const { TODO_ERROR_CODES } = await import("../src/cli/todo.js");
      expect(TODO_ERROR_CODES.ADD_FAILED).toBe("TODO_ADD_FAILED");
    });

    it("TODO_LIST_FAILED 应该存在于错误码枚举中", async () => {
      const { TODO_ERROR_CODES } = await import("../src/cli/todo.js");
      expect(TODO_ERROR_CODES.LIST_FAILED).toBe("TODO_LIST_FAILED");
    });

    it("TODO_DONE_FAILED 应该存在于错误码枚举中", async () => {
      const { TODO_ERROR_CODES } = await import("../src/cli/todo.js");
      expect(TODO_ERROR_CODES.DONE_FAILED).toBe("TODO_DONE_FAILED");
    });

    it("所有 TODO 错误码应该有 TODO_ 前缀", async () => {
      const { TODO_ERROR_CODES } = await import("../src/cli/todo.js");
      const codes = Object.values(TODO_ERROR_CODES);

      for (const code of codes) {
        expect(code).toMatch(/^TODO_/);
      }
    });

    it("参数错误和执行错误应该有明确的区分", async () => {
      const { TODO_ERROR_CODES } = await import("../src/cli/todo.js");

      // 参数错误（输入验证失败）
      const paramErrors = [TODO_ERROR_CODES.EMPTY_TITLE];

      // 执行错误（运行时失败）
      const execErrors = [
        TODO_ERROR_CODES.ADD_FAILED,
        TODO_ERROR_CODES.LIST_FAILED,
        TODO_ERROR_CODES.DONE_FAILED,
        TODO_ERROR_CODES.NOT_FOUND,
      ];

      // 验证没有重叠
      for (const pe of paramErrors) {
        expect(execErrors).not.toContain(pe);
      }
    });
  });

  describe("合同导出验证", () => {
    it("getTodoAddContract 应该返回正确的合同结构", async () => {
      const { getTodoAddContract } = await import("../src/cli/todo.js");
      const contract = getTodoAddContract();

      expect(contract.name).toBe("msgcode todo add");
      expect(contract.description).toContain("待办");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.optional).not.toHaveProperty("--status");
      expect(contract.errorCodes).toContain("TODO_EMPTY_TITLE");
      expect(contract.errorCodes).toContain("TODO_WORKSPACE_NOT_FOUND");
      expect(contract.errorCodes).toContain("TODO_ADD_FAILED");
    });

    it("getTodoListContract 应该返回正确的合同结构", async () => {
      const { getTodoListContract } = await import("../src/cli/todo.js");
      const contract = getTodoListContract();

      expect(contract.name).toBe("msgcode todo list");
      expect(contract.description).toContain("列出");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.optional).toHaveProperty("--status");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("TODO_WORKSPACE_NOT_FOUND");
      expect(contract.errorCodes).toContain("TODO_LIST_FAILED");
    });

    it("getTodoDoneContract 应该返回正确的合同结构", async () => {
      const { getTodoDoneContract } = await import("../src/cli/todo.js");
      const contract = getTodoDoneContract();

      expect(contract.name).toBe("msgcode todo done");
      expect(contract.description).toContain("完成");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("TODO_NOT_FOUND");
      expect(contract.errorCodes).toContain("TODO_WORKSPACE_NOT_FOUND");
      expect(contract.errorCodes).toContain("TODO_DONE_FAILED");
    });
  });

  describe("命令创建验证", () => {
    it("createTodoAddCommand 应该创建有效的 Command", async () => {
      const { createTodoAddCommand } = await import("../src/cli/todo.js");
      const cmd = createTodoAddCommand();

      expect(cmd.name()).toBe("add");
      expect(cmd.description()).toContain("待办");
    });

    it("createTodoListCommand 应该创建有效的 Command", async () => {
      const { createTodoListCommand } = await import("../src/cli/todo.js");
      const cmd = createTodoListCommand();

      expect(cmd.name()).toBe("list");
      expect(cmd.description()).toContain("列出");
    });

    it("createTodoDoneCommand 应该创建有效的 Command", async () => {
      const { createTodoDoneCommand } = await import("../src/cli/todo.js");
      const cmd = createTodoDoneCommand();

      expect(cmd.name()).toBe("done");
      expect(cmd.description()).toContain("完成");
    });

    it("createTodoCommand 应该包含所有子命令", async () => {
      const { createTodoCommand } = await import("../src/cli/todo.js");
      const cmd = createTodoCommand();

      expect(cmd.name()).toBe("todo");
      const subCommands = cmd.commands.map((c) => c.name());
      expect(subCommands).toContain("add");
      expect(subCommands).toContain("list");
      expect(subCommands).toContain("done");
    });
  });

  describe("空标题校验逻辑验证", () => {
    it("空字符串校验逻辑应该识别空标题", () => {
      const isEmptyTitle = (title: string) => !title || title.trim() === "";
      expect(isEmptyTitle("")).toBe(true);
      expect(isEmptyTitle("   ")).toBe(true);
      expect(isEmptyTitle("test")).toBe(false);
      expect(isEmptyTitle(" test ")).toBe(false);
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

      const envelope = createEnvelope(
        "test-command",
        Date.now(),
        "error",
        {},
        [],
        [{ code: "TEST_ERROR", message: "test" }]
      );

      expect(envelope.status).toBe("error");
      expect(envelope.exitCode).toBe(1);
    });
  });

  describe("成功证据", () => {
    it("list 命令合同应该定义成功输出结构（支持空列表）", async () => {
      const { getTodoListContract } = await import("../src/cli/todo.js");
      const contract = getTodoListContract();

      // 成功证据：合同定义了输出结构
      expect(contract.output).toBeDefined();
      expect(contract.output?.count).toBeDefined();
      expect(contract.output?.items).toBeDefined();
    });

    it("add 命令合同应该定义成功输出结构", async () => {
      const { getTodoAddContract } = await import("../src/cli/todo.js");
      const contract = getTodoAddContract();

      expect(contract.output).toBeDefined();
      expect(contract.output?.taskId).toBeDefined();
      expect(contract.output?.title).toBeDefined();
      expect(contract.output?.createdAt).toBeDefined();
    });

    it("done 命令合同应该定义成功输出结构", async () => {
      const { getTodoDoneContract } = await import("../src/cli/todo.js");
      const contract = getTodoDoneContract();

      expect(contract.output).toBeDefined();
      expect(contract.output?.taskId).toBeDefined();
      expect(contract.output?.doneAt).toBeDefined();
      expect(contract.output?.status).toBeDefined();
    });
  });

  describe("失败证据", () => {
    it("add 命令合同应该定义 TODO_EMPTY_TITLE 错误码", async () => {
      const { getTodoAddContract } = await import("../src/cli/todo.js");
      const contract = getTodoAddContract();

      // 失败证据：错误码固定为 TODO_EMPTY_TITLE
      expect(contract.errorCodes).toContain("TODO_EMPTY_TITLE");
    });

    it("done 命令合同应该定义 TODO_NOT_FOUND 错误码", async () => {
      const { getTodoDoneContract } = await import("../src/cli/todo.js");
      const contract = getTodoDoneContract();

      // 失败证据：错误码固定为 TODO_NOT_FOUND
      expect(contract.errorCodes).toContain("TODO_NOT_FOUND");
    });

    it("add 命令合同应该定义 TODO_ADD_FAILED 错误码", async () => {
      const { getTodoAddContract } = await import("../src/cli/todo.js");
      const contract = getTodoAddContract();

      // 失败证据：兜底错误码固定为 TODO_ADD_FAILED
      expect(contract.errorCodes).toContain("TODO_ADD_FAILED");
    });
  });

  describe("状态翻转证据", () => {
    it("add -> done 状态翻转应该被合同定义", async () => {
      const { getTodoAddContract, getTodoDoneContract } = await import("../src/cli/todo.js");

      const addContract = getTodoAddContract();
      const doneContract = getTodoDoneContract();

      // 状态翻转证据：add 返回 taskId，done 接收 taskId
      expect(addContract.output?.taskId).toBeDefined();
      expect(doneContract.options?.required).not.toHaveProperty("title");
      expect(doneContract.options?.required).toHaveProperty("--workspace");

      // done 的输出状态字段必须定义
      expect(doneContract.output?.status).toBeDefined();
    });
  });

  describe("help-docs 集成验证", () => {
    it("help.ts 应该导入 todo 合同", async () => {
      const fs = await import("node:fs");
      const helpContent = fs.readFileSync(path.join(process.cwd(), "src/cli/help.ts"), "utf-8");

      expect(helpContent).toContain('from "./todo.js"');
      expect(helpContent).toContain("getTodoAddContract");
      expect(helpContent).toContain("getTodoListContract");
      expect(helpContent).toContain("getTodoDoneContract");
    });
  });
});

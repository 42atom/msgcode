/**
 * msgcode: P5.7-R5-3 Help-Docs 同步与回归锁测试
 *
 * 目标：
 * - 验证 help-docs --json 完整暴露 todo/schedule 合同
 * - 回归锁：错误码枚举与参数口径冻结
 * - 全行为断言，禁止源码字符串匹配
 */

import { describe, it, expect } from "bun:test";
import { execCliStdoutIsolated } from "./helpers/cli-process.js";

// ============================================
// 辅助函数
// ============================================

/**
 * 调用 help-docs --json 并解析输出（行为断言）
 */
function getHelpDocsOutput(): {
  version: string;
  commands: Array<{
    name: string;
    description: string;
    options?: {
      required?: Record<string, string>;
      optional?: Record<string, string>;
    };
    output?: Record<string, unknown>;
    errorCodes?: string[];
  }>;
} {
  const output = execCliStdoutIsolated(["help-docs", "--json"]);

  const envelope = JSON.parse(output);
  expect(envelope.status).toBe("pass");
  expect(envelope.data).toBeDefined();
  expect(envelope.data.commands).toBeDefined();

  return envelope.data;
}

/**
 * 按名称查找命令合同
 */
function findCommand(commands: ReturnType<typeof getHelpDocsOutput>["commands"], name: string) {
  return commands.find((cmd) => cmd.name === name);
}

// ============================================
// 测试
// ============================================

describe("P5.7-R5-3: Help-Docs 回归锁", () => {
  describe("合同可发现锁", () => {
    it("help-docs --json 必须包含 msgcode todo add 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo add");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("待办");
      expect(cmd?.options?.required).toHaveProperty("--workspace");
    });

    it("help-docs --json 必须包含 msgcode todo list 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo list");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("列出");
      expect(cmd?.options?.required).toHaveProperty("--workspace");
      expect(cmd?.options?.optional).toHaveProperty("--status");
    });

    it("help-docs --json 必须包含 msgcode todo done 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo done");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("完成");
      expect(cmd?.options?.required).toHaveProperty("--workspace");
    });

    it("help-docs --json 必须包含 msgcode schedule add 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule add");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("添加");
      expect(cmd?.options?.required).toHaveProperty("--workspace");
      expect(cmd?.options?.required).toHaveProperty("--cron");
      expect(cmd?.options?.required).toHaveProperty("--tz");
      expect(cmd?.options?.required).toHaveProperty("--message");
    });

    it("help-docs --json 必须包含 msgcode schedule list 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule list");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("列出");
      expect(cmd?.options?.required).toHaveProperty("--workspace");
    });

    it("help-docs --json 必须包含 msgcode schedule remove 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule remove");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("删除");
      expect(cmd?.options?.required).toHaveProperty("--workspace");
    });

    it("help-docs --json 必须包含 msgcode schedule enable 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule enable");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("启用");
      expect(cmd?.options?.required).toHaveProperty("--workspace");
    });

    it("help-docs --json 必须包含 msgcode schedule disable 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule disable");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("禁用");
      expect(cmd?.options?.required).toHaveProperty("--workspace");
    });
  });

  describe("Todo 错误码枚举锁", () => {
    it("todo add 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo add");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("TODO_EMPTY_TITLE");
      expect(cmd?.errorCodes).toContain("TODO_WORKSPACE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("TODO_ADD_FAILED");

      // 锁定数量，防止意外增减
      expect(cmd?.errorCodes?.length).toBe(3);
    });

    it("todo list 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo list");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("TODO_WORKSPACE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("TODO_LIST_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(2);
    });

    it("todo done 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo done");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("TODO_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("TODO_WORKSPACE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("TODO_DONE_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(3);
    });
  });

  describe("Schedule 错误码枚举锁", () => {
    it("schedule add 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule add");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("SCHEDULE_INVALID_CRON");
      expect(cmd?.errorCodes).toContain("SCHEDULE_ALREADY_EXISTS");
      expect(cmd?.errorCodes).toContain("SCHEDULE_WORKSPACE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("SCHEDULE_ADD_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(4);
    });

    it("schedule list 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule list");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("SCHEDULE_WORKSPACE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("SCHEDULE_LIST_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(2);
    });

    it("schedule remove 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule remove");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("SCHEDULE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("SCHEDULE_WORKSPACE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("SCHEDULE_REMOVE_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(3);
    });

    it("schedule enable 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule enable");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("SCHEDULE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("SCHEDULE_WORKSPACE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("SCHEDULE_ENABLE_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(3);
    });

    it("schedule disable 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule disable");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("SCHEDULE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("SCHEDULE_WORKSPACE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("SCHEDULE_DISABLE_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(3);
    });
  });

  describe("参数口径锁", () => {
    it("todo add 必填参数口径必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo add");

      expect(cmd?.options?.required).toBeDefined();
      const requiredKeys = Object.keys(cmd?.options?.required || {});
      expect(requiredKeys).toContain("--workspace");

      // 锁定数量
      expect(requiredKeys.length).toBe(1);
    });

    it("schedule add 必填参数口径必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule add");

      expect(cmd?.options?.required).toBeDefined();
      const requiredKeys = Object.keys(cmd?.options?.required || {});
      expect(requiredKeys).toContain("--workspace");
      expect(requiredKeys).toContain("--cron");
      expect(requiredKeys).toContain("--tz");
      expect(requiredKeys).toContain("--message");

      // 锁定数量
      expect(requiredKeys.length).toBe(4);
    });
  });

  describe("输出结构锁", () => {
    it("todo add 输出结构必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo add");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("taskId");
      expect(cmd?.output).toHaveProperty("title");
      expect(cmd?.output).toHaveProperty("createdAt");
    });

    it("todo list 输出结构必须冻结（支持空列表）", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo list");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("count");
      expect(cmd?.output).toHaveProperty("items");
    });

    it("todo done 输出结构必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode todo done");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("taskId");
      expect(cmd?.output).toHaveProperty("doneAt");
      expect(cmd?.output).toHaveProperty("status");
    });

    it("schedule add 输出结构必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule add");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("scheduleId");
      expect(cmd?.output).toHaveProperty("cron");
      expect(cmd?.output).toHaveProperty("task");
      expect(cmd?.output).toHaveProperty("createdAt");
    });

    it("schedule list 输出结构必须冻结（支持空列表）", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule list");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("count");
      expect(cmd?.output).toHaveProperty("items");
    });

    it("schedule remove 输出结构必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode schedule remove");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("scheduleId");
      expect(cmd?.output).toHaveProperty("removedAt");
    });
  });

  describe("Envelope 结构锁", () => {
    it("help-docs --json 必须返回有效的 Envelope 结构", () => {
      const output = execCliStdoutIsolated(["help-docs", "--json"]);

      const envelope = JSON.parse(output);

      // Envelope 核心字段
      expect(envelope.schemaVersion).toBe(2);
      expect(envelope.command).toBe("msgcode help-docs");
      expect(envelope.status).toBe("pass");
      expect(envelope.exitCode).toBe(0);

      // data 结构
      expect(envelope.data).toBeDefined();
      expect(envelope.data.version).toBeDefined();
      expect(Array.isArray(envelope.data.commands)).toBe(true);
      expect(envelope.data.commands.length).toBeGreaterThan(0);
    });
  });

  describe("命令数量回归锁", () => {
    it("help-docs 必须包含至少 8 个 todo/schedule 命令", () => {
      const { commands } = getHelpDocsOutput();

      const todoCommands = commands.filter((cmd) => cmd.name.startsWith("msgcode todo"));
      const scheduleCommands = commands.filter((cmd) => cmd.name.startsWith("msgcode schedule"));

      expect(todoCommands.length).toBe(3); // add, list, done
      expect(scheduleCommands.length).toBe(6); // add, list, remove, enable, disable, migrate-v1-to-v2
    });
  });
});

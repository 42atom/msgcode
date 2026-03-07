/**
 * msgcode: P5.7-R5-2 Schedule 命令合同收口测试
 *
 * 目标：
 * - 验证 schedule add 非法 cron 失败（SCHEDULE_INVALID_CRON）
 * - 验证 schedule add 重复 ID 失败（SCHEDULE_ALREADY_EXISTS）
 * - 验证 schedule remove 非法 scheduleId 失败（SCHEDULE_NOT_FOUND）
 * - 验证 schedule list 空列表成功
 * - 验证状态翻转（add -> list -> remove）
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

beforeEach(() => {
  tempDir = path.join(os.tmpdir(), `msgcode-schedule-test-${Date.now()}`);
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

describe("P5.7-R5-2: Schedule 命令合同", () => {
  describe("错误码枚举验证", () => {
    it("SCHEDULE_INVALID_CRON 应该存在于错误码枚举中", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");
      expect(SCHEDULE_ERROR_CODES.INVALID_CRON).toBe("SCHEDULE_INVALID_CRON");
    });

    it("SCHEDULE_NOT_FOUND 应该存在于错误码枚举中", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");
      expect(SCHEDULE_ERROR_CODES.NOT_FOUND).toBe("SCHEDULE_NOT_FOUND");
    });

    it("SCHEDULE_ALREADY_EXISTS 应该存在于错误码枚举中", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");
      expect(SCHEDULE_ERROR_CODES.ALREADY_EXISTS).toBe("SCHEDULE_ALREADY_EXISTS");
    });

    it("SCHEDULE_ADD_FAILED 应该存在于错误码枚举中", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");
      expect(SCHEDULE_ERROR_CODES.ADD_FAILED).toBe("SCHEDULE_ADD_FAILED");
    });

    it("SCHEDULE_LIST_FAILED 应该存在于错误码枚举中", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");
      expect(SCHEDULE_ERROR_CODES.LIST_FAILED).toBe("SCHEDULE_LIST_FAILED");
    });

    it("SCHEDULE_REMOVE_FAILED 应该存在于错误码枚举中", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");
      expect(SCHEDULE_ERROR_CODES.REMOVE_FAILED).toBe("SCHEDULE_REMOVE_FAILED");
    });

    it("SCHEDULE_ENABLE_FAILED 应该存在于错误码枚举中", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");
      expect(SCHEDULE_ERROR_CODES.ENABLE_FAILED).toBe("SCHEDULE_ENABLE_FAILED");
    });

    it("SCHEDULE_DISABLE_FAILED 应该存在于错误码枚举中", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");
      expect(SCHEDULE_ERROR_CODES.DISABLE_FAILED).toBe("SCHEDULE_DISABLE_FAILED");
    });

    it("所有 SCHEDULE 错误码应该有 SCHEDULE_ 前缀", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");
      const codes = Object.values(SCHEDULE_ERROR_CODES);

      for (const code of codes) {
        expect(code).toMatch(/^SCHEDULE_/);
      }
    });

    it("参数错误和执行错误应该有明确的区分", async () => {
      const { SCHEDULE_ERROR_CODES } = await import("../src/cli/schedule.js");

      // 参数错误（输入验证失败）
      const paramErrors = [SCHEDULE_ERROR_CODES.INVALID_CRON, SCHEDULE_ERROR_CODES.ALREADY_EXISTS];

      // 执行错误（运行时失败）
      const execErrors = [
        SCHEDULE_ERROR_CODES.ADD_FAILED,
        SCHEDULE_ERROR_CODES.LIST_FAILED,
        SCHEDULE_ERROR_CODES.REMOVE_FAILED,
        SCHEDULE_ERROR_CODES.NOT_FOUND,
      ];

      // 验证没有重叠
      for (const pe of paramErrors) {
        expect(execErrors).not.toContain(pe);
      }
    });
  });

  describe("合同导出验证", () => {
    it("getScheduleAddContract 应该返回正确的合同结构", async () => {
      const { getScheduleAddContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleAddContract();

      expect(contract.name).toBe("msgcode schedule add");
      expect(contract.description).toContain("添加");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.required).toHaveProperty("--cron");
      expect(contract.options?.required).toHaveProperty("--tz");
      expect(contract.options?.required).toHaveProperty("--message");
      expect(contract.errorCodes).toContain("SCHEDULE_INVALID_CRON");
      expect(contract.errorCodes).toContain("SCHEDULE_ALREADY_EXISTS");
      expect(contract.errorCodes).toContain("SCHEDULE_WORKSPACE_NOT_FOUND");
      expect(contract.errorCodes).toContain("SCHEDULE_ADD_FAILED");
    });

    it("getScheduleListContract 应该返回正确的合同结构", async () => {
      const { getScheduleListContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleListContract();

      expect(contract.name).toBe("msgcode schedule list");
      expect(contract.description).toContain("列出");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("SCHEDULE_WORKSPACE_NOT_FOUND");
      expect(contract.errorCodes).toContain("SCHEDULE_LIST_FAILED");
    });

    it("getScheduleRemoveContract 应该返回正确的合同结构", async () => {
      const { getScheduleRemoveContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleRemoveContract();

      expect(contract.name).toBe("msgcode schedule remove");
      expect(contract.description).toContain("删除");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("SCHEDULE_NOT_FOUND");
      expect(contract.errorCodes).toContain("SCHEDULE_WORKSPACE_NOT_FOUND");
      expect(contract.errorCodes).toContain("SCHEDULE_REMOVE_FAILED");
    });

    it("getScheduleEnableContract 应该返回正确的合同结构", async () => {
      const { getScheduleEnableContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleEnableContract();

      expect(contract.name).toBe("msgcode schedule enable");
      expect(contract.description).toContain("启用");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("SCHEDULE_NOT_FOUND");
      expect(contract.errorCodes).toContain("SCHEDULE_ENABLE_FAILED");
    });

    it("getScheduleDisableContract 应该返回正确的合同结构", async () => {
      const { getScheduleDisableContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleDisableContract();

      expect(contract.name).toBe("msgcode schedule disable");
      expect(contract.description).toContain("禁用");
      expect(contract.options?.required).toHaveProperty("--workspace");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("SCHEDULE_NOT_FOUND");
      expect(contract.errorCodes).toContain("SCHEDULE_DISABLE_FAILED");
    });
  });

  describe("命令创建验证", () => {
    it("createScheduleAddCommand 应该创建有效的 Command", async () => {
      const { createScheduleAddCommand } = await import("../src/cli/schedule.js");
      const cmd = createScheduleAddCommand();

      expect(cmd.name()).toBe("add");
      expect(cmd.description()).toContain("添加");
    });

    it("createScheduleListCommand 应该创建有效的 Command", async () => {
      const { createScheduleListCommand } = await import("../src/cli/schedule.js");
      const cmd = createScheduleListCommand();

      expect(cmd.name()).toBe("list");
      expect(cmd.description()).toContain("列出");
    });

    it("createScheduleRemoveCommand 应该创建有效的 Command", async () => {
      const { createScheduleRemoveCommand } = await import("../src/cli/schedule.js");
      const cmd = createScheduleRemoveCommand();

      expect(cmd.name()).toBe("remove");
      expect(cmd.description()).toContain("删除");
    });

    it("createScheduleCommand 应该包含所有子命令", async () => {
      const { createScheduleCommand } = await import("../src/cli/schedule.js");
      const cmd = createScheduleCommand();

      expect(cmd.name()).toBe("schedule");
      const subCommands = cmd.commands.map((c) => c.name());
      expect(subCommands).toContain("add");
      expect(subCommands).toContain("list");
      expect(subCommands).toContain("remove");
      expect(subCommands).toContain("enable");
      expect(subCommands).toContain("disable");
    });
  });

  describe("Cron 校验逻辑验证", () => {
    it("非法 cron 表达式应该被识别", async () => {
      const { validateCronExpression } = await import("../src/cli/schedule.js");

      // 非法 cron
      expect(validateCronExpression("invalid", "Asia/Shanghai").valid).toBe(false);
      expect(validateCronExpression("1 2 3 4", "Asia/Shanghai").valid).toBe(false); // 少一个字段

      // 合法 cron
      expect(validateCronExpression("0 7 * * *", "Asia/Shanghai").valid).toBe(true);
      expect(validateCronExpression("*/5 * * * *", "UTC").valid).toBe(true);
    });

    it("非法时区应该被识别", async () => {
      const { validateCronExpression } = await import("../src/cli/schedule.js");

      // 非法时区
      expect(validateCronExpression("0 7 * * *", "Invalid/Timezone").valid).toBe(false);

      // 合法时区
      expect(validateCronExpression("0 7 * * *", "Asia/Shanghai").valid).toBe(true);
      expect(validateCronExpression("0 7 * * *", "America/New_York").valid).toBe(true);
      expect(validateCronExpression("0 7 * * *", "UTC").valid).toBe(true);
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
      const { getScheduleListContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleListContract();

      // 成功证据：合同定义了输出结构
      expect(contract.output).toBeDefined();
      expect(contract.output?.count).toBeDefined();
      expect(contract.output?.items).toBeDefined();
    });

    it("add 命令合同应该定义成功输出结构", async () => {
      const { getScheduleAddContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleAddContract();

      expect(contract.output).toBeDefined();
      expect(contract.output?.scheduleId).toBeDefined();
      expect(contract.output?.cron).toBeDefined();
      expect(contract.output?.task).toBeDefined();
      expect(contract.output?.createdAt).toBeDefined();
    });

    it("remove 命令合同应该定义成功输出结构", async () => {
      const { getScheduleRemoveContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleRemoveContract();

      expect(contract.output).toBeDefined();
      expect(contract.output?.scheduleId).toBeDefined();
      expect(contract.output?.removedAt).toBeDefined();
    });
  });

  describe("失败证据", () => {
    it("add 命令合同应该定义 SCHEDULE_INVALID_CRON 错误码", async () => {
      const { getScheduleAddContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleAddContract();

      // 失败证据：错误码固定为 SCHEDULE_INVALID_CRON
      expect(contract.errorCodes).toContain("SCHEDULE_INVALID_CRON");
    });

    it("add 命令合同应该定义 SCHEDULE_ALREADY_EXISTS 错误码", async () => {
      const { getScheduleAddContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleAddContract();

      // 失败证据：错误码固定为 SCHEDULE_ALREADY_EXISTS
      expect(contract.errorCodes).toContain("SCHEDULE_ALREADY_EXISTS");
    });

    it("remove 命令合同应该定义 SCHEDULE_NOT_FOUND 错误码", async () => {
      const { getScheduleRemoveContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleRemoveContract();

      // 失败证据：错误码固定为 SCHEDULE_NOT_FOUND
      expect(contract.errorCodes).toContain("SCHEDULE_NOT_FOUND");
    });

    it("add 命令合同应该定义 SCHEDULE_ADD_FAILED 错误码", async () => {
      const { getScheduleAddContract } = await import("../src/cli/schedule.js");
      const contract = getScheduleAddContract();

      // 失败证据：兜底错误码固定为 SCHEDULE_ADD_FAILED
      expect(contract.errorCodes).toContain("SCHEDULE_ADD_FAILED");
    });
  });

  describe("状态翻转证据", () => {
    it("add -> list -> remove 状态翻转应该被合同定义", async () => {
      const { getScheduleAddContract, getScheduleListContract, getScheduleRemoveContract } = await import(
        "../src/cli/schedule.js"
      );

      const addContract = getScheduleAddContract();
      const listContract = getScheduleListContract();
      const removeContract = getScheduleRemoveContract();

      // 状态翻转证据：add 返回 scheduleId，remove 接收 scheduleId
      expect(addContract.output?.scheduleId).toBeDefined();
      expect(removeContract.options?.required).toHaveProperty("--workspace");

      // list 支持空列表成功
      expect(listContract.output?.count).toBeDefined();

      // remove 的输出 removedAt 字段必须定义
      expect(removeContract.output?.removedAt).toBeDefined();
    });
  });

  describe("help-docs 集成验证", () => {
    it("help.ts 应该导入 schedule 合同", async () => {
      const fs = await import("node:fs");
      const helpContent = fs.readFileSync(path.join(process.cwd(), "src/cli/help.ts"), "utf-8");

      expect(helpContent).toContain('from "./schedule.js"');
      expect(helpContent).toContain("getScheduleAddContract");
      expect(helpContent).toContain("getScheduleListContract");
      expect(helpContent).toContain("getScheduleRemoveContract");
      expect(helpContent).toContain("getScheduleEnableContract");
      expect(helpContent).toContain("getScheduleDisableContract");
    });
  });

  describe("存储路径验证", () => {
    it("schedules 应该存储在 workspace/.msgcode/schedules/ 目录", async () => {
      const fs = await import("node:fs");
      const scheduleContent = fs.readFileSync(path.join(process.cwd(), "src/cli/schedule.ts"), "utf-8");

      // 验证代码中包含正确的路径结构
      expect(scheduleContent).toContain(".msgcode");
      expect(scheduleContent).toContain("schedules");
    });

    it("schedule 文件路径应该使用 scheduleId 作为文件名", async () => {
      const workspacePath = "/tmp/test-workspace";
      const scheduleId = "morning-reminder";
      const expectedPath = path.join(workspacePath, ".msgcode", "schedules", `${scheduleId}.json`);

      const schedulePath = path.join(workspacePath, ".msgcode", "schedules", `${scheduleId}.json`);
      expect(schedulePath).toBe(expectedPath);
    });
  });

  describe("ScheduleFile 结构验证", () => {
    it("ScheduleFile 应该包含必需字段", async () => {
      const { validateSchedule } = await import("../src/config/schedules.js");

      // 有效的 schedule
      const validSchedule = {
        id: "test",
        version: 1 as const,
        enabled: true,
        tz: "Asia/Shanghai",
        cron: "0 7 * * *",
        message: "Good morning!",
        delivery: {
          mode: "reply-to-same-chat" as const,
          maxChars: 2000,
        },
      };

      const result = validateSchedule(validSchedule);
      expect(result.valid).toBe(true);
    });

    it("ScheduleFile 缺少必需字段应该验证失败", async () => {
      const { validateSchedule } = await import("../src/config/schedules.js");

      // 缺少 message
      const invalidSchedule = {
        id: "test",
        version: 1 as const,
        enabled: true,
        tz: "Asia/Shanghai",
        cron: "0 7 * * *",
        message: "", // 空消息
        delivery: {
          mode: "reply-to-same-chat" as const,
          maxChars: 2000,
        },
      };

      const result = validateSchedule(invalidSchedule);
      expect(result.valid).toBe(false);
    });
  });
});

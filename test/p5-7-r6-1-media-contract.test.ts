/**
 * msgcode: P5.7-R6-1 Media 命令合同收口测试
 *
 * 目标：
 * - 验证 media screen 错误码枚举
 * - 验证命令合同结构
 * - 验证 help-docs 集成
 *
 * 断言口径：行为断言优先，禁止源码字符串匹配
 */

import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";

// ============================================
// 测试
// ============================================

describe("P5.7-R6-1: Media 命令合同", () => {
  describe("错误码枚举验证", () => {
    it("MEDIA_SCREEN_FAILED 应该存在于错误码枚举中", async () => {
      const { MEDIA_ERROR_CODES } = await import("../src/cli/media.js");
      expect(MEDIA_ERROR_CODES.SCREEN_FAILED).toBe("MEDIA_SCREEN_FAILED");
    });

    it("MEDIA_OUTPUT_PATH_INVALID 应该存在于错误码枚举中", async () => {
      const { MEDIA_ERROR_CODES } = await import("../src/cli/media.js");
      expect(MEDIA_ERROR_CODES.OUTPUT_PATH_INVALID).toBe("MEDIA_OUTPUT_PATH_INVALID");
    });

    it("所有 MEDIA 错误码应该有 MEDIA_ 前缀", async () => {
      const { MEDIA_ERROR_CODES } = await import("../src/cli/media.js");
      const codes = Object.values(MEDIA_ERROR_CODES);

      for (const code of codes) {
        expect(code).toMatch(/^MEDIA_/);
      }
    });
  });

  describe("合同导出验证", () => {
    it("getMediaScreenContract 应该返回正确的合同结构", async () => {
      const { getMediaScreenContract } = await import("../src/cli/media.js");
      const contract = getMediaScreenContract();

      expect(contract.name).toBe("msgcode media screen");
      expect(contract.description).toContain("截图");
      expect(contract.options?.optional).toHaveProperty("--output");
      expect(contract.options?.optional).toHaveProperty("--json");
      expect(contract.errorCodes).toContain("MEDIA_SCREEN_FAILED");
      expect(contract.errorCodes).toContain("MEDIA_OUTPUT_PATH_INVALID");
    });
  });

  describe("命令创建验证", () => {
    it("createMediaScreenCommand 应该创建有效的 Command", async () => {
      const { createMediaScreenCommand } = await import("../src/cli/media.js");
      const cmd = createMediaScreenCommand();

      expect(cmd.name()).toBe("screen");
      expect(cmd.description()).toContain("截图");
    });

    it("createMediaCommand 应该包含 screen 子命令", async () => {
      const { createMediaCommand } = await import("../src/cli/media.js");
      const cmd = createMediaCommand();

      expect(cmd.name()).toBe("media");
      const subCommands = cmd.commands.map((c) => c.name());
      expect(subCommands).toContain("screen");
    });
  });

  describe("help-docs 集成验证", () => {
    it("help-docs --json 必须包含 msgcode media screen 合同", () => {
      const output = execSync("NODE_OPTIONS='--import tsx' node src/cli.ts help-docs --json", {
        encoding: "utf-8",
      });

      const envelope = JSON.parse(output);
      expect(envelope.status).toBe("pass");

      const commands = envelope.data.commands;
      const mediaScreen = commands.find(
        (cmd: { name: string }) => cmd.name === "msgcode media screen"
      );

      expect(mediaScreen).toBeDefined();
      expect(mediaScreen.description).toContain("截图");
      expect(mediaScreen.errorCodes).toContain("MEDIA_SCREEN_FAILED");
    });
  });

  describe("输出结构验证", () => {
    it("media screen 输出结构必须定义", async () => {
      const { getMediaScreenContract } = await import("../src/cli/media.js");
      const contract = getMediaScreenContract();

      expect(contract.output).toBeDefined();
      expect(contract.output).toHaveProperty("path");
      expect(contract.output).toHaveProperty("filename");
      expect(contract.output).toHaveProperty("capturedAt");
    });
  });

  describe("命令行帮助验证", () => {
    it("media --help 应该显示 screen 子命令", () => {
      const output = execSync("NODE_OPTIONS='--import tsx' node src/cli.ts media --help", {
        encoding: "utf-8",
      });

      expect(output).toContain("screen");
      expect(output).toContain("截图");
    });
  });
});

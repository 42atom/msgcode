/**
 * msgcode: P5.7-R6-2 Gen Image 命令合同收口测试
 *
 * 目标：
 * - 验证 gen image/selfie 错误码枚举
 * - 验证命令合同结构
 * - 验证 help-docs 集成
 *
 * 断言口径：行为断言优先，禁止源码字符串匹配
 */

import { describe, it, expect } from "bun:test";
import { execCliStdoutIsolated } from "./helpers/cli-process.js";

// ============================================
// 测试
// ============================================

describe("P5.7-R6-2: Gen Image 命令合同", () => {
  describe("错误码枚举验证", () => {
    it("GEN_API_KEY_MISSING 应该存在于错误码枚举中", async () => {
      const { GEN_IMAGE_ERROR_CODES } = await import("../src/cli/gen-image.js");
      expect(GEN_IMAGE_ERROR_CODES.API_KEY_MISSING).toBe("GEN_API_KEY_MISSING");
    });

    it("GEN_INVALID_PROMPT 应该存在于错误码枚举中", async () => {
      const { GEN_IMAGE_ERROR_CODES } = await import("../src/cli/gen-image.js");
      expect(GEN_IMAGE_ERROR_CODES.INVALID_PROMPT).toBe("GEN_INVALID_PROMPT");
    });

    it("GEN_REF_IMAGE_NOT_FOUND 应该存在于错误码枚举中", async () => {
      const { GEN_IMAGE_ERROR_CODES } = await import("../src/cli/gen-image.js");
      expect(GEN_IMAGE_ERROR_CODES.REF_IMAGE_NOT_FOUND).toBe("GEN_REF_IMAGE_NOT_FOUND");
    });

    it("GEN_IMAGE_GENERATION_FAILED 应该存在于错误码枚举中", async () => {
      const { GEN_IMAGE_ERROR_CODES } = await import("../src/cli/gen-image.js");
      expect(GEN_IMAGE_ERROR_CODES.IMAGE_GENERATION_FAILED).toBe("GEN_IMAGE_GENERATION_FAILED");
    });

    it("所有 GEN_IMAGE 错误码应该有 GEN_ 前缀", async () => {
      const { GEN_IMAGE_ERROR_CODES } = await import("../src/cli/gen-image.js");
      const codes = Object.values(GEN_IMAGE_ERROR_CODES);

      for (const code of codes) {
        expect(code).toMatch(/^GEN_/);
      }
    });
  });

  describe("合同导出验证", () => {
    it("getGenImageContract 应该返回正确的合同结构", async () => {
      const { getGenImageContract } = await import("../src/cli/gen-image.js");
      const contract = getGenImageContract();

      expect(contract.name).toBe("msgcode gen image");
      expect(contract.description).toContain("图片生成");
      expect(contract.options?.required).toHaveProperty("--prompt");
      expect(contract.options?.optional).toHaveProperty("--aspect-ratio");
      expect(contract.options?.optional).toHaveProperty("--output");
      expect(contract.errorCodes).toContain("GEN_API_KEY_MISSING");
      expect(contract.errorCodes).toContain("GEN_INVALID_PROMPT");
      expect(contract.errorCodes).toContain("GEN_IMAGE_GENERATION_FAILED");
    });

    it("getGenSelfieContract 应该返回正确的合同结构", async () => {
      const { getGenSelfieContract } = await import("../src/cli/gen-image.js");
      const contract = getGenSelfieContract();

      expect(contract.name).toBe("msgcode gen selfie");
      expect(contract.description).toContain("自拍");
      expect(contract.options?.required).toHaveProperty("--ref");
      expect(contract.options?.optional).toHaveProperty("--prompt");
      expect(contract.errorCodes).toContain("GEN_API_KEY_MISSING");
      expect(contract.errorCodes).toContain("GEN_REF_IMAGE_NOT_FOUND");
      expect(contract.errorCodes).toContain("GEN_IMAGE_GENERATION_FAILED");
    });
  });

  describe("命令创建验证", () => {
    it("createGenImageCommand 应该创建有效的 Command", async () => {
      const { createGenImageCommand } = await import("../src/cli/gen-image.js");
      const cmd = createGenImageCommand();

      expect(cmd.name()).toBe("image");
      expect(cmd.description()).toContain("图片生成");
    });

    it("createGenSelfieCommand 应该创建有效的 Command", async () => {
      const { createGenSelfieCommand } = await import("../src/cli/gen-image.js");
      const cmd = createGenSelfieCommand();

      expect(cmd.name()).toBe("selfie");
      expect(cmd.description()).toContain("自拍");
    });

    it("createGenImageCommandGroup 应该包含 image 和 selfie 子命令", async () => {
      const { createGenImageCommandGroup } = await import("../src/cli/gen-image.js");
      const cmd = createGenImageCommandGroup();

      expect(cmd.name()).toBe("gen-image");
      const subCommands = cmd.commands.map((c) => c.name());
      expect(subCommands).toContain("image");
      expect(subCommands).toContain("selfie");
    });
  });

  describe("help-docs 集成验证", () => {
    it("help-docs --json 必须包含 msgcode gen image 合同", () => {
      const output = execCliStdoutIsolated(["help-docs", "--json"]);

      const envelope = JSON.parse(output);
      expect(envelope.status).toBe("pass");

      const commands = envelope.data.commands;
      const genImage = commands.find(
        (cmd: { name: string }) => cmd.name === "msgcode gen image"
      );

      expect(genImage).toBeDefined();
      expect(genImage.description).toContain("图片生成");
      expect(genImage.errorCodes).toContain("GEN_API_KEY_MISSING");
    });

    it("help-docs --json 必须包含 msgcode gen selfie 合同", () => {
      const output = execCliStdoutIsolated(["help-docs", "--json"]);

      const envelope = JSON.parse(output);
      expect(envelope.status).toBe("pass");

      const commands = envelope.data.commands;
      const genSelfie = commands.find(
        (cmd: { name: string }) => cmd.name === "msgcode gen selfie"
      );

      expect(genSelfie).toBeDefined();
      expect(genSelfie.description).toContain("自拍");
      expect(genSelfie.errorCodes).toContain("GEN_REF_IMAGE_NOT_FOUND");
    });
  });

  describe("输出结构验证", () => {
    it("gen image 输出结构必须定义", async () => {
      const { getGenImageContract } = await import("../src/cli/gen-image.js");
      const contract = getGenImageContract();

      expect(contract.output).toBeDefined();
      expect(contract.output).toHaveProperty("prompt");
      expect(contract.output).toHaveProperty("outputPath");
      expect(contract.output).toHaveProperty("aspectRatio");
      expect(contract.output).toHaveProperty("generatedAt");
    });

    it("gen selfie 输出结构必须定义", async () => {
      const { getGenSelfieContract } = await import("../src/cli/gen-image.js");
      const contract = getGenSelfieContract();

      expect(contract.output).toBeDefined();
      expect(contract.output).toHaveProperty("refImage");
      expect(contract.output).toHaveProperty("outputPath");
      expect(contract.output).toHaveProperty("generatedAt");
    });
  });

  describe("命令行帮助验证", () => {
    it("gen-image --help 应该显示 image 和 selfie 子命令", () => {
      const output = execCliStdoutIsolated(["gen-image", "--help"]);

      expect(output).toContain("image");
      expect(output).toContain("selfie");
    });
  });
});

/**
 * msgcode: P5.7-R6-4 Media/Gen 回归锁测试
 *
 * 目标：
 * - 验证 help-docs --json 完整暴露 media/gen 合同
 * - 回归锁：错误码枚举与参数口径冻结
 * - 全行为断言，禁止源码字符串匹配
 */

import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";

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
  const output = execSync("npx tsx src/cli.ts help-docs --json", {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

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

describe("P5.7-R6-4: Media/Gen 回归锁", () => {
  describe("合同可发现锁", () => {
    it("help-docs --json 必须包含 msgcode media screen 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode media screen");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("截图");
      expect(cmd?.options?.optional).toHaveProperty("--output");
    });

    it("help-docs --json 必须包含 msgcode gen image 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen image");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("图片生成");
      expect(cmd?.options?.required).toHaveProperty("--prompt");
      expect(cmd?.options?.optional).toHaveProperty("--aspect-ratio");
    });

    it("help-docs --json 必须包含 msgcode gen selfie 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen selfie");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("自拍");
      expect(cmd?.options?.required).toHaveProperty("--ref");
    });

    it("help-docs --json 必须包含 msgcode gen tts 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen tts");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("语音合成");
      expect(cmd?.options?.required).toHaveProperty("--text");
      expect(cmd?.options?.optional).toHaveProperty("--voice");
    });

    it("help-docs --json 必须包含 msgcode gen music 合同", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen music");

      expect(cmd).toBeDefined();
      expect(cmd?.description).toContain("音乐生成");
      expect(cmd?.options?.required).toHaveProperty("--prompt");
      expect(cmd?.options?.optional).toHaveProperty("--format");
    });
  });

  describe("Media 错误码枚举锁", () => {
    it("media screen 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode media screen");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("MEDIA_SCREEN_FAILED");
      expect(cmd?.errorCodes).toContain("MEDIA_OUTPUT_PATH_INVALID");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(2);
    });
  });

  describe("Gen Image 错误码枚举锁", () => {
    it("gen image 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen image");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("GEN_API_KEY_MISSING");
      expect(cmd?.errorCodes).toContain("GEN_INVALID_PROMPT");
      expect(cmd?.errorCodes).toContain("GEN_IMAGE_GENERATION_FAILED");
      expect(cmd?.errorCodes).toContain("GEN_OUTPUT_SAVE_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(4);
    });

    it("gen selfie 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen selfie");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("GEN_API_KEY_MISSING");
      expect(cmd?.errorCodes).toContain("GEN_REF_IMAGE_NOT_FOUND");
      expect(cmd?.errorCodes).toContain("GEN_IMAGE_GENERATION_FAILED");
      expect(cmd?.errorCodes).toContain("GEN_OUTPUT_SAVE_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(4);
    });
  });

  describe("Gen Audio 错误码枚举锁", () => {
    it("gen tts 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen tts");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("GEN_API_KEY_MISSING");
      expect(cmd?.errorCodes).toContain("GEN_EMPTY_TEXT");
      expect(cmd?.errorCodes).toContain("GEN_TTS_FAILED");
      expect(cmd?.errorCodes).toContain("GEN_OUTPUT_SAVE_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(4);
    });

    it("gen music 错误码必须冻结为固定集合", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen music");

      expect(cmd?.errorCodes).toBeDefined();
      expect(cmd?.errorCodes).toContain("GEN_API_KEY_MISSING");
      expect(cmd?.errorCodes).toContain("GEN_EMPTY_TEXT");
      expect(cmd?.errorCodes).toContain("GEN_MUSIC_FAILED");
      expect(cmd?.errorCodes).toContain("GEN_OUTPUT_SAVE_FAILED");

      // 锁定数量
      expect(cmd?.errorCodes?.length).toBe(4);
    });
  });

  describe("参数口径锁", () => {
    it("media screen 必填参数应该为空（全部可选）", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode media screen");

      const requiredKeys = Object.keys(cmd?.options?.required || {});
      expect(requiredKeys.length).toBe(0);
    });

    it("gen image 必填参数口径必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen image");

      const requiredKeys = Object.keys(cmd?.options?.required || {});
      expect(requiredKeys).toContain("--prompt");
      expect(requiredKeys.length).toBe(1);
    });

    it("gen selfie 必填参数口径必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen selfie");

      const requiredKeys = Object.keys(cmd?.options?.required || {});
      expect(requiredKeys).toContain("--ref");
      expect(requiredKeys.length).toBe(1);
    });

    it("gen tts 必填参数口径必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen tts");

      const requiredKeys = Object.keys(cmd?.options?.required || {});
      expect(requiredKeys).toContain("--text");
      expect(requiredKeys.length).toBe(1);
    });

    it("gen music 必填参数口径必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen music");

      const requiredKeys = Object.keys(cmd?.options?.required || {});
      expect(requiredKeys).toContain("--prompt");
      expect(requiredKeys.length).toBe(1);
    });
  });

  describe("输出结构锁", () => {
    it("media screen 输出结构必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode media screen");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("path");
      expect(cmd?.output).toHaveProperty("filename");
      expect(cmd?.output).toHaveProperty("capturedAt");
    });

    it("gen image 输出结构必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen image");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("prompt");
      expect(cmd?.output).toHaveProperty("outputPath");
      expect(cmd?.output).toHaveProperty("aspectRatio");
      expect(cmd?.output).toHaveProperty("generatedAt");
    });

    it("gen selfie 输出结构必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen selfie");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("refImage");
      expect(cmd?.output).toHaveProperty("outputPath");
      expect(cmd?.output).toHaveProperty("generatedAt");
    });

    it("gen tts 输出结构必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen tts");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("text");
      expect(cmd?.output).toHaveProperty("voice");
      expect(cmd?.output).toHaveProperty("outputPath");
      expect(cmd?.output).toHaveProperty("generatedAt");
    });

    it("gen music 输出结构必须冻结", () => {
      const { commands } = getHelpDocsOutput();
      const cmd = findCommand(commands, "msgcode gen music");

      expect(cmd?.output).toBeDefined();
      expect(cmd?.output).toHaveProperty("prompt");
      expect(cmd?.output).toHaveProperty("format");
      expect(cmd?.output).toHaveProperty("outputPath");
      expect(cmd?.output).toHaveProperty("generatedAt");
    });
  });

  describe("命令数量回归锁", () => {
    it("help-docs 必须包含至少 5 个 media/gen 命令", () => {
      const { commands } = getHelpDocsOutput();

      const mediaCommands = commands.filter((cmd) => cmd.name.startsWith("msgcode media"));
      const genCommands = commands.filter((cmd) => cmd.name.startsWith("msgcode gen"));

      expect(mediaCommands.length).toBe(1); // screen
      expect(genCommands.length).toBe(4); // image, selfie, tts, music
    });
  });

  describe("Envelope 结构锁", () => {
    it("help-docs --json 必须返回有效的 Envelope 结构", () => {
      const output = execSync("npx tsx src/cli.ts help-docs --json", {
        encoding: "utf-8",
      });

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
});

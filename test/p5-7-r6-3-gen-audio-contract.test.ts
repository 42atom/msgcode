/**
 * msgcode: P5.7-R6-3 Gen Audio 命令合同收口测试
 *
 * 目标：
 * - 验证 gen tts/music 错误码枚举
 * - 验证命令合同结构
 * - 验证 help-docs 集成
 *
 * 断言口径：行为断言优先，禁止源码字符串匹配
 */

import { describe, it, expect } from "bun:test";
import { execCliStdoutIsolated, runCliIsolated } from "./helpers/cli-process.js";

// ============================================
// 测试
// ============================================

describe("P5.7-R6-3: Gen Audio 命令合同", () => {
  describe("错误码枚举验证", () => {
    it("GEN_API_KEY_MISSING 应该存在于错误码枚举中", async () => {
      const { GEN_AUDIO_ERROR_CODES } = await import("../src/cli/gen-audio.js");
      expect(GEN_AUDIO_ERROR_CODES.API_KEY_MISSING).toBe("GEN_API_KEY_MISSING");
    });

    it("GEN_EMPTY_TEXT 应该存在于错误码枚举中", async () => {
      const { GEN_AUDIO_ERROR_CODES } = await import("../src/cli/gen-audio.js");
      expect(GEN_AUDIO_ERROR_CODES.EMPTY_TEXT).toBe("GEN_EMPTY_TEXT");
    });

    it("GEN_TTS_FAILED 应该存在于错误码枚举中", async () => {
      const { GEN_AUDIO_ERROR_CODES } = await import("../src/cli/gen-audio.js");
      expect(GEN_AUDIO_ERROR_CODES.TTS_FAILED).toBe("GEN_TTS_FAILED");
    });

    it("GEN_MUSIC_FAILED 应该存在于错误码枚举中", async () => {
      const { GEN_AUDIO_ERROR_CODES } = await import("../src/cli/gen-audio.js");
      expect(GEN_AUDIO_ERROR_CODES.MUSIC_FAILED).toBe("GEN_MUSIC_FAILED");
    });

    it("所有 GEN_AUDIO 错误码应该有 GEN_ 前缀", async () => {
      const { GEN_AUDIO_ERROR_CODES } = await import("../src/cli/gen-audio.js");
      const codes = Object.values(GEN_AUDIO_ERROR_CODES);

      for (const code of codes) {
        expect(code).toMatch(/^GEN_/);
      }
    });
  });

  describe("合同导出验证", () => {
    it("getGenTtsContract 应该返回正确的合同结构", async () => {
      const { getGenTtsContract } = await import("../src/cli/gen-audio.js");
      const contract = getGenTtsContract();

      expect(contract.name).toBe("msgcode gen tts");
      expect(contract.description).toContain("语音合成");
      expect(contract.options?.required).toHaveProperty("--text");
      expect(contract.options?.optional).toHaveProperty("--voice");
      expect(contract.options?.optional).toHaveProperty("--output");
      expect(contract.errorCodes).toContain("GEN_API_KEY_MISSING");
      expect(contract.errorCodes).toContain("GEN_EMPTY_TEXT");
      expect(contract.errorCodes).toContain("GEN_TTS_FAILED");
    });

    it("getGenMusicContract 应该返回正确的合同结构", async () => {
      const { getGenMusicContract } = await import("../src/cli/gen-audio.js");
      const contract = getGenMusicContract();

      expect(contract.name).toBe("msgcode gen music");
      expect(contract.description).toContain("音乐生成");
      expect(contract.options?.required).toHaveProperty("--prompt");
      expect(contract.options?.optional).toHaveProperty("--format");
      expect(contract.options?.optional).toHaveProperty("--output");
      expect(contract.errorCodes).toContain("GEN_API_KEY_MISSING");
      expect(contract.errorCodes).toContain("GEN_EMPTY_TEXT");
      expect(contract.errorCodes).toContain("GEN_MUSIC_FAILED");
    });
  });

  describe("命令创建验证", () => {
    it("createGenTtsCommand 应该创建有效的 Command", async () => {
      const { createGenTtsCommand } = await import("../src/cli/gen-audio.js");
      const cmd = createGenTtsCommand();

      expect(cmd.name()).toBe("tts");
      expect(cmd.description()).toContain("语音合成");
    });

    it("createGenMusicCommand 应该创建有效的 Command", async () => {
      const { createGenMusicCommand } = await import("../src/cli/gen-audio.js");
      const cmd = createGenMusicCommand();

      expect(cmd.name()).toBe("music");
      expect(cmd.description()).toContain("音乐生成");
    });

  });

  describe("help-docs 集成验证", () => {
    it("help-docs --json 必须包含 msgcode gen tts 合同", () => {
      const output = execCliStdoutIsolated(["help-docs", "--json"]);

      const envelope = JSON.parse(output);
      expect(envelope.status).toBe("pass");

      const commands = envelope.data.commands;
      const genTts = commands.find(
        (cmd: { name: string }) => cmd.name === "msgcode gen tts"
      );

      expect(genTts).toBeDefined();
      expect(genTts.description).toContain("语音合成");
      expect(genTts.errorCodes).toContain("GEN_API_KEY_MISSING");
    });

    it("help-docs --json 必须包含 msgcode gen music 合同", () => {
      const output = execCliStdoutIsolated(["help-docs", "--json"]);

      const envelope = JSON.parse(output);
      expect(envelope.status).toBe("pass");

      const commands = envelope.data.commands;
      const genMusic = commands.find(
        (cmd: { name: string }) => cmd.name === "msgcode gen music"
      );

      expect(genMusic).toBeDefined();
      expect(genMusic.description).toContain("音乐生成");
      expect(genMusic.errorCodes).toContain("GEN_MUSIC_FAILED");
    });
  });

  describe("输出结构验证", () => {
    it("gen tts 输出结构必须定义", async () => {
      const { getGenTtsContract } = await import("../src/cli/gen-audio.js");
      const contract = getGenTtsContract();

      expect(contract.output).toBeDefined();
      expect(contract.output).toHaveProperty("text");
      expect(contract.output).toHaveProperty("voice");
      expect(contract.output).toHaveProperty("outputPath");
      expect(contract.output).toHaveProperty("generatedAt");
    });

    it("gen music 输出结构必须定义", async () => {
      const { getGenMusicContract } = await import("../src/cli/gen-audio.js");
      const contract = getGenMusicContract();

      expect(contract.output).toBeDefined();
      expect(contract.output).toHaveProperty("prompt");
      expect(contract.output).toHaveProperty("format");
      expect(contract.output).toHaveProperty("outputPath");
      expect(contract.output).toHaveProperty("generatedAt");
    });
  });

  describe("命令行帮助验证", () => {
    it("gen-audio --help 应回落到根帮助且不公开 gen-audio", () => {
      const output = execCliStdoutIsolated(["gen-audio", "--help"]);

      expect(output).not.toContain("\n  gen-audio");
    });

    it("gen-audio tts --json 应返回 unknown command", () => {
      const result = runCliIsolated(["gen-audio", "tts", "--json"]);
      expect(result.status).toBe(1);
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(output).toContain("unknown command");
      expect(output).toContain("gen-audio");
    });
  });
});

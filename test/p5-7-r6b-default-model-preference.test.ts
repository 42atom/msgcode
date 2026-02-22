/**
 * P5.7-R6b 回归锁：LM Studio 默认模型优先级
 *
 * 目标：
 * 1. 文本模型缺省时优先尝试 huihui-glm-4.7-flash-abliterated-mlx
 * 2. 视觉模型默认保持 huihui-glm-4.6v-flash-abliterated-mlx
 * 3. .env.example 暴露一致的默认建议
 */

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.7-R6b: LM Studio 默认模型优先级", () => {
  it("文本链路应声明并优先尝试默认模型", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src", "lmstudio.ts"), "utf-8");

    expect(code).toContain('const LMSTUDIO_DEFAULT_CHAT_MODEL = "huihui-glm-4.7-flash-abliterated-mlx"');
    expect(code).toMatch(
      /(isModelPresentInNativeCatalog|fetchLoadedModelByKey)\(\{\s*baseUrl:\s*params\.baseUrl,\s*key:\s*LMSTUDIO_DEFAULT_CHAT_MODEL,[\s\S]*?\}\)/s
    );
    expect(code).toContain("const models = extractNativeModels(json);");
    expect(code).toContain("function extractNativeModels");
  });

  it("视觉链路默认模型应固定为 4.6V abliterated mlx", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src", "runners", "vision_ocr.ts"), "utf-8");

    expect(code).toContain(
      'const modelId = process.env.LMSTUDIO_VISION_MODEL || "huihui-glm-4.6v-flash-abliterated-mlx"'
    );
  });

  it(".env.example 应暴露文本/视觉默认模型建议", () => {
    const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf-8");

    expect(envExample).toContain("LMSTUDIO_MODEL=huihui-glm-4.7-flash-abliterated-mlx");
    expect(envExample).toContain("LMSTUDIO_VISION_MODEL=huihui-glm-4.6v-flash-abliterated-mlx");
  });
});

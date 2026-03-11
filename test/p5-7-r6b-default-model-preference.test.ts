/**
 * P5.7-R6b 回归锁：LM Studio 默认模型优先级
 *
 * 目标：
 * 1. 文本模型缺省时优先尝试 huihui-glm-4.7-flash-abliterated-mlx
 * 2. 视觉模型默认保持 huihui-glm-4.6v-flash-abliterated-mlx
 * 3. .env.example 暴露一致的默认建议
 *
 * P5.7-R9-T7: 更新测试以读取 agent-backend/chat.ts
 */

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.7-R6b: LM Studio 默认模型优先级", () => {
  it("文本链路应声明并优先尝试默认模型", () => {
    const chatCode = fs.readFileSync(path.join(process.cwd(), "src", "agent-backend", "chat.ts"), "utf-8");
    const promptCode = fs.readFileSync(path.join(process.cwd(), "src", "agent-backend", "prompt.ts"), "utf-8");

    expect(promptCode).toContain('export const AGENT_BACKEND_DEFAULT_CHAT_MODEL = "huihui-glm-4.7-flash-abliterated-mlx"');
    expect(promptCode).toContain("export const LMSTUDIO_DEFAULT_CHAT_MODEL = AGENT_BACKEND_DEFAULT_CHAT_MODEL");
    expect(chatCode).toMatch(
      /(isModelPresentInNativeCatalog|fetchLoadedModelByKey)\(\{\s*baseUrl:\s*params\.baseUrl,\s*key:\s*LMSTUDIO_DEFAULT_CHAT_MODEL,[\s\S]*?\}\)/s
    );
    expect(chatCode).toContain("const models = extractNativeModels(json);");
    expect(chatCode).toContain("function extractNativeModels");
  });

  it("视觉链路默认模型应固定为 4.6V abliterated mlx", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src", "runners", "vision.ts"), "utf-8");

    expect(code).toContain('const configuredVisionModel = await getBranchModel(workspacePath, "local", "vision");');
    expect(code).toContain('resolveLocalVisionModel(localRuntime, "huihui-glm-4.6v-flash-abliterated-mlx")');
  });

  it(".env.example 应暴露文本/视觉默认模型建议", () => {
    const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf-8");

    expect(envExample).toContain("LMSTUDIO_MODEL=huihui-glm-4.7-flash-abliterated-mlx");
    expect(envExample).toContain("LMSTUDIO_VISION_MODEL=huihui-glm-4.6v-flash-abliterated-mlx");
  });
});

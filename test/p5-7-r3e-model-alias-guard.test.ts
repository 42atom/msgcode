/**
 * P5.7-R3e HOTFIX: 模型别名护栏回归锁
 *
 * 目标：
 * - model.executor/model.responder 未配置时不应回退为 provider 别名（如 lmstudio）
 * - lmstudio 调用链应对别名做归一化，避免发送 invalid model identifier
 */

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getExecutorModel, getResponderModel } from "../src/config/workspace.js";

describe("P5.7-R3e HOTFIX: model alias guard", () => {
  it("未配置 model.executor/model.responder 时应返回 undefined", async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-model-alias-"));
    fs.mkdirSync(path.join(workspacePath, ".msgcode"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({ "agent.provider": "lmstudio" }, null, 2),
      "utf-8",
    );

    try {
      const executor = await getExecutorModel(workspacePath);
      const responder = await getResponderModel(workspacePath);

      expect(executor).toBeUndefined();
      expect(responder).toBeUndefined();
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("显式配置 model.executor/model.responder 时应返回真实模型 ID", async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-model-explicit-"));
    fs.mkdirSync(path.join(workspacePath, ".msgcode"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "model.executor": "huihui-glm-4.7-flash-abliterated-mlx",
        "model.responder": "huihui-glm-4.7-flash-abliterated-mlx",
      }, null, 2),
      "utf-8",
    );

    try {
      const executor = await getExecutorModel(workspacePath);
      const responder = await getResponderModel(workspacePath);

      expect(executor).toBe("huihui-glm-4.7-flash-abliterated-mlx");
      expect(responder).toBe("huihui-glm-4.7-flash-abliterated-mlx");
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("lmstudio 调用链必须包含模型别名归一化逻辑", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src", "lmstudio.ts"), "utf-8");

    expect(code).toContain("const MODEL_ALIAS_SET = new Set");
    expect(code).toContain("function normalizeModelOverride");
    expect(code).toContain("normalizeModelOverride(options.model)");
    expect(code).toContain("normalizeModelOverride(await getExecutorModel(workspacePath))");
    expect(code).toContain("normalizeModelOverride(await getResponderModel(workspacePath))");
  });
});


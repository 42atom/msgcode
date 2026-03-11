/**
 * P5.7-R3e HOTFIX: 模型别名护栏回归锁
 *
 * 目标：
 * - model.executor/model.responder 未配置时不应回退为 provider 别名
 * - routed-chat 不应把 provider alias 当作真实模型 ID 发给后端
 */

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeModelOverride } from "../src/agent-backend/config.js";
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

  it("normalizeModelOverride 应把 provider alias 归一化为 undefined", () => {
    expect(normalizeModelOverride("lmstudio")).toBeUndefined();
    expect(normalizeModelOverride("omlx")).toBeUndefined();
    expect(normalizeModelOverride("minimax")).toBeUndefined();
    expect(normalizeModelOverride("real-model-id")).toBe("real-model-id");
  });

  it("workspace 文本模型若误写 provider alias，归一化后应回到自动解析", async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-model-alias-runtime-"));
    fs.mkdirSync(path.join(workspacePath, ".msgcode"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "model.executor": "lmstudio",
        "model.responder": "lmstudio",
      }, null, 2),
      "utf-8",
    );

    try {
      const executor = await getExecutorModel(workspacePath);
      const responder = await getResponderModel(workspacePath);

      expect(executor).toBe("lmstudio");
      expect(responder).toBe("lmstudio");
      expect(normalizeModelOverride(executor)).toBeUndefined();
      expect(normalizeModelOverride(responder)).toBeUndefined();
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});

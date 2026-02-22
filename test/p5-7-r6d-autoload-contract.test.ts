/**
 * P5.7-R6d: 自动加载合同回归锁
 *
 * 目标：
 * 1) CLI 入口应自动加载 ~/.config/msgcode/.env（无需手工 source）
 * 2) LM Studio 缺省模型应优先返回稳定默认模型（目录存在即可）
 */

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.7-R6d: autoload contract", () => {
  it("CLI 入口应包含 bootstrapEnvForCli 且加载用户配置 .env", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src", "cli.ts"), "utf-8");

    expect(code).toContain("function bootstrapEnvForCli()");
    expect(code).toContain('const userConfig = path.join(os.homedir(), ".config/msgcode/.env")');
    expect(code).toContain("dotenv.config({ path: userConfig, override: false });");
    expect(code).toContain("bootstrapEnvForCli();");
  });

  it("LM Studio 模型解析应包含目录存在检查并优先默认模型", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src", "lmstudio.ts"), "utf-8");

    expect(code).toContain("async function isModelPresentInNativeCatalog");
    expect(code).toContain("const preferredAvailable = await isModelPresentInNativeCatalog");
    expect(code).toContain("return LMSTUDIO_DEFAULT_CHAT_MODEL;");
  });
});


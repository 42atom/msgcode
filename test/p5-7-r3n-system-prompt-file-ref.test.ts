import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function readText(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

describe("P5.7-R3n: system prompt file reference", () => {
  let tmpDir = "";
  let originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-prompt-ref-"));
    originalEnv = {
      NODE_ENV: process.env.NODE_ENV,
      FEISHU_APP_ID: process.env.FEISHU_APP_ID,
      FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
      AGENT_SYSTEM_PROMPT_FILE: process.env.AGENT_SYSTEM_PROMPT_FILE,
      AGENT_SYSTEM_PROMPT: process.env.AGENT_SYSTEM_PROMPT,
      MSGCODE_CONFIG_DIR: process.env.MSGCODE_CONFIG_DIR,
      HOME: process.env.HOME,
    };

    process.env.NODE_ENV = "test";
    process.env.FEISHU_APP_ID = "cli-test-app";
    process.env.FEISHU_APP_SECRET = "cli-test-secret";
    process.env.MSGCODE_CONFIG_DIR = path.join(tmpDir, ".config", "msgcode");
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("应存在默认系统提示词文件", () => {
    const promptPath = path.join(process.cwd(), "prompts", "agents-prompt.md");
    expect(fs.existsSync(promptPath)).toBe(true);
  });

  it("默认提示词文件应包含 SOUL 固定路径口径", () => {
    const content = readText("prompts/agents-prompt.md");
    expect(content).toContain("<workspace>/.msgcode/SOUL.md");
    expect(content).toContain("不要猜测 soul 或 soul.md");
    expect(content).toContain("feishu_list_members");
    expect(content).toContain("feishu_list_recent_messages");
    expect(content).toContain("feishu_reply_message");
    expect(content).toContain("feishu_react_message");
    expect(content).toContain('<at user_id="对方ID">称呼</at>');
    expect(content).toContain("entry 指向 optional/ 目录");
    expect(content).toContain("twitter-media");
    expect(content).toContain("主索引已经汇总了基础 skill 和可选 skill 的摘要");
    expect(content).toContain("`memory` 不是工具名");
    expect(content).toContain("判断某个 skill 能做什么、不能做什么之前，必须仔细阅读对应的 SKILL.md");
    expect(content).toContain("如果看完仍然不确定能力边界或调用方式，先向用户说明不确定点并沟通");
    expect(content).toContain("优先使用已注册原生工具");
    expect(content).toContain("探索 CLI 合同时优先使用 help_docs");
    expect(content).toContain("CLI 是正式能力边界之一，但不是所有任务都先绕 bash");
    expect(content).toContain("skill 是说明书，不是默认执行入口");
    expect(content).toContain("凡是 AI 生成的图片、音频、视频以及其他生成产物，优先在当前 workspace 的 `AIDOCS/` 目录下查找");
  });

  it("配置层应通过 loadConfig 暴露 AGENT_SYSTEM_PROMPT_FILE", async () => {
    process.env.AGENT_SYSTEM_PROMPT_FILE = "prompts/custom-agent.md";
    delete process.env.AGENT_SYSTEM_PROMPT;

    const { loadConfig } = await import("../src/config.js");
    const loaded = loadConfig();

    expect(loaded.agentSystemPromptFile).toBe("prompts/custom-agent.md");
    expect(loaded.agentSystemPrompt).toBeUndefined();
  });

  it("prompt 模块应解析文件路径并注入运行时目录占位符", async () => {
    const promptFile = path.join(tmpDir, "custom-agent.md");
    fs.writeFileSync(
      promptFile,
      [
        "# test prompt",
        "config={{MSGCODE_CONFIG_DIR}}",
        "skills={{MSGCODE_SKILLS_DIR}}",
      ].join("\n"),
      "utf-8"
    );

    const {
      resolvePromptFilePath,
      loadSystemPromptFromFile,
      resolveBaseSystemPrompt,
    } = await import("../src/agent-backend/prompt.js");

    expect(resolvePromptFilePath(promptFile)).toBe(promptFile);
    expect(resolvePromptFilePath("prompts/agents-prompt.md")).toBe(
      path.join(process.cwd(), "prompts", "agents-prompt.md")
    );

    const loaded = await loadSystemPromptFromFile(promptFile);
    expect(loaded).toContain(`config=${path.join(tmpDir, ".config", "msgcode")}`);
    expect(loaded).toContain(`skills=${path.join(tmpDir, ".config", "msgcode", "skills")}`);

    expect(await resolveBaseSystemPrompt("直接覆盖提示词")).toBe("直接覆盖提示词");
  });

  it(".env 示例应包含 AGENT 提示词文件配置项", () => {
    const envExample = readText(".env.example");
    expect(envExample).toContain("AGENT_SYSTEM_PROMPT_FILE=");
    expect(envExample).not.toContain("LMSTUDIO_SYSTEM_PROMPT_FILE=");
  });
});

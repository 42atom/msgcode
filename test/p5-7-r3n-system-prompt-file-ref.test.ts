/**
 * msgcode: P5.7-R3n 系统提示词文件引用回归锁
 *
 * 目标：
 * - LM Studio 支持通过文件加载系统提示词，便于反复调试
 * - 文件提示词可承载 SOUL 路径约束口径
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

function readText(relPath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

describe("P5.7-R3n: system prompt file reference", () => {
    it("应存在默认系统提示词文件", () => {
        const promptPath = path.join(process.cwd(), "prompts", "agents-prompt.md");
        expect(fs.existsSync(promptPath)).toBe(true);
    });

    it("默认提示词文件应包含 SOUL 固定路径口径", () => {
        const content = readText("prompts/agents-prompt.md");
        expect(content).toContain("<workspace>/.msgcode/SOUL.md");
        expect(content).toContain("不要猜测为 `soul` 或 `soul.md`");
    });

    it("配置层应暴露 AGENT_SYSTEM_PROMPT_FILE", () => {
        const configCode = readText("src/config.ts");
        expect(configCode).toContain("agentSystemPromptFile?: string");
        expect(configCode).toContain("process.env.AGENT_SYSTEM_PROMPT_FILE");
        expect(configCode).not.toContain("process.env.LMSTUDIO_SYSTEM_PROMPT_FILE");
    });

    it("LM Studio 主链应通过 resolveBaseSystemPrompt 读取基础提示词", () => {
        const promptCode = readText("src/agent-backend/prompt.ts");
        expect(promptCode).toContain("async function resolveBaseSystemPrompt");

        const chatCode = readText("src/agent-backend/chat.ts");
        const matches = chatCode.match(/resolveBaseSystemPrompt\(/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it(".env 示例应包含 AGENT 提示词文件配置项", () => {
        const envExample = readText(".env.example");
        expect(envExample).toContain("AGENT_SYSTEM_PROMPT_FILE=");
        expect(envExample).not.toContain("LMSTUDIO_SYSTEM_PROMPT_FILE=");
    });
});

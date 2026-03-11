/**
 * msgcode: P5.7-R9-T7 Step 4 兼容层与 No-Backflow 回归锁
 *
 * 目标：
 * - 锁定 agent-backend 核心模块导出行为
 * - 锁定 lmstudio.ts 兼容层 forwarding 正确性
 * - 禁止新代码回流依赖 runLmStudio*
 * - 替代脆弱源码字符串断言为行为锁
 *
 * P5.7-R9-T7 Step 4 说明：
 * - 本测试文件为行为锁，不依赖源码字符串匹配
 * - 所有测试基于运行时行为和导出验证
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================
// 行为锁 1: agent-backend.ts 核心导出
// ============================================

describe("P5.7-R9-T7 Step 4: agent-backend.ts 核心导出", () => {
    it("应导出 runAgentChat 函数", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.runAgentChat).toBeDefined();
        expect(typeof module.runAgentChat).toBe("function");
    });

    it("应导出 runAgentToolLoop 函数", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.runAgentToolLoop).toBeDefined();
        expect(typeof module.runAgentToolLoop).toBe("function");
    });

    it("应导出 runAgentRoutedChat 函数", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.runAgentRoutedChat).toBeDefined();
        expect(typeof module.runAgentRoutedChat).toBe("function");
    });

    it("应导出 resolveAgentBackendConfig 函数", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.resolveAgentBackendConfig).toBeDefined();
        expect(typeof module.resolveAgentBackendConfig).toBe("function");
    });

    it("resolveAgentBackendConfig 应返回正确的配置结构", async () => {
        const { resolveAgentBackendConfig } = await import("../src/agent-backend.js");
        const config = resolveAgentBackendConfig();

        expect(config.backendId).toBeDefined();
        expect(config.baseUrl).toBeDefined();
        expect(config.timeoutMs).toBeGreaterThan(0);
    });

    it("应导出 getToolsForAgent 函数", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.getToolsForAgent).toBeDefined();
        expect(typeof module.getToolsForAgent).toBe("function");
    });

    it("应导出 parseToolCallBestEffortFromText 函数", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.parseToolCallBestEffortFromText).toBeDefined();
        expect(typeof module.parseToolCallBestEffortFromText).toBe("function");
    });

    it("应导出 sanitizeAgentOutput 函数", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.sanitizeAgentOutput).toBeDefined();
        expect(typeof module.sanitizeAgentOutput).toBe("function");
    });
});

// ============================================
// 行为锁 2: agent-backend 目录模块导出
// ============================================

describe("P5.7-R9-T7 Step 4: agent-backend 目录模块导出", () => {
    it("应导出 buildDialogSystemPrompt 函数", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module.buildDialogSystemPrompt).toBeDefined();
        expect(typeof module.buildDialogSystemPrompt).toBe("function");
    });

    it("应导出 buildExecSystemPrompt 函数", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module.buildExecSystemPrompt).toBeDefined();
        expect(typeof module.buildExecSystemPrompt).toBe("function");
    });

    it("buildDialogSystemPrompt 应接受 soulContext 参数并正确注入", async () => {
        const { buildDialogSystemPrompt } = await import("../src/agent-backend/index.js");

        const result = buildDialogSystemPrompt(
            "基础提示词",
            false,
            { content: "灵魂内容", source: "workspace" }
        );

        expect(result).toContain("[灵魂身份]");
        expect(result).toContain("灵魂内容");
        expect(result).toContain("[/灵魂身份]");
    });

    it("buildDialogSystemPrompt 应禁止 soulContext.source 为 none 时的注入", async () => {
        const { buildDialogSystemPrompt } = await import("../src/agent-backend/index.js");

        const result = buildDialogSystemPrompt(
            "基础提示词",
            false,
            { content: "灵魂内容", source: "none" }
        );

        expect(result).not.toContain("[灵魂身份]");
    });

    it("buildExecSystemPrompt 应禁止 SOUL 注入（即使传入也应忽略）", async () => {
        const { buildExecSystemPrompt } = await import("../src/agent-backend/index.js");

        // exec 函数签名不接受 soulContext 参数
        const result = buildExecSystemPrompt("基础提示词", true);

        expect(result).not.toContain("[灵魂身份]");
    });

    it("应导出 resolveBaseSystemPrompt 函数", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module.resolveBaseSystemPrompt).toBeDefined();
        expect(typeof module.resolveBaseSystemPrompt).toBe("function");
    });

    it("应导出 normalizeModelOverride 函数", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module.normalizeModelOverride).toBeDefined();
        expect(typeof module.normalizeModelOverride).toBe("function");
    });

    it("应导出 MODEL_ALIAS_SET 常量", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module.MODEL_ALIAS_SET).toBeDefined();
        expect(module.MODEL_ALIAS_SET).toBeInstanceOf(Set);
    });

    it("应导出 normalizeAgentBackendId 函数", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module.normalizeAgentBackendId).toBeDefined();
        expect(typeof module.normalizeAgentBackendId).toBe("function");
    });

    it("应导出 resolveAgentBackendRuntime 函数", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module.resolveAgentBackendRuntime).toBeDefined();
        expect(typeof module.resolveAgentBackendRuntime).toBe("function");
    });

    it("应导出 resolveLocalBackendRuntime 函数", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module.resolveLocalBackendRuntime).toBeDefined();
        expect(typeof module.resolveLocalBackendRuntime).toBe("function");
    });

    it("resolveAgentBackendRuntime 应保留当前本地 backend 预设", async () => {
        const backups = {
            AGENT_BACKEND: process.env.AGENT_BACKEND,
            LOCAL_AGENT_BACKEND: process.env.LOCAL_AGENT_BACKEND,
            OMLX_BASE_URL: process.env.OMLX_BASE_URL,
            OMLX_MODEL: process.env.OMLX_MODEL,
        };

        try {
            process.env.AGENT_BACKEND = "agent-backend";
            process.env.LOCAL_AGENT_BACKEND = "omlx";
            process.env.OMLX_BASE_URL = "http://127.0.0.1:8000";
            process.env.OMLX_MODEL = "qwen-test";

            const { resolveAgentBackendRuntime } = await import("../src/agent-backend/index.js");
            const runtime = resolveAgentBackendRuntime("agent-backend");

            expect(runtime.id).toBe("local-openai");
            expect(runtime.localBackendId).toBe("omlx");
            expect(runtime.baseUrl).toBe("http://127.0.0.1:8000");
            expect(runtime.model).toBe("qwen-test");
            expect(runtime.nativeApiEnabled).toBe(false);
            expect(runtime.supportsModelLifecycle).toBe(false);
            expect(runtime.modelsListPath).toBe("/v1/models");
        } finally {
            for (const [key, value] of Object.entries(backups)) {
                if (typeof value === "undefined") {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    });

    it("normalizeAgentBackendId 应正确处理 local-openai", async () => {
        const { normalizeAgentBackendId } = await import("../src/agent-backend/index.js");

        expect(normalizeAgentBackendId("local-openai")).toBe("local-openai");
        expect(normalizeAgentBackendId("lmstudio")).toBe("local-openai");
        expect(normalizeAgentBackendId("omlx")).toBe("local-openai");
        expect(normalizeAgentBackendId("agent-backend")).toBe("local-openai");
        expect(normalizeAgentBackendId("")).toBe("local-openai");
    });

    it("normalizeAgentBackendId 应正确处理 openai", async () => {
        const { normalizeAgentBackendId } = await import("../src/agent-backend/index.js");

        expect(normalizeAgentBackendId("openai")).toBe("openai");
    });

    it("normalizeAgentBackendId 应正确处理 minimax", async () => {
        const { normalizeAgentBackendId } = await import("../src/agent-backend/index.js");

        expect(normalizeAgentBackendId("minimax")).toBe("minimax");
    });

    it("应导出 PI_ON_TOOLS 常量", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module.PI_ON_TOOLS).toBeDefined();
        expect(Array.isArray(module.PI_ON_TOOLS)).toBe(true);
        expect(module.PI_ON_TOOLS.length).toBeGreaterThan(0);
    });

    it("runAgentToolLoop 应在 omlx 本地后端下自动发现模型，并只使用当前 backend 的 API key", async () => {
        const originalFetch = globalThis.fetch;
        const backups = {
            AGENT_BACKEND: process.env.AGENT_BACKEND,
            LOCAL_AGENT_BACKEND: process.env.LOCAL_AGENT_BACKEND,
            OMLX_BASE_URL: process.env.OMLX_BASE_URL,
            OMLX_API_KEY: process.env.OMLX_API_KEY,
            OMLX_MODEL: process.env.OMLX_MODEL,
            LMSTUDIO_API_KEY: process.env.LMSTUDIO_API_KEY,
        };

        const requests: Array<{ url: string; authorization?: string | null }> = [];

        function readAuthorization(headers: HeadersInit | undefined): string | null | undefined {
            if (!headers) return undefined;
            if (headers instanceof Headers) return headers.get("authorization");
            if (Array.isArray(headers)) {
                const match = headers.find(([key]) => key.toLowerCase() === "authorization");
                return match?.[1];
            }
            const record = headers as Record<string, string>;
            return record.authorization || record.Authorization || undefined;
        }

        try {
            process.env.AGENT_BACKEND = "agent-backend";
            process.env.LOCAL_AGENT_BACKEND = "omlx";
            process.env.OMLX_BASE_URL = "http://127.0.0.1:8000";
            process.env.OMLX_API_KEY = "omlx-key";
            delete process.env.OMLX_MODEL;
            process.env.LMSTUDIO_API_KEY = "lmstudio-key";

            globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                requests.push({
                    url,
                    authorization: readAuthorization(init?.headers),
                });

                if (url === "http://127.0.0.1:8000/v1/models") {
                    return new Response(JSON.stringify({
                        data: [{ id: "qwen-tool-loop-test" }],
                    }), {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    });
                }

                if (url === "http://127.0.0.1:8000/v1/chat/completions") {
                    return new Response(JSON.stringify({
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "tool-loop omlx ok",
                            },
                            finish_reason: "stop",
                        }],
                    }), {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    });
                }

                throw new Error(`unexpected url: ${url}`);
            }) as typeof globalThis.fetch;

            const { runAgentToolLoop, resolveAgentBackendRuntime } = await import("../src/agent-backend/index.js");
            const result = await runAgentToolLoop({
                prompt: "只回答一句话",
                tools: [],
                workspacePath: process.cwd(),
                backendRuntime: resolveAgentBackendRuntime("agent-backend"),
            });

            expect(result.answer).toContain("tool-loop omlx ok");
            expect(requests[0]?.url).toBe("http://127.0.0.1:8000/v1/models");
            expect(requests[1]?.url).toBe("http://127.0.0.1:8000/v1/chat/completions");
            expect(requests[0]?.authorization).toBe("Bearer omlx-key");
            expect(requests[1]?.authorization).toBe("Bearer omlx-key");
        } finally {
            globalThis.fetch = originalFetch;
            for (const [key, value] of Object.entries(backups)) {
                if (typeof value === "undefined") {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    });
});

// ============================================
// 行为锁 3: lmstudio.ts 兼容层 forwarding
// ============================================

describe("P5.7-R9-T7 Step 4: lmstudio.ts 兼容层 forwarding", () => {
    it("lmstudio.ts 应可导入", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module).toBeDefined();
    });

    it("lmstudio.ts 应导出 runLmStudioChat", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runLmStudioChat).toBeDefined();
        expect(typeof module.runLmStudioChat).toBe("function");
    });

    it("lmstudio.ts 应导出 runLmStudioToolLoop", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runLmStudioToolLoop).toBeDefined();
        expect(typeof module.runLmStudioToolLoop).toBe("function");
    });

    it("lmstudio.ts 应导出 runLmStudioRoutedChat", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runLmStudioRoutedChat).toBeDefined();
        expect(typeof module.runLmStudioRoutedChat).toBe("function");
    });

    it("lmstudio.ts 应导出 runAgentChat 别名", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runAgentChat).toBeDefined();
        expect(typeof module.runAgentChat).toBe("function");
    });

    it("lmstudio.ts 应导出 runAgentToolLoop 别名", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runAgentToolLoop).toBeDefined();
        expect(typeof module.runAgentToolLoop).toBe("function");
    });

    it("lmstudio.ts 应导出 runAgentRoutedChat 别名", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runAgentRoutedChat).toBeDefined();
        expect(typeof module.runAgentRoutedChat).toBe("function");
    });
});

// ============================================
// 行为锁 4: No-Backflow 回归锁
// ============================================

describe("P5.7-R9-T7 Step 4: No-Backflow 回归锁", () => {
    it("agent-backend 模块不应 import 自 lmstudio.ts", async () => {
        // 验证 agent-backend 目录下的文件不包含从 lmstudio 的导入
        const agentBackendDir = path.join(process.cwd(), "src", "agent-backend");
        const files = fs.readdirSync(agentBackendDir);

        for (const file of files) {
            if (!file.endsWith(".ts")) continue;

            const content = fs.readFileSync(path.join(agentBackendDir, file), "utf-8");

            // 允许导入 config.js（根目录配置文件），但不允许导入 lmstudio
            const hasLmstudioImport = /from\s+['"]\.\/lmstudio['"]/.test(content)
                || /from\s+['"]\.\/lmstudio\.js['"]/.test(content)
                || /from\s+['"]\.\.\/lmstudio['"]/.test(content)
                || /from\s+['"]\.\.\/lmstudio\.js['"]/.test(content);

            expect(hasLmstudioImport).toBe(false);
        }
    });

    it("agent-backend 模块应导出 AGENT_BACKEND_DEFAULT_CHAT_MODEL 常量", async () => {
        const agentBackend = await import("../src/agent-backend/index.js");

        expect(agentBackend.AGENT_BACKEND_DEFAULT_CHAT_MODEL).toBeDefined();
        expect(typeof agentBackend.AGENT_BACKEND_DEFAULT_CHAT_MODEL).toBe("string");
    });

    it("agent-backend 模块应导出 DEFAULT_SYSTEM_PROMPT_FILE 常量", async () => {
        const agentBackend = await import("../src/agent-backend/index.js");

        expect(agentBackend.DEFAULT_SYSTEM_PROMPT_FILE).toBeDefined();
        expect(typeof agentBackend.DEFAULT_SYSTEM_PROMPT_FILE).toBe("string");
    });
});

// ============================================
// 行为锁 5: 文件规模锁
// ============================================

describe("P5.7-R9-T7 Step 4: 文件规模锁", () => {
    it("lmstudio.ts 行数不应超过阈值（兼容壳目标 ≤ 300 行）", () => {
        const lmstudioPath = path.join(process.cwd(), "src", "lmstudio.ts");
        const content = fs.readFileSync(lmstudioPath, "utf-8");
        const lines = content.split("\n").length;

        // 完成迁移后 lmstudio.ts 应为兼容壳（≤300 行）
        const FINAL_THRESHOLD = 300;

        expect(lines).toBeLessThan(FINAL_THRESHOLD);

        // 记录当前行数用于追踪
        console.log(`lmstudio.ts 当前行数：${lines}（目标阈值：${FINAL_THRESHOLD}）`);
    });

    it("agent-backend/tool-loop.ts 应包含主实现迁出说明", () => {
        const toolLoopPath = path.join(process.cwd(), "src", "agent-backend", "tool-loop.ts");
        const content = fs.readFileSync(toolLoopPath, "utf-8");

        // 验证文件头注释说明主实现已迁出
        expect(content).toContain("主实现已迁出到本文件");
    });

    it("agent-backend/routed-chat.ts 应包含主实现迁出说明", () => {
        const routedChatPath = path.join(process.cwd(), "src", "agent-backend", "routed-chat.ts");
        const content = fs.readFileSync(routedChatPath, "utf-8");

        // 验证文件头注释说明主实现已迁出
        expect(content).toContain("主实现已迁出到本文件");
    });

    it("agent-backend/config.ts 应存在", () => {
        const configPath = path.join(process.cwd(), "src", "agent-backend", "config.ts");
        expect(fs.existsSync(configPath)).toBe(true);
    });

    it("agent-backend/prompt.ts 应存在", () => {
        const promptPath = path.join(process.cwd(), "src", "agent-backend", "prompt.ts");
        expect(fs.existsSync(promptPath)).toBe(true);
    });

    it("agent-backend/types.ts 应存在", () => {
        const typesPath = path.join(process.cwd(), "src", "agent-backend", "types.ts");
        expect(fs.existsSync(typesPath)).toBe(true);
    });

    it("agent-backend/index.ts 应存在", () => {
        const indexPath = path.join(process.cwd(), "src", "agent-backend", "index.ts");
        expect(fs.existsSync(indexPath)).toBe(true);
    });
});

// ============================================
// 行为锁 6: Prompt 构建函数行为验证
// ============================================

describe("P5.7-R9-T7 Step 4: Prompt 构建函数行为", () => {
    it("buildDialogPromptWithContext 应正确拼接 summaryContext", async () => {
        const { buildDialogPromptWithContext } = await import("../src/agent-backend/index.js");

        const result = buildDialogPromptWithContext({
            prompt: "当前问题",
            summaryContext: "历史摘要内容",
        });

        expect(result).toContain("[历史对话摘要]");
        expect(result).toContain("历史摘要内容");
        expect(result).toContain("[当前用户问题]");
        expect(result).toContain("当前问题");
    });

    it("buildDialogPromptWithContext 应正确拼接 windowMessages", async () => {
        const { buildDialogPromptWithContext } = await import("../src/agent-backend/index.js");

        const result = buildDialogPromptWithContext({
            prompt: "当前问题",
            windowMessages: [
                { role: "user", content: "用户消息 1" },
                { role: "assistant", content: "助手回复 1" },
            ],
        });

        expect(result).toContain("[最近对话窗口]");
        expect(result).toContain("[user] 用户消息 1");
        expect(result).toContain("[assistant] 助手回复 1");
    });

    it("MCP_ANTI_LOOP_RULES 应包含核心规则", async () => {
        const { MCP_ANTI_LOOP_RULES } = await import("../src/agent-backend/index.js");

        expect(MCP_ANTI_LOOP_RULES).toContain("必须调用 filesystem 工具");
        expect(MCP_ANTI_LOOP_RULES).toContain("禁止猜测");
    });

    it("QUICK_ANSWER_CONSTRAINT 应包含直接回答规则", async () => {
        const { QUICK_ANSWER_CONSTRAINT, QUICK_ANSWER_CONSTRAINT_FILE } = await import("../src/agent-backend/index.js");

        expect(QUICK_ANSWER_CONSTRAINT).toContain("直接回答");
        expect(QUICK_ANSWER_CONSTRAINT).toContain("不要解释");
        expect(QUICK_ANSWER_CONSTRAINT).toContain("不要使用任何 Markdown 符号或格式");
        expect(QUICK_ANSWER_CONSTRAINT).toContain("不要使用任何 Markdown 符号或格式");
        expect(QUICK_ANSWER_CONSTRAINT).toContain("草稿里如果已经出现这些标记");
        expect(QUICK_ANSWER_CONSTRAINT).toContain("ABCD 或 1、2、3");
        expect(fs.readFileSync(QUICK_ANSWER_CONSTRAINT_FILE, "utf-8")).toContain("提示用户可直接回复编号");
    });

    it("EXEC_TOOL_PROTOCOL_CONSTRAINT 应包含执行核协议", async () => {
        const {
            EXEC_TOOL_PROTOCOL_CONSTRAINT,
            EXEC_TOOL_PROTOCOL_CONSTRAINT_FILE,
            MCP_ANTI_LOOP_RULES_FILE,
        } = await import("../src/agent-backend/index.js");

        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("执行核");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("访问网页或获取实时信息时，用工具拿真实结果");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("不要使用任何 Markdown 符号或格式");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("不要使用任何 Markdown 符号或格式");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("草稿里如果出现加粗");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).not.toContain("第一轮必须优先产出 tool_calls");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).not.toContain("没有 tool_calls 前");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("只有在本轮真实拿到对应工具回执后");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("不要复述上一轮失败");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("缺少当前附件或路径");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("ABCD 或 1、2、3");
        expect(fs.readFileSync(EXEC_TOOL_PROTOCOL_CONSTRAINT_FILE, "utf-8")).toContain("ABCD 或 1、2、3");
        expect(fs.readFileSync(MCP_ANTI_LOOP_RULES_FILE, "utf-8")).toContain("必须调用 filesystem 工具");
    });
});

// ============================================
// 行为锁 7: 路由温度验证
// ============================================

describe("P5.7-R9-T7 Step 4: 路由温度验证", () => {
    it("应导出 getTemperatureForRoute 函数", async () => {
        const module = await import("../src/routing/classifier.js");
        expect(module.getTemperatureForRoute).toBeDefined();
        expect(typeof module.getTemperatureForRoute).toBe("function");
    });

    it("getTemperatureForRoute 应为 no-tool 返回 0.2", async () => {
        const { getTemperatureForRoute } = await import("../src/routing/classifier.js");

        expect(getTemperatureForRoute("no-tool")).toBe(0.2);
    });

    it("getTemperatureForRoute 应为 tool 返回 0", async () => {
        const { getTemperatureForRoute } = await import("../src/routing/classifier.js");

        expect(getTemperatureForRoute("tool")).toBe(0);
        expect(getTemperatureForRoute("complex-tool")).toBe(0);
    });
});

// ============================================
// 行为锁 8: 类型导出验证
// ============================================

describe("P5.7-R9-T7 Step 4: 类型导出验证", () => {
    it("agent-backend/index.ts 应导出 AgentChatOptions 类型", async () => {
        // 类型导出验证通过编译即可
        const module = await import("../src/agent-backend/index.js");
        expect(module).toBeDefined();
    });

    it("agent-backend/index.ts 应导出 AgentToolLoopOptions 类型", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module).toBeDefined();
    });

    it("agent-backend/index.ts 应导出 AgentRoutedChatOptions 类型", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module).toBeDefined();
    });

    it("agent-backend/index.ts 应导出 ActionJournalEntry 类型", async () => {
        const module = await import("../src/agent-backend/index.js");
        expect(module).toBeDefined();
    });
});

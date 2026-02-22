/**
 * msgcode: P5.7-R3j 双模型路由稳定化行为回归锁
 *
 * 目标：
 * - no-tool / tool / complex-tool 行为分流
 * - 路由温度硬锁（no-tool=0.2, tool/complex-tool=0）
 * - 分类函数基础语义锁
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { runLmStudioRoutedChat } from "../src/lmstudio.js";
import { classifyRoute, getTemperatureForRoute, routeRequiresTools } from "../src/routing/classifier.js";
import { recoverDegrade } from "../src/slo-degrade.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type ChatCompletionPayload = {
    choices: Array<{
        message: {
            role?: string;
            content?: string;
            tool_calls?: Array<{
                id: string;
                type: "function";
                function: { name: string; arguments: string };
            }>;
        };
        finish_reason?: string;
    }>;
};

function asJsonResponse(payload: ChatCompletionPayload): Response {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

async function createToolEnabledWorkspace(): Promise<string> {
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r3j-routing-"));
    await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
    await writeFile(
        join(workspacePath, ".msgcode", "config.json"),
        JSON.stringify({
            "pi.enabled": true,
            "tooling.mode": "autonomous",
            "tooling.allow": ["bash", "read_file", "write_file", "edit_file"],
            "tooling.require_confirm": [],
        }, null, 2),
        "utf-8"
    );
    await writeFile(join(workspacePath, ".msgcode", "route.txt"), "route-file-content", "utf-8");
    return workspacePath;
}

function withOpenAiBackendEnv(): () => void {
    const prevBase = process.env.OPENAI_BASE_URL;
    const prevModel = process.env.OPENAI_MODEL;
    const prevApiKey = process.env.OPENAI_API_KEY;

    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1234";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_API_KEY = "test-key";

    return () => {
        if (prevBase === undefined) delete process.env.OPENAI_BASE_URL;
        else process.env.OPENAI_BASE_URL = prevBase;
        if (prevModel === undefined) delete process.env.OPENAI_MODEL;
        else process.env.OPENAI_MODEL = prevModel;
        if (prevApiKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prevApiKey;
    };
}

describe("P5.7-R3j: Dual Model Routing Stabilization (Behavior Lock)", () => {
    beforeEach(() => {
        // 确保不受历史降级状态污染
        recoverDegrade("LEVEL_0");
    });

    it("no-tool 路由应返回 responder 温度（0.2）且不触发工具循环", async () => {
        const originalFetch = globalThis.fetch;
        const restoreEnv = withOpenAiBackendEnv();
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;
            if (callCount === 1) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: JSON.stringify({
                                route: "no-tool",
                                confidence: "high",
                                reason: "闲聊",
                            }),
                        },
                        finish_reason: "stop",
                    }],
                });
            }
            return asJsonResponse({
                choices: [{
                    message: { role: "assistant", content: "你好，我在。" },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioRoutedChat({
                prompt: "你好，今天怎么样？",
                workspacePath,
                agentProvider: "openai",
            });

            expect(callCount).toBe(2);
            expect(result.route).toBe("no-tool");
            expect(result.temperature).toBe(0.2);
            expect(result.answer).toContain("你好，我在。");
            expect(result.actionJournal).toEqual([]);
        } finally {
            globalThis.fetch = originalFetch;
            restoreEnv();
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("tool 路由应固定 temperature=0 且返回工具执行结果", async () => {
        const originalFetch = globalThis.fetch;
        const restoreEnv = withOpenAiBackendEnv();
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;

            if (callCount === 1) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: [{
                                id: "call_tool_1",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({ command: "printf 'pwd-ok'" }),
                                },
                            }],
                        },
                        finish_reason: "tool_calls",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: { role: "assistant", content: "工具执行完成" },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioRoutedChat({
                prompt: "请用 bash 执行 pwd",
                workspacePath,
                agentProvider: "openai",
            });

            expect(callCount).toBe(2);
            expect(result.route).toBe("tool");
            expect(result.temperature).toBe(0);
            expect(result.toolCall?.name).toBe("bash");
            expect(result.actionJournal.length).toBe(1);
            expect(result.actionJournal[0].tool).toBe("bash");
            expect(result.actionJournal[0].ok).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
            restoreEnv();
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("complex-tool 路由应走 plan->act->report 并固定 temperature=0", async () => {
        const originalFetch = globalThis.fetch;
        const restoreEnv = withOpenAiBackendEnv();
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;

            if (callCount === 1) {
                // classifier
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: JSON.stringify({
                                route: "complex-tool",
                                confidence: "high",
                                reason: "多步骤任务",
                            }),
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            if (callCount === 2) {
                // plan
                return asJsonResponse({
                    choices: [{
                        message: { role: "assistant", content: "计划：先读取文件，再总结。" },
                        finish_reason: "stop",
                    }],
                });
            }

            if (callCount === 3) {
                // act round-1: tool call
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: [{
                                id: "call_complex_1",
                                type: "function",
                                function: {
                                    name: "read_file",
                                    arguments: JSON.stringify({ path: ".msgcode/route.txt" }),
                                },
                            }],
                        },
                        finish_reason: "tool_calls",
                    }],
                });
            }

            if (callCount === 4) {
                // act round-2: no tool call, finish tool loop
                return asJsonResponse({
                    choices: [{
                        message: { role: "assistant", content: "执行阶段完成" },
                        finish_reason: "stop",
                    }],
                });
            }

            // report
            return asJsonResponse({
                choices: [{
                    message: { role: "assistant", content: "最终总结：已完成读取并整理结果。" },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioRoutedChat({
                prompt: "先读取 .msgcode/route.txt，再总结给我",
                workspacePath,
                agentProvider: "openai",
            });

            expect(callCount).toBe(5);
            expect(result.route).toBe("complex-tool");
            expect(result.temperature).toBe(0);
            expect(result.answer).toContain("最终总结");
            expect(result.actionJournal.length).toBe(1);
            expect(result.actionJournal[0].tool).toBe("read_file");
        } finally {
            globalThis.fetch = originalFetch;
            restoreEnv();
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("routeRequiresTools 与 getTemperatureForRoute 应保持契约", () => {
        expect(routeRequiresTools("no-tool")).toBe(false);
        expect(routeRequiresTools("tool")).toBe(true);
        expect(routeRequiresTools("complex-tool")).toBe(true);

        expect(getTemperatureForRoute("no-tool")).toBe(0.2);
        expect(getTemperatureForRoute("tool")).toBe(0);
        expect(getTemperatureForRoute("complex-tool")).toBe(0);
    });

    it("classifyRoute 应对基础语义保持稳定", () => {
        expect(classifyRoute("你好，今天怎么样").route).toBe("no-tool");
        expect(classifyRoute("请读取 README.md").route).toBe("tool");
        expect(classifyRoute("先读取文件再分析并给出方案").route).toBe("complex-tool");
    });
});


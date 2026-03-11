/**
 * msgcode: P5.7-R3g Tool Loop 多工具闭环行为回归锁
 *
 * 目标：
 * - 单轮多工具 FIFO 执行
 * - 多轮 tool_calls 连续执行
 * - 步数上限保护
 * - 工具失败短路诊断
 */

import { describe, it, expect } from "bun:test";
import { runLmStudioToolLoop } from "../src/lmstudio.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const localOpenAiRuntime = {
    id: "local-openai" as const,
    baseUrl: "http://127.0.0.1:1234",
    model: "test-model",
    timeoutMs: 10_000,
    nativeApiEnabled: false,
};

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
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r3g-tool-loop-"));
    await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
    await writeFile(
        join(workspacePath, ".msgcode", "config.json"),
        JSON.stringify({
            "tooling.mode": "autonomous",
            "tooling.allow": ["bash", "read_file", "write_file", "edit_file"],
            "tooling.require_confirm": [],
        }, null, 2),
        "utf-8"
    );
    return workspacePath;
}

describe("P5.7-R3g: Tool Loop Multi-Tool (Behavior Lock)", () => {
    it("allowNoTool 直答路径应清理 <think> 标签", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;
            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "<think>先想一下内部步骤</think>\n最终答案",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "直接回答，不需要工具",
                workspacePath,
                timeoutMs: 10_000,
                allowNoTool: true,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(1);
            expect(result.decisionSource).toBe("model");
            expect(result.answer).toBe("最终答案");
            expect(result.answer).not.toContain("<think>");
            expect(result.actionJournal).toEqual([]);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("单轮多个工具应按 FIFO 顺序执行", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        await writeFile(join(workspacePath, ".msgcode", "info.txt"), "hello-r3g", "utf-8");
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;

            if (callCount === 1) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: [
                                {
                                    id: "call_fifo_1",
                                    type: "function",
                                    function: {
                                        name: "bash",
                                        arguments: JSON.stringify({ command: "printf 'one'" }),
                                    },
                                },
                                {
                                    id: "call_fifo_2",
                                    type: "function",
                                    function: {
                                        name: "read_file",
                                        arguments: JSON.stringify({ path: ".msgcode/info.txt" }),
                                    },
                                },
                            ],
                        },
                        finish_reason: "tool_calls",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: { role: "assistant", content: "执行完成" },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "先执行命令再读取文件",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toContain("执行完成");
            // P5.7-R12-T3: verify phase 增加了一条 journal entry
            expect(result.actionJournal.length).toBe(3);
            expect(result.actionJournal[0].tool).toBe("bash");
            expect(result.actionJournal[1].tool).toBe("read_file");
            expect(result.actionJournal[0].stepId).toBeLessThan(result.actionJournal[1].stepId);
            expect(result.toolCall?.name).toBe("bash");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("多轮 tool_calls 应持续执行直到模型停止调用工具", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        await writeFile(join(workspacePath, ".msgcode", "info2.txt"), "hello-round2", "utf-8");
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
                                id: "call_round_1",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({ command: "printf 'round1'" }),
                                },
                            }],
                        },
                        finish_reason: "tool_calls",
                    }],
                });
            }

            if (callCount === 2) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: [{
                                id: "call_round_2",
                                type: "function",
                                function: {
                                    name: "read_file",
                                    arguments: JSON.stringify({ path: ".msgcode/info2.txt" }),
                                },
                            }],
                        },
                        finish_reason: "tool_calls",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: { role: "assistant", content: "多轮执行完成" },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "执行两轮工具",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(3);
            expect(result.answer).toContain("多轮执行完成");
            // P5.7-R12-T3: verify phase 增加了一条 journal entry
            expect(result.actionJournal.length).toBe(3);
            expect(result.actionJournal[0].tool).toBe("bash");
            expect(result.actionJournal[1].tool).toBe("read_file");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("单轮工具调用超过上限时应返回 TOOL_LOOP_LIMIT_EXCEEDED", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();

        const tooManyCalls = Array.from({ length: 9 }, (_, idx) => ({
            id: `call_limit_${idx}`,
            type: "function" as const,
            function: {
                name: "bash",
                arguments: JSON.stringify({ command: "true" }),
            },
        }));

        globalThis.fetch = (async () => asJsonResponse({
            choices: [{
                message: {
                    role: "assistant",
                    content: "",
                    tool_calls: tooManyCalls,
                },
                finish_reason: "tool_calls",
            }],
        })) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "执行超多工具",
                workspacePath,
                timeoutMs: 10_000,
                perTurnToolCallLimit: 8,
                backendRuntime: localOpenAiRuntime,
            });

            expect(result.answer).toContain("TOOL_LOOP_LIMIT_EXCEEDED");
            expect(result.actionJournal).toEqual([]);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("工具执行失败时应短路并保留诊断信息", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "",
                        tool_calls: [{
                            id: "call_fail_1",
                            type: "function",
                            function: {
                                name: "bash",
                                arguments: JSON.stringify({ command: "this_command_should_not_exist_12345" }),
                            },
                        }],
                    },
                    finish_reason: "tool_calls",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "执行一个不存在的命令",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(1);
            expect(result.answer).toContain("TOOL_EXEC_FAILED");
            expect(result.actionJournal.length).toBe(1);
            expect(result.actionJournal[0].ok).toBe(false);
            expect(result.actionJournal[0].errorCode).toBe("TOOL_EXEC_FAILED");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

/**
 * msgcode: P5.7-R20 热路径不再额外复核回归锁
 *
 * 验收：
 * 1. 工具链结束后不再额外打一轮 finish supervisor 请求
 * 2. mutating / fail / verify 场景都只保留原生 action + verify 证据
 * 3. 最终答复直接来自模型主链，不再追加 finish-supervisor journal
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logger } from "../src/logger/index.js";
import { runLmStudioToolLoop } from "../src/lmstudio.js";

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
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r20-finish-supervisor-"));
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
    await writeFile(join(workspacePath, ".msgcode", "evidence.txt"), "verified-evidence", "utf-8");
    return workspacePath;
}

describe("P5.7-R20: minimal finish supervisor", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("只读任务应直接结束，不触发 finish supervisor", async () => {
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
                                id: "call_read_1",
                                type: "function",
                                function: {
                                    name: "read_file",
                                    arguments: JSON.stringify({ path: ".msgcode/evidence.txt" }),
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
                            content: "读取完成，证据已拿到：verified-evidence",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "读取完成，证据已拿到：verified-evidence",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "读取证据文件并确认是否可以结束",
                workspacePath,
                backendRuntime: localOpenAiRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toContain("verified-evidence");
            expect(result.actionJournal.map((entry) => entry.tool)).toEqual([
                "read_file",
                "read_file",
            ]);
            expect(result.actionJournal.some((entry) => entry.tool === "finish-supervisor")).toBe(false);
        } finally {
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("首轮无 tool_calls 的普通直答不应触发 supervisor", async () => {
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;
        const originalLoggerInfo = logger.info.bind(logger);
        const metadataRoutes: string[] = [];

        globalThis.fetch = (async () => {
            callCount += 1;

            if (callCount === 1) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "这是一个无需工具的直接回答。",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "PASS",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;
        logger.info = ((message: string, meta?: Record<string, any>, traceId?: string) => {
            if (message === "agent final response metadata" && typeof meta?.route === "string") {
                metadataRoutes.push(meta.route);
            }
            return originalLoggerInfo(message, meta, traceId);
        }) as typeof logger.info;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "直接回答，不需要工具",
                workspacePath,
                backendRuntime: localOpenAiRuntime,
                timeoutMs: 10_000,
                allowNoTool: true,
            });

            expect(callCount).toBe(1);
            expect(result.answer).toBe("这是一个无需工具的直接回答。");
            expect(result.decisionSource).toBe("model");
            expect(result.actionJournal.length).toBe(0);
            expect(metadataRoutes).toEqual(["no-tool"]);
        } finally {
            logger.info = originalLoggerInfo;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("假完成场景不再额外请求 finish supervisor", async () => {
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
                                id: "call_bash_1",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({ command: "touch .msgcode/draft.marker" }),
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
                            content: "已完成。",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            if (callCount === 3) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "CONTINUE: 缺少真实文件证据",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "CONTINUE: 缺少真实文件证据",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "先做事，再确认是否真的完成",
                workspacePath,
                backendRuntime: localOpenAiRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toBe("已完成。");
            expect(result.actionJournal.some((entry) => entry.tool === "finish-supervisor")).toBe(false);
        } finally {
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("已验证成功时只保留 bash + verify 证据，不再额外复核", async () => {
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
                                id: "call_bash_success_empty_supervisor",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({ command: "touch .msgcode/supervisor-empty-ok.marker" }),
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
                            content: "已创建完成。",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "创建一个标记文件然后结束",
                workspacePath,
                backendRuntime: localOpenAiRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toBe("已创建完成。");
            expect(result.actionJournal.map((entry) => `${entry.phase}:${entry.tool}:${entry.ok}`)).toEqual([
                "act:bash:true",
                "verify:bash:true",
            ]);
        } finally {
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("连续 CONTINUE 现在也不会再触发额外复核", async () => {
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
                                id: "call_bash_blocked",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({ command: "touch .msgcode/draft.marker" }),
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
                            content: "仍然认为可以结束",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "CONTINUE: 仍缺证据",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "完成任务并确认结束条件",
                workspacePath,
                backendRuntime: localOpenAiRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toBe("仍然认为可以结束");
            expect(result.actionJournal.some((entry) => entry.tool === "finish-supervisor")).toBe(false);
        } finally {
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("ok -> fail 的工具链只保留真实 verify 结果", async () => {
        const workspacePath = await createToolEnabledWorkspace();
        await writeFile(join(workspacePath, ".msgcode", "evidence.txt"), "verified-evidence", "utf-8");
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
                                id: "call_read_ok",
                                type: "function",
                                function: {
                                    name: "read_file",
                                    arguments: JSON.stringify({ path: ".msgcode/evidence.txt" }),
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
                                id: "call_bash_fail_after_ok",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({ command: "touch .msgcode/mutate-before-fail && sh -c \"echo boom >&2; exit 7\"" }),
                                },
                            }],
                        },
                        finish_reason: "tool_calls",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "PASS",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "先读证据，再执行一个会失败的命令",
                workspacePath,
                backendRuntime: localOpenAiRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(3);
            expect(result.answer).toContain("PASS");
            expect(result.answer).not.toContain("TOOL_EXEC_FAILED");
            expect(result.verifyResult?.ok).toBe(false);
            expect(result.verifyResult?.errorCode).toBe("TOOL_VERIFY_FAILED");
            expect(result.actionJournal.map((entry) => `${entry.phase}:${entry.tool}:${entry.ok}`)).toEqual([
                "act:read_file:true",
                "act:bash:false",
                "verify:bash:false",
            ]);
        } finally {
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("工具失败后也不再追加 finish-supervisor 审计", async () => {
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
                                id: "call_bash_fail_blocked",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({ command: "touch .msgcode/fail-before-block && sh -c \"echo fail >&2; exit 9\"" }),
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
                            content: "已删除，我还是直接结束。",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "CONTINUE: 失败仍未解释清楚",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "执行一个会失败的命令，并正确收尾",
                workspacePath,
                backendRuntime: localOpenAiRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toBe("已删除，我还是直接结束。");
            expect(result.verifyResult?.ok).toBe(false);
            expect(result.verifyResult?.errorCode).toBe("TOOL_VERIFY_FAILED");
            expect(result.actionJournal.some((entry) => entry.tool === "finish-supervisor")).toBe(false);
            expect(result.actionJournal[0]?.tool).toBe("bash");
            expect(result.actionJournal[0]?.ok).toBe(false);
        } finally {
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

/**
 * msgcode: P5.7-R20 结束前最小监督闭环回归锁
 *
 * 验收：
 * 1. 证据足够时 supervisor 放行
 * 2. 假完成会被 supervisor 拦下并推动继续执行
 * 3. 连续 3 次 CONTINUE 后停止并返回阻塞原因
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "../src/config.js";
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
            "pi.enabled": true,
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
    const originalSupervisorConfig = { ...config.supervisor };
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        config.supervisor.enabled = true;
        config.supervisor.temperature = 0;
        config.supervisor.maxTokens = 200;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        config.supervisor.enabled = originalSupervisorConfig.enabled;
        config.supervisor.temperature = originalSupervisorConfig.temperature;
        config.supervisor.maxTokens = originalSupervisorConfig.maxTokens;
    });

    it("证据足够时应返回 PASS 并正常结束", async () => {
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
                        content: "PASS",
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

            expect(callCount).toBe(3);
            expect(result.answer).toContain("verified-evidence");
            expect(result.actionJournal.map((entry) => entry.tool)).toEqual([
                "read_file",
                "read_file",
                "finish-supervisor",
            ]);
            expect(result.actionJournal[2]?.ok).toBe(true);
        } finally {
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("假完成应被拦下并继续执行到有证据再结束", async () => {
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
                                    arguments: JSON.stringify({ command: "printf 'draft'" }),
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

            if (callCount === 4) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: [{
                                id: "call_read_2",
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

            if (callCount === 5) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "已补充验证，证据为 verified-evidence。",
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

        try {
            const result = await runLmStudioToolLoop({
                prompt: "先做事，再确认是否真的完成",
                workspacePath,
                backendRuntime: localOpenAiRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(6);
            expect(result.answer).toContain("verified-evidence");
            expect(result.actionJournal.filter((entry) => entry.tool === "finish-supervisor").length).toBe(2);
            expect(result.actionJournal.some((entry) => entry.tool === "read_file" && entry.phase === "act")).toBe(true);
            expect(result.actionJournal[result.actionJournal.length - 1]?.ok).toBe(true);
        } finally {
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("连续 3 次 CONTINUE 后应停止并返回阻塞原因", async () => {
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
                                    arguments: JSON.stringify({ command: "printf 'draft'" }),
                                },
                            }],
                        },
                        finish_reason: "tool_calls",
                    }],
                });
            }

            if (callCount === 2 || callCount === 4 || callCount === 6) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: `仍然认为可以结束-${callCount}`,
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
                            content: "CONTINUE: 第一次仍缺证据",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            if (callCount === 5) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "CONTINUE: 第二次仍缺证据",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "CONTINUE: 第三次仍缺证据",
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

            expect(callCount).toBe(7);
            expect(result.answer).toContain("FINISH_SUPERVISOR_BLOCKED");
            expect(result.answer).toContain("第三次仍缺证据");
            expect(result.actionJournal.filter((entry) => entry.tool === "finish-supervisor").length).toBe(3);
            expect(result.actionJournal[result.actionJournal.length - 1]?.ok).toBe(false);
        } finally {
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

/**
 * msgcode: P5.7-R3l-4 HOTFIX 回归锁
 *
 * 覆盖：
 * 1) 失败短路前必须写入 actionJournal（末步失败不丢失）
 * 2) actionJournal.durationMs 必须保留 executeTool 实际耗时
 */

import { describe, it, expect } from "bun:test";
import { runLmStudioToolLoop } from "../src/lmstudio.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r3l4-hotfix-"));
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

describe("P5.7-R3l-4 HOTFIX: actionJournal", () => {
    it("工具失败短路时仍应记录失败步骤到 actionJournal", async () => {
        const originalFetch = globalThis.fetch;
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
                                id: "call_fail_1",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({
                                        command: "sleep 0.1; echo fail 1>&2; exit 1",
                                    }),
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
                        content: "命令失败，已记录。",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "执行失败命令",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2); // 失败先回灌模型，再给模型一轮总结机会
            expect(result.actionJournal.length).toBe(1);
            expect(result.actionJournal[0].ok).toBe(false);
            expect(result.actionJournal[0].errorCode).toBeDefined();
            expect(result.actionJournal[0].exitCode).toBe(1);
            expect(result.actionJournal[0].durationMs).toBeGreaterThan(0);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("工具成功路径应保留 executeTool durationMs 到 actionJournal", async () => {
        const originalFetch = globalThis.fetch;
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
                                id: "call_ok_1",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({
                                        command: "sleep 0.1; echo done",
                                    }),
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
                        content: "ok",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "执行成功命令",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2);
            expect(result.actionJournal.length).toBe(1);
            expect(result.actionJournal[0].ok).toBe(true);
            expect(result.actionJournal[0].durationMs).toBeGreaterThan(0);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

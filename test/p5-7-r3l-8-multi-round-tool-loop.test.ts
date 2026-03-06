/**
 * msgcode: P5.7-R3l-8 多轮 Tool Loop 回归锁
 *
 * 目标：
 * - 验证 runLmStudioToolLoop 支持同一请求内多轮 tool_calls
 * - 验证 actionJournal 可记录多轮执行步骤
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
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r3l8-multi-round-"));
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
    await writeFile(join(workspacePath, ".msgcode", "info.txt"), "hello-from-read-file", "utf-8");
    return workspacePath;
}

describe("P5.7-R3l-8: multi-round tool loop", () => {
    it("同一请求应支持两轮 tool_calls 后再收口", async () => {
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
                                    arguments: JSON.stringify({ path: ".msgcode/info.txt" }),
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
                        content: "两轮工具已执行完成",
                    },
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

            expect(callCount).toBe(3);
            expect(result.answer).toContain("两轮工具已执行完成");
            // P5.7-R12-T3: verify phase 增加了一条 journal entry
            expect(result.actionJournal.length).toBe(3);
            expect(result.actionJournal[0].tool).toBe("bash");
            expect(result.actionJournal[1].tool).toBe("read_file");
            expect(result.actionJournal[0].ok).toBe(true);
            expect(result.actionJournal[1].ok).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

/**
 * msgcode: P5.7-R3l-7 Tool 协议重试与 SOUL 路径纠偏回归锁
 *
 * 覆盖：
 * 1) 首轮无 tool_calls 时，二次 required 重试可恢复工具调用
 * 2) read_file 命中 workspace/SOUL.md 时，可自动纠偏到 .msgcode/SOUL.md
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
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r3l7-tool-retry-"));
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
    return workspacePath;
}

describe("P5.7-R3l-7: tool protocol retry + SOUL path normalize", () => {
    it("首轮无 tool_calls 时应执行 required 重试并成功", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;
        let sawRetryChoice = false;

        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
            callCount += 1;

            const body = typeof init?.body === "string"
                ? JSON.parse(init.body) as { tool_choice?: unknown }
                : {};

            if (
                body.tool_choice === "required" ||
                JSON.stringify(body.tool_choice) === JSON.stringify({
                    type: "function",
                    function: { name: "bash" },
                })
            ) {
                sawRetryChoice = true;
            }

            if (callCount === 1) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "我来执行这个命令。",
                        },
                        finish_reason: "stop",
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
                                id: "call_retry_ok_1",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({ command: "pwd" }),
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
                prompt: "执行 bash pwd",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(3);
            expect(sawRetryChoice).toBe(true);
            expect(result.toolCall?.name).toBe("bash");
            // P5.7-R12-T3: verify phase 增加了一条 journal entry
            expect(result.actionJournal.length).toBe(2);
            expect(result.actionJournal[0].ok).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("read_file 的 SOUL 路径应自动纠偏到 .msgcode/SOUL.md", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        await writeFile(join(workspacePath, ".msgcode", "SOUL.md"), "soul-ok", "utf-8");
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
                                id: "call_soul_fix_1",
                                type: "function",
                                function: {
                                    name: "read_file",
                                    arguments: JSON.stringify({ path: `${workspacePath}/SOUL.md` }),
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
                        content: "soul-read-ok",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "读取 SOUL 文件",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toContain("soul-read-ok");
            // P5.7-R12-T3: verify phase 增加了一条 journal entry
            expect(result.actionJournal.length).toBe(2);
            expect(result.actionJournal[0].tool).toBe("read_file");
            expect(result.actionJournal[0].ok).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("总结阶段返回 minimax tool_call 协议片段时，应回退为可展示文本", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        const soulContent = [
            "# Soul",
            "line-1",
            "line-2",
            "line-3",
            "line-4",
        ].join("\n");
        await writeFile(join(workspacePath, ".msgcode", "SOUL.md"), soulContent, "utf-8");
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
                                id: "call_tool_markup_1",
                                type: "function",
                                function: {
                                    name: "read_file",
                                    arguments: JSON.stringify({ path: ".msgcode/SOUL.md" }),
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
                        content: `<minimax:tool_call>
<invoke name="read_file">
<parameter name="path">/home/user/.msgcode/SOUL.md</parameter>
</invoke>
</minimax:tool_call>`,
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "你的soul文件前三行是什么",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toMatch(/前\s*3\s*行如下/);
            expect(result.answer).toContain("# Soul");
            expect(result.answer).toContain("line-1");
            expect(result.answer).toContain("line-2");
            expect(result.answer).not.toContain("<minimax:tool_call>");
            expect(result.answer).not.toContain("line-4");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("用户显式指定 edit_file 工具时，首轮应绑定该工具并完成编辑", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        await writeFile(join(workspacePath, ".msgcode", "toolcheck.txt"), "alpha", "utf-8");
        let callCount = 0;
        let firstTools: unknown[] = [];
        let firstToolChoice: unknown;

        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
            callCount += 1;
            const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
            if (callCount === 1) {
                firstTools = Array.isArray(body.tools) ? body.tools : [];
                firstToolChoice = body.tool_choice;
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: [{
                                id: "call_edit_preferred_1",
                                type: "function",
                                function: {
                                    name: "edit_file",
                                    arguments: JSON.stringify({
                                        path: ".msgcode/toolcheck.txt",
                                        edits: [{ oldText: "alpha", newText: "beta" }],
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
                        content: "edit-ok",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "请使用 edit_file 工具把 .msgcode/toolcheck.txt 里的 alpha 改成 beta",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2);
            const firstToolNames = firstTools
                .map((t) => (t as { function?: { name?: unknown } })?.function?.name)
                .filter((name): name is string => typeof name === "string");
            expect(firstToolNames).toEqual(["edit_file"]);
            expect(firstToolChoice === "required" || (
                typeof firstToolChoice === "object"
                && firstToolChoice !== null
                && (firstToolChoice as { function?: { name?: unknown } }).function?.name === "edit_file"
            )).toBe(true);
            expect(result.toolCall?.name).toBe("edit_file");

            const content = await (await import("node:fs/promises")).readFile(
                join(workspacePath, ".msgcode", "toolcheck.txt"),
                "utf-8"
            );
            expect(content).toBe("beta");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("显式工具名纠偏后仍不匹配时，应拒绝执行错误工具", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;
            // 首轮 + 纠偏轮都返回错误工具 read_file
            if (callCount === 1 || callCount === 2) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: [{
                                id: `call_wrong_${callCount}`,
                                type: "function",
                                function: {
                                    name: "read_file",
                                    arguments: JSON.stringify({ path: ".msgcode/toolcheck.txt" }),
                                },
                            }],
                        },
                        finish_reason: "tool_calls",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: { role: "assistant", content: "unexpected" },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "请使用 edit_file 工具把 .msgcode/toolcheck.txt 里的 alpha 改成 beta",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toContain("工具协议失败");
            expect(result.answer).toContain("edit_file");
            expect(result.actionJournal).toEqual([]);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

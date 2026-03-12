/**
 * msgcode: P5.7-R3l-7 Tool 协议重试与 SOUL 路径纠偏回归锁
 *
 * 覆盖：
 * 1) 首轮无 tool_calls 时，二次 required 重试可恢复工具调用
 * 2) read_file 命中错误 SOUL 路径时，应保留原生失败并回灌模型
 * 3) 用户显式给出的其他绝对 SOUL 路径不得被改写
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
            "tooling.mode": "autonomous",
            "tooling.allow": ["bash", "read_file"],
            "tooling.require_confirm": [],
        }, null, 2),
        "utf-8"
    );
    return workspacePath;
}

describe("P5.7-R3l-7: tool protocol retry + SOUL path transparency", () => {
    it("首轮无 tool_calls 时应直接接受模型 no-tool 决策，不再强制 required 重试", async () => {
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

            expect(callCount).toBe(1);
            expect(sawRetryChoice).toBe(false);
            expect(result.toolCall).toBeUndefined();
            expect(result.answer).toContain("我来执行这个命令。");
            expect(result.actionJournal).toEqual([]);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("read_file 的错误 SOUL 路径应保留原生失败并回灌模型", async () => {
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

            if (callCount === 2) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "刚才读取的是错误路径，当前工作区里并没有这个文件；正确的 soul 文件在 .msgcode/SOUL.md。",
                        },
                        finish_reason: "stop",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "unexpected",
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
            expect(result.answer).toContain("错误路径");
            expect(result.actionJournal.length).toBe(1);
            expect(result.actionJournal[0].tool).toBe("read_file");
            expect(result.actionJournal[0].ok).toBe(false);
            expect(result.actionJournal[0].errorCode).toBe("TOOL_EXEC_FAILED");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("用户显式给出的其他 workspace 绝对 SOUL 路径不应被改写", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        const otherWorkspacePath = await createToolEnabledWorkspace();
        const otherSoulPath = join(otherWorkspacePath, ".msgcode", "SOUL.md");
        await writeFile(otherSoulPath, "other-soul-ok", "utf-8");
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
                                id: "call_other_soul_1",
                                type: "function",
                                function: {
                                    name: "read_file",
                                    arguments: JSON.stringify({ path: otherSoulPath }),
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
                        content: "other-soul-read-ok",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "读取另一个 workspace 的 SOUL 文件",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toContain("other-soul-read-ok");
            expect(result.actionJournal.length).toBe(1);
            expect(result.actionJournal[0].tool).toBe("read_file");
            expect(result.actionJournal[0].ok).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
            await rm(otherWorkspacePath, { recursive: true, force: true });
        }
    });

    it("即使用户点名 edit_file，也不应再向模型暴露该工具，最终应改走 bash", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        const targetFile = join(workspacePath, ".msgcode", "toolcheck.txt");
        await writeFile(targetFile, "alpha\n", "utf-8");
        let callCount = 0;

        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
            callCount += 1;
            const body = typeof init?.body === "string"
                ? JSON.parse(init.body) as { tools?: Array<{ function?: { name?: string } }> }
                : {};

            if (callCount === 1) {
                const toolNames = Array.isArray(body.tools)
                    ? body.tools.map((tool) => tool.function?.name).filter(Boolean)
                    : [];
                expect(toolNames).toContain("bash");
                expect(toolNames).toContain("read_file");
                expect(toolNames).not.toContain("edit_file");
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: [{
                                id: "call_bash_fallback",
                                type: "function",
                                function: {
                                    name: "bash",
                                    arguments: JSON.stringify({
                                        command: `perl -0pi -e 's/alpha/beta/g' "${targetFile}"`,
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
                prompt: "请使用 edit_file 工具把 .msgcode/toolcheck.txt 里的 alpha 改成 beta",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2);
            expect(result.toolCall?.name).toBe("bash");
            expect(result.answer).toContain("ok");
            const updated = await Bun.file(targetFile).text();
            expect(updated).toContain("beta");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("总结阶段返回 minimax tool_call 协议片段时，不应再由系统内部补打一轮修正", async () => {
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
            expect(result.answer).toContain("<minimax:tool_call>");
            expect(result.answer).toContain("<invoke name=\"read_file\">");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("用户显式指定 edit_file 工具时，首轮不应再绑定 edit_file，而应改走 bash", async () => {
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
                                    name: "bash",
                                    arguments: JSON.stringify({
                                        command: `perl -0pi -e 's/alpha/beta/g' "${join(workspacePath, ".msgcode", "toolcheck.txt")}"`,
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
            expect(firstToolNames).toContain("bash");
            expect(firstToolNames).toContain("read_file");
            expect(firstToolNames).not.toContain("edit_file");
            expect(firstToolChoice === "required" || firstToolChoice === "auto" || firstToolChoice === undefined).toBe(true);
            expect(result.toolCall?.name).toBe("bash");

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

    it("显式要求 read_file 但模型持续调用允许的 bash 时，不应新增前置拒绝层", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;
            // 首轮 + 纠偏轮都返回错误工具 bash
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
                    message: { role: "assistant", content: "unexpected" },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "请使用 read_file 工具读取 .msgcode/toolcheck.txt",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(3);
            expect(result.answer).toContain("unexpected");
            expect(result.actionJournal.filter((entry) => entry.phase === "act")).toHaveLength(2);
            expect(result.actionJournal.filter((entry) => entry.phase === "act").every((entry) => entry.tool === "bash")).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("模型若调用本轮未暴露工具，应把 TOOL_NOT_ALLOWED 回灌模型，而不是直接替模型结案", async () => {
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
                                id: "call_unexpected_edit",
                                type: "function",
                                function: {
                                    name: "edit_file",
                                    arguments: JSON.stringify({
                                        path: ".msgcode/toolcheck.txt",
                                        oldText: "alpha",
                                        newText: "beta",
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
                        content: "当前这轮没有暴露 edit_file，我先停下，不对用户谎称已经改成功。",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "把 toolcheck.txt 里的 alpha 改成 beta",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toContain("没有暴露 edit_file");
            expect(result.answer).not.toContain("TOOL_NOT_ALLOWED");
            expect(result.actionJournal).toHaveLength(1);
            expect(result.actionJournal[0]?.ok).toBe(false);
            expect(result.actionJournal[0]?.errorCode).toBe("TOOL_NOT_ALLOWED");
            expect(result.verifyResult).toBeUndefined();
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

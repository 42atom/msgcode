/**
 * msgcode: P5.7-R3h 工具失败合同与诊断增强行为回归锁
 *
 * 目标：
 * - 非零退出码/超时语义
 * - stderr/stdout 诊断字段保真
 * - 三类失败语义：MODEL_PROTOCOL_FAILED / TOOL_EXEC_FAILED / TOOL_LOOP_LIMIT_EXCEEDED
 */

import { describe, it, expect } from "bun:test";
import { runBashCommand } from "../src/runners/bash-runner.js";
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
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r3h-tool-failure-"));
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

describe("P5.7-R3h: Tool Failure Diagnostics (Behavior Lock)", () => {
    describe("非零退出码与超时语义", () => {
        it("应正确返回非零退出码", async () => {
            const result = await runBashCommand({
                command: "exit 42",
                cwd: process.cwd(),
            });

            expect(result.ok).toBe(false);
            expect(result.exitCode).toBe(42);
        });

        it("应区分超时退出码(-1)与正常退出码", async () => {
            const timeoutResult = await runBashCommand({
                command: "sleep 5",
                cwd: process.cwd(),
                timeoutMs: 100,
            });
            expect(timeoutResult.ok).toBe(false);
            expect(timeoutResult.exitCode).toBe(-1);
            expect(timeoutResult.error).toContain("超时");

            const normalResult = await runBashCommand({
                command: "exit 0",
                cwd: process.cwd(),
            });
            expect(normalResult.ok).toBe(true);
            expect(normalResult.exitCode).toBe(0);
        });
    });

    describe("诊断字段保真", () => {
        it("应区分 stdout 与 stderr", async () => {
            const result = await runBashCommand({
                command: "echo 'stdout text' && echo 'stderr text' >&2",
                cwd: process.cwd(),
            });
            expect(result.stdoutTail).toContain("stdout text");
            expect(result.stderrTail).toContain("stderr text");
        });

        it("runBashCommand 返回结构应包含诊断字段", async () => {
            const result = await runBashCommand({
                command: "echo test",
                cwd: process.cwd(),
            });

            expect(result).toHaveProperty("ok");
            expect(result).toHaveProperty("exitCode");
            expect(result).toHaveProperty("stdoutTail");
            expect(result).toHaveProperty("stderrTail");
            expect(result).toHaveProperty("durationMs");
        });

        it("大输出应触发 fullOutputPath 落盘", async () => {
            const result = await runBashCommand({
                command: "seq 1 1500",
                cwd: process.cwd(),
            });
            expect(result.ok).toBe(true);
            expect(result.fullOutputPath).toBeDefined();
        });
    });

    describe("失败类型三分", () => {
        it("无 tool_calls 时应返回 MODEL_PROTOCOL_FAILED", async () => {
            const originalFetch = globalThis.fetch;
            const workspacePath = await createToolEnabledWorkspace();
            let callCount = 0;

            globalThis.fetch = (async () => {
                callCount += 1;
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "我来帮你处理。",
                        },
                        finish_reason: "stop",
                    }],
                });
            }) as typeof fetch;

            try {
                const result = await runLmStudioToolLoop({
                    baseUrl: "http://127.0.0.1:1234",
                    model: "test-model",
                    prompt: "请用 bash 执行 pwd",
                    workspacePath,
                    timeoutMs: 10_000,
                    backendRuntime: localOpenAiRuntime,
                });

                // 首轮 + required-retry + strict-retry
                expect(callCount).toBe(3);
                expect(result.answer).toContain("MODEL_PROTOCOL_FAILED");
                expect(result.actionJournal).toEqual([]);
            } finally {
                globalThis.fetch = originalFetch;
                await rm(workspacePath, { recursive: true, force: true });
            }
        });

        it("工具执行失败时应返回 TOOL_EXEC_FAILED 且保留退出码", async () => {
            const originalFetch = globalThis.fetch;
            const workspacePath = await createToolEnabledWorkspace();

            globalThis.fetch = (async () => asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "",
                        tool_calls: [{
                            id: "call_exec_fail",
                            type: "function",
                            function: {
                                name: "bash",
                                arguments: JSON.stringify({
                                    command: "sh -c \"echo boom >&2; exit 5\"",
                                }),
                            },
                        }],
                    },
                    finish_reason: "tool_calls",
                }],
            })) as typeof fetch;

            try {
                const result = await runLmStudioToolLoop({
                    baseUrl: "http://127.0.0.1:1234",
                    model: "test-model",
                    prompt: "执行失败命令",
                    workspacePath,
                    timeoutMs: 10_000,
                    backendRuntime: localOpenAiRuntime,
                });

                expect(result.answer).toContain("TOOL_EXEC_FAILED");
                expect(result.answer).toContain("退出码");
                expect(result.actionJournal.length).toBe(1);
                expect(result.actionJournal[0].ok).toBe(false);
                expect(result.actionJournal[0].errorCode).toBe("TOOL_EXEC_FAILED");
                expect(result.actionJournal[0].exitCode).toBe(5);
            } finally {
                globalThis.fetch = originalFetch;
                await rm(workspacePath, { recursive: true, force: true });
            }
        });

        it("单轮工具调用超限时应返回 TOOL_LOOP_LIMIT_EXCEEDED", async () => {
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
                    // P5.7-R12-T8: 显式设置 conservative 档位，确保 9 次调用触发超限
                    quotaProfile: "conservative",
                    backendRuntime: localOpenAiRuntime,
                });

                expect(result.answer).toContain("TOOL_LOOP_LIMIT_EXCEEDED");
                expect(result.actionJournal).toEqual([]);
            } finally {
                globalThis.fetch = originalFetch;
                await rm(workspacePath, { recursive: true, force: true });
            }
        });
    });
});

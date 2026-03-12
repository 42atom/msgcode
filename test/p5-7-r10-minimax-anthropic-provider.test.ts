import { describe, it, expect } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runAgentChat } from "../src/agent-backend.js";
import { runAgentRoutedChat } from "../src/agent-backend/routed-chat.js";
import { config } from "../src/config.js";
import { runLmStudioToolLoop } from "../src/lmstudio.js";

type MiniMaxMessagesResponse = {
    role: "assistant";
    content: Array<Record<string, unknown>>;
    stop_reason: string;
};

const minimaxRuntime = {
    id: "minimax" as const,
    baseUrl: "https://api.minimax.chat/v1",
    apiKey: "test-minimax-key",
    model: "MiniMax-M2.5",
    timeoutMs: 10_000,
    nativeApiEnabled: false,
};

function asJsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

async function createToolEnabledWorkspace(): Promise<string> {
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-minimax-anthropic-"));
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

describe("P5.7-R10: MiniMax Anthropic provider", () => {
    it("workspace 显式禁用工具时，仍应走统一 tool-loop 并返回模型真实 no-tool 结果", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-minimax-no-tools-"));
        await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
        await writeFile(
            join(workspacePath, ".msgcode", "config.json"),
            JSON.stringify({
                "tooling.mode": "explicit",
                "tooling.allow": [],
                "tooling.require_confirm": [],
            }, null, 2),
            "utf-8"
        );
        let capturedUrl = "";
        let capturedBody: Record<string, unknown> = {};

        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            capturedUrl = String(input);
            capturedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
            return asJsonResponse({
                role: "assistant",
                content: [
                    { type: "text", text: "我是纯聊天回复，没有工具。" },
                ],
                stop_reason: "end_turn",
            } satisfies MiniMaxMessagesResponse);
        }) as typeof fetch;

        try {
            const result = await runAgentRoutedChat({
                prompt: "你现在可以看到我吗",
                workspacePath,
                agentProvider: "minimax",
            });

            expect(result.route).toBe("no-tool");
            expect(result.decisionSource).toBe("model");
            expect(result.answer).toBe("我是纯聊天回复，没有工具。");
            expect(result.answer).not.toContain("<minimax:tool_call>");
            expect(capturedUrl).toBe("https://api.minimax.chat/anthropic/v1/messages");
            expect(capturedBody).not.toHaveProperty("tools");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("runAgentChat 在 minimax 下应命中 Anthropic-compatible endpoint", async () => {
        const originalFetch = globalThis.fetch;
        let capturedUrl = "";
        let capturedHeaders: HeadersInit | undefined;
        let capturedBody: Record<string, unknown> = {};

        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            capturedUrl = String(input);
            capturedHeaders = init?.headers;
            capturedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};

            return asJsonResponse({
                role: "assistant",
                content: [
                    { type: "thinking", thinking: "internal-only" },
                    { type: "text", text: "MiniMax chat ok" },
                ],
                stop_reason: "end_turn",
            } satisfies MiniMaxMessagesResponse);
        }) as typeof fetch;

        try {
            const answer = await runAgentChat({
                prompt: "直接回答一句话",
                backendRuntime: minimaxRuntime,
            });

            expect(answer).toBe("MiniMax chat ok");
            expect(capturedUrl).toBe("https://api.minimax.chat/anthropic/v1/messages");
            expect(capturedBody.model).toBe("MiniMax-M2.5");
            expect(capturedBody).not.toHaveProperty("tools");
            expect(Array.isArray(capturedBody.messages)).toBe(true);
            expect((capturedBody.messages as Array<Record<string, unknown>>)[0]?.role).toBe("user");

            const headers = new Headers(capturedHeaders);
            expect(headers.get("x-api-key")).toBe("test-minimax-key");
            expect(headers.get("anthropic-version")).toBe("2023-06-01");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("runLmStudioToolLoop 在 minimax 下应使用 Anthropic tools + tool_result 回灌", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        await writeFile(join(workspacePath, ".msgcode", "info.txt"), "hello-minimax", "utf-8");
        let callCount = 0;
        const capturedBodies: Array<Record<string, unknown>> = [];

        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
            callCount += 1;
            const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
            capturedBodies.push(body);

            if (callCount === 1) {
                return asJsonResponse({
                    role: "assistant",
                    content: [
                        { type: "thinking", thinking: "先读文件" },
                        {
                            type: "tool_use",
                            id: "toolu_read_1",
                            name: "read_file",
                            input: { path: ".msgcode/info.txt" },
                        },
                    ],
                    stop_reason: "tool_use",
                } satisfies MiniMaxMessagesResponse);
            }

            return asJsonResponse({
                role: "assistant",
                content: [
                    { type: "text", text: "读取完成：hello-minimax" },
                ],
                stop_reason: "end_turn",
            } satisfies MiniMaxMessagesResponse);
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "读取 info 文件",
                workspacePath,
                backendRuntime: minimaxRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(2);
            expect(result.answer).toContain("读取完成");
            expect(result.answer).toContain("hello-minimax");
            expect(result.actionJournal.length).toBe(2);
            expect(result.actionJournal[0].tool).toBe("read_file");

            const firstBody = capturedBodies[0];
            expect(Array.isArray(firstBody.tools)).toBe(true);
            expect((firstBody.tools as Array<Record<string, unknown>>)[0]).toHaveProperty("input_schema");
            expect((firstBody.tools as Array<Record<string, unknown>>)[0]).not.toHaveProperty("function");

            const secondBody = capturedBodies[1];
            const secondMessages = secondBody.messages as Array<Record<string, unknown>>;
            const lastMessage = secondMessages[secondMessages.length - 1];
            expect(lastMessage.role).toBe("user");
            expect(Array.isArray(lastMessage.content)).toBe(true);
            expect((lastMessage.content as Array<Record<string, unknown>>)[0]?.type).toBe("tool_result");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("runLmStudioToolLoop 在 minimax 下应支持多轮 tool_use", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        await writeFile(join(workspacePath, ".msgcode", "round2.txt"), "round-two", "utf-8");
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;

            if (callCount === 1) {
                return asJsonResponse({
                    role: "assistant",
                    content: [
                        {
                            type: "tool_use",
                            id: "toolu_bash_1",
                            name: "bash",
                            input: { command: "printf 'round1'" },
                        },
                    ],
                    stop_reason: "tool_use",
                } satisfies MiniMaxMessagesResponse);
            }

            if (callCount === 2) {
                return asJsonResponse({
                    role: "assistant",
                    content: [
                        {
                            type: "tool_use",
                            id: "toolu_read_2",
                            name: "read_file",
                            input: { path: ".msgcode/round2.txt" },
                        },
                    ],
                    stop_reason: "tool_use",
                } satisfies MiniMaxMessagesResponse);
            }

            return asJsonResponse({
                role: "assistant",
                content: [
                    { type: "text", text: "MiniMax multi-round ok" },
                ],
                stop_reason: "end_turn",
            } satisfies MiniMaxMessagesResponse);
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "先执行命令再读文件",
                workspacePath,
                backendRuntime: minimaxRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(3);
            expect(result.answer).toBe("MiniMax multi-round ok");
            expect(result.actionJournal.length).toBe(3);
            expect(result.actionJournal[0].tool).toBe("bash");
            expect(result.actionJournal[1].tool).toBe("read_file");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("runLmStudioToolLoop 在 minimax 下工具失败也应经过 finish supervisor", async () => {
        const originalFetch = globalThis.fetch;
        const originalSupervisorConfig = { ...config.supervisor };
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        config.supervisor.enabled = true;
        config.supervisor.temperature = 0;
        config.supervisor.maxTokens = 200;

        globalThis.fetch = (async () => {
            callCount += 1;

            if (callCount === 1) {
                return asJsonResponse({
                    role: "assistant",
                    content: [
                        {
                            type: "tool_use",
                            id: "toolu_bash_fail_1",
                            name: "bash",
                            input: { command: "touch .msgcode/anthropic-fail.marker && sh -c \"echo anthropic-fail >&2; exit 6\"" },
                        },
                    ],
                    stop_reason: "tool_use",
                } satisfies MiniMaxMessagesResponse);
            }

            return asJsonResponse({
                role: "assistant",
                content: [
                    { type: "text", text: "PASS" },
                ],
                stop_reason: "end_turn",
            } satisfies MiniMaxMessagesResponse);
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "执行一个会失败的命令",
                workspacePath,
                backendRuntime: minimaxRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(3);
            expect(result.answer).toContain("PASS");
            expect(result.answer).not.toContain("TOOL_EXEC_FAILED");
            expect(result.verifyResult?.ok).toBe(false);
            expect(result.verifyResult?.errorCode).toBe("TOOL_VERIFY_FAILED");
            expect(result.actionJournal.map((entry) => `${entry.phase}:${entry.tool}:${entry.ok}`)).toEqual([
                "act:bash:false",
                "verify:bash:false",
                "report:finish-supervisor:true",
            ]);
        } finally {
            globalThis.fetch = originalFetch;
            config.supervisor.enabled = originalSupervisorConfig.enabled;
            config.supervisor.temperature = originalSupervisorConfig.temperature;
            config.supervisor.maxTokens = originalSupervisorConfig.maxTokens;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("finish supervisor 在 minimax 下只返回 thinking PASS 时也应放行成功任务", async () => {
        const originalFetch = globalThis.fetch;
        const originalSupervisorConfig = { ...config.supervisor };
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        config.supervisor.enabled = true;
        config.supervisor.temperature = 0;
        config.supervisor.maxTokens = 200;

        globalThis.fetch = (async () => {
            callCount += 1;

            if (callCount === 1) {
                return asJsonResponse({
                    role: "assistant",
                    content: [
                        {
                            type: "tool_use",
                            id: "toolu_bash_success_1",
                            name: "bash",
                            input: { command: "touch .msgcode/minimax-supervisor-ok.marker" },
                        },
                    ],
                    stop_reason: "tool_use",
                } satisfies MiniMaxMessagesResponse);
            }

            if (callCount === 2) {
                return asJsonResponse({
                    role: "assistant",
                    content: [
                        { type: "text", text: "已创建完成。" },
                    ],
                    stop_reason: "end_turn",
                } satisfies MiniMaxMessagesResponse);
            }

            return asJsonResponse({
                role: "assistant",
                content: [
                    { type: "thinking", thinking: "PASS" },
                ],
                stop_reason: "end_turn",
            } satisfies MiniMaxMessagesResponse);
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                prompt: "创建一个标记文件并结束",
                workspacePath,
                backendRuntime: minimaxRuntime,
                timeoutMs: 10_000,
            });

            expect(callCount).toBe(3);
            expect(result.answer).toBe("已创建完成。");
            expect(result.actionJournal.map((entry) => `${entry.phase}:${entry.tool}:${entry.ok}`)).toEqual([
                "act:bash:true",
                "verify:bash:true",
                "report:finish-supervisor:true",
            ]);
        } finally {
            globalThis.fetch = originalFetch;
            config.supervisor.enabled = originalSupervisorConfig.enabled;
            config.supervisor.temperature = originalSupervisorConfig.temperature;
            config.supervisor.maxTokens = originalSupervisorConfig.maxTokens;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

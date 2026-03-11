import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAgentRoutedChat } from "../src/agent-backend/routed-chat.js";

function asJsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

async function createToolWorkspace(): Promise<string> {
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r21-routed-chat-"));
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

describe("P5.7-R21: routed-chat 松绑 phase3", () => {
    it("默认 routed-chat 应直接进入 tool-loop，并保留模型真实 no-tool 决策", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolWorkspace();
        let callCount = 0;
        let capturedBody: Record<string, unknown> = {};

        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
            callCount += 1;
            capturedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "我先直接回答，不调用工具。",
                    },
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runAgentRoutedChat({
                prompt: "执行一个简单命令",
                workspacePath,
            });

            expect(callCount).toBe(1);
            expect(result.route).toBe("no-tool");
            expect(result.decisionSource).toBe("model");
            expect(result.actionJournal).toEqual([]);
            expect(Array.isArray(capturedBody.tools)).toBe(true);
            expect((capturedBody.tools as unknown[]).length).toBeGreaterThan(0);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });

    it("tooling.mode=explicit 时应直接走 no-tool 主链，不向模型发送 tools[]", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r21-routed-chat-explicit-"));
        await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
        await writeFile(
            join(workspacePath, ".msgcode", "config.json"),
            JSON.stringify({
                "tooling.mode": "explicit",
                "tooling.allow": ["bash", "read_file"],
                "tooling.require_confirm": [],
            }, null, 2),
            "utf-8"
        );

        let capturedBody: Record<string, unknown> = {};

        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
            capturedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "显式模式直答。",
                    },
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runAgentRoutedChat({
                prompt: "直接回答，不要用工具",
                workspacePath,
                agentProvider: "agent-backend",
            });

            expect(result.route).toBe("no-tool");
            expect(result.actionJournal).toEqual([]);
            expect(result.answer).toBe("显式模式直答。");
            expect(capturedBody).not.toHaveProperty("tools");
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

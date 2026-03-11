import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
    const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-r20-unshackle-"));
    await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
    await writeFile(
        join(workspacePath, ".msgcode", "config.json"),
        JSON.stringify({
            "tooling.mode": "autonomous",
            "tooling.allow": ["bash", "read_file", "browser"],
            "tooling.require_confirm": [],
        }, null, 2),
        "utf-8"
    );
    return workspacePath;
}

describe("P5.7-R20: LLM 松绑 phase2", () => {
  it("prompt 不再包含旧强控制文案", async () => {
    const { MCP_ANTI_LOOP_RULES, EXEC_TOOL_PROTOCOL_CONSTRAINT } = await import("../src/agent-backend/index.js");

        expect(MCP_ANTI_LOOP_RULES).not.toContain("整个问题最多调用工具 3 次");
        expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).not.toContain("第一轮必须优先产出 tool_calls");
    expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).not.toContain("没有工具结果前");
    expect(EXEC_TOOL_PROTOCOL_CONSTRAINT).toContain("不伪造已经完成的动作或结果");
  });

  it("默认口径下 21 次工具调用不会被旧 hard cap 提前截断", async () => {
    const originalFetch = globalThis.fetch;
        const workspacePath = await createToolEnabledWorkspace();
        let callCount = 0;

        const manyCalls = Array.from({ length: 21 }, (_, idx) => ({
            id: `call_${idx}`,
            type: "function" as const,
            function: {
                name: "bash",
                arguments: JSON.stringify({ command: "true" }),
            },
        }));

        globalThis.fetch = (async () => {
            callCount += 1;

            if (callCount === 1) {
                return asJsonResponse({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: manyCalls,
                        },
                        finish_reason: "tool_calls",
                    }],
                });
            }

            return asJsonResponse({
                choices: [{
                    message: {
                        role: "assistant",
                        content: "长循环执行完成",
                    },
                    finish_reason: "stop",
                }],
            });
        }) as typeof fetch;

        try {
            const result = await runLmStudioToolLoop({
                baseUrl: "http://127.0.0.1:1234",
                model: "test-model",
                prompt: "执行 21 次 bash",
                workspacePath,
                timeoutMs: 10_000,
                backendRuntime: localOpenAiRuntime,
            });

            expect(result.answer).toContain("长循环执行完成");
            expect(result.answer).not.toContain("TOOL_LOOP_LIMIT_EXCEEDED");
            expect(result.actionJournal.length).toBeGreaterThan(20);
            expect(result.perTurnToolCallLimit).toBe(199);
            expect(result.perTurnToolStepLimit).toBe(597);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

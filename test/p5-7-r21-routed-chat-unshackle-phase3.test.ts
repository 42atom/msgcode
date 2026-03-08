import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
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
            "pi.enabled": true,
            "tooling.mode": "autonomous",
            "tooling.allow": ["bash", "read_file"],
            "tooling.require_confirm": [],
        }, null, 2),
        "utf-8"
    );
    return workspacePath;
}

describe("P5.7-R21: routed-chat 松绑 phase3", () => {
    it("routed-chat 源码中不再保留前置路由残影", () => {
        const source = readFileSync(join(process.cwd(), "src/agent-backend", "routed-chat.ts"), "utf-8");

        expect(source).not.toContain("forceComplexTool");
        expect(source).not.toContain("hasToolsAvailable");
        expect(source).not.toContain("allowNoTool");
        expect(source).not.toContain("degrade mode: forcing no-tool");
        expect(source).not.toContain('decisionSource: "router"');
        expect(source).not.toContain('decisionSource: "degrade"');
    });

    it("默认 routed-chat 应直接进入 tool-loop，并保留模型真实 no-tool 决策", async () => {
        const originalFetch = globalThis.fetch;
        const workspacePath = await createToolWorkspace();
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount += 1;
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
        } finally {
            globalThis.fetch = originalFetch;
            await rm(workspacePath, { recursive: true, force: true });
        }
    });
});

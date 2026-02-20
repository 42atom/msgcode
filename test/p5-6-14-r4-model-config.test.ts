/**
 * msgcode: P5.6.14-R4 /model 命令回归锁 - 配置层测试
 *
 * 验收口径：
 * 1. /model codex 映射到 runtime.kind=tmux + tmux.client=codex
 * 2. /model claude-code 映射到 runtime.kind=tmux + tmux.client=claude-code
 * 3. /model lmstudio 映射到 runtime.kind=agent + agent.provider=lmstudio
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

async function createTestWorkspace(): Promise<string> {
    const tmpDir = await fs.mkdtemp(path.join("/tmp", "msgcode-model-test-"));
    return tmpDir;
}

async function cleanupTestWorkspace(workspacePath: string): Promise<void> {
    await fs.rm(workspacePath, { recursive: true, force: true });
}

async function writeConfig(workspacePath: string, config: any): Promise<void> {
    const configDir = path.join(workspacePath, ".msgcode");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
        path.join(configDir, "config.json"),
        JSON.stringify(config, null, 2),
        "utf-8"
    );
}

describe("P5.6.14-R4: /model 命令配置层回归锁", () => {
    let workspacePath: string;

    beforeEach(async () => {
        workspacePath = await createTestWorkspace();
    });

    afterEach(async () => {
        await cleanupTestWorkspace(workspacePath);
    });

    describe("R4-2: 设置映射 - hotfix 验证", () => {
        it("/model codex 映射到 runtime.kind=tmux + tmux.client=codex", async () => {
            const { setRuntimeKind, setTmuxClient, getRuntimeKind, getTmuxClient } = await import("../src/config/workspace.js");

            // 初始为 agent 模式
            await writeConfig(workspacePath, {
                "runtime.kind": "agent",
                "agent.provider": "lmstudio",
            });

            // 模拟 /model codex 行为
            await setRuntimeKind(workspacePath, "tmux");
            await setTmuxClient(workspacePath, "codex");

            // 验证 runtime.kind=tmux
            const kind = await getRuntimeKind(workspacePath);
            expect(kind).toBe("tmux");

            // 验证 tmux.client=codex
            const client = await getTmuxClient(workspacePath);
            expect(client).toBe("codex");
        });

        it("/model claude-code 映射到 runtime.kind=tmux + tmux.client=claude-code", async () => {
            const { setRuntimeKind, setTmuxClient, getRuntimeKind, getTmuxClient } = await import("../src/config/workspace.js");

            // 初始为 agent 模式
            await writeConfig(workspacePath, {
                "runtime.kind": "agent",
                "agent.provider": "lmstudio",
            });

            // 模拟 /model claude-code 行为
            await setRuntimeKind(workspacePath, "tmux");
            await setTmuxClient(workspacePath, "claude-code");

            // 验证 runtime.kind=tmux
            const kind = await getRuntimeKind(workspacePath);
            expect(kind).toBe("tmux");

            // 验证 tmux.client=claude-code
            const client = await getTmuxClient(workspacePath);
            expect(client).toBe("claude-code");
        });

        it("/model lmstudio 映射到 runtime.kind=agent + agent.provider=lmstudio", async () => {
            const { setRuntimeKind, setAgentProvider, getRuntimeKind, getAgentProvider } = await import("../src/config/workspace.js");

            // 初始为 tmux 模式
            await writeConfig(workspacePath, {
                "runtime.kind": "tmux",
                "tmux.client": "codex",
            });

            // 模拟 /model lmstudio 行为
            await setRuntimeKind(workspacePath, "agent");
            await setAgentProvider(workspacePath, "lmstudio");

            // 验证 runtime.kind=agent
            const kind = await getRuntimeKind(workspacePath);
            expect(kind).toBe("agent");

            // 验证 agent.provider=lmstudio
            const provider = await getAgentProvider(workspacePath);
            expect(provider).toBe("lmstudio");
        });

        it("agent 模式切换到 codex 时 runtime.kind 从 agent 变为 tmux", async () => {
            const { setRuntimeKind, setTmuxClient, getRuntimeKind } = await import("../src/config/workspace.js");

            // 初始为 agent 模式
            await writeConfig(workspacePath, {
                "runtime.kind": "agent",
                "agent.provider": "lmstudio",
            });

            // 验证初始状态
            expect(await getRuntimeKind(workspacePath)).toBe("agent");

            // 模拟 /model codex 行为（切换到 tmux）
            await setRuntimeKind(workspacePath, "tmux");
            await setTmuxClient(workspacePath, "codex");

            // 验证已切换到 tmux
            expect(await getRuntimeKind(workspacePath)).toBe("tmux");
        });
    });

    describe("R4-1: 查询展示", () => {
        it("kind=agent 时 getAgentProvider 返回 provider", async () => {
            const { getRuntimeKind, getAgentProvider } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, {
                "runtime.kind": "agent",
                "agent.provider": "openai",
            });

            expect(await getRuntimeKind(workspacePath)).toBe("agent");
            expect(await getAgentProvider(workspacePath)).toBe("openai");
        });

        it("kind=tmux 时 getTmuxClient 返回 client", async () => {
            const { getRuntimeKind, getTmuxClient } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, {
                "runtime.kind": "tmux",
                "tmux.client": "claude-code",
            });

            expect(await getRuntimeKind(workspacePath)).toBe("tmux");
            expect(await getTmuxClient(workspacePath)).toBe("claude-code");
        });
    });
});

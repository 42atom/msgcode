/**
 * msgcode: P5.6.14-R1 配置映射回归锁
 *
 * 验收口径：
 * 1. runner.default 到新字段的映射正确
 * 2. 新字段优先读取
 * 3. 写配置只写新字段
 * 4. /model 命令兼容旧写法
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

async function createTestWorkspace(): Promise<string> {
    const tmpDir = await fs.mkdtemp(path.join("/tmp", "msgcode-config-test-"));
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

describe("P5.6.14-R1: 配置映射回归锁", () => {
    let workspacePath: string;

    beforeEach(async () => {
        workspacePath = await createTestWorkspace();
    });

    afterEach(async () => {
        await cleanupTestWorkspace(workspacePath);
    });

    describe("R1-1: runner.default 映射", () => {
        it("codex -> runtime.kind=tmux + tmux.client=codex", async () => {
            const { getRuntimeKind, getAgentProvider, getTmuxClient, getDefaultRunner } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, { "runner.default": "codex" });

            expect(await getRuntimeKind(workspacePath)).toBe("tmux");
            expect(await getTmuxClient(workspacePath)).toBe("codex");
            expect(await getAgentProvider(workspacePath)).toBe("none");
            expect(await getDefaultRunner(workspacePath)).toBe("codex");
        });

        it("claude-code -> runtime.kind=tmux + tmux.client=claude-code", async () => {
            const { getRuntimeKind, getAgentProvider, getTmuxClient, getDefaultRunner } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, { "runner.default": "claude-code" });

            expect(await getRuntimeKind(workspacePath)).toBe("tmux");
            expect(await getTmuxClient(workspacePath)).toBe("claude-code");
            expect(await getAgentProvider(workspacePath)).toBe("none");
            expect(await getDefaultRunner(workspacePath)).toBe("claude-code");
        });

        it("lmstudio -> runtime.kind=agent + agent.provider=lmstudio", async () => {
            const { getRuntimeKind, getAgentProvider, getTmuxClient, getDefaultRunner } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, { "runner.default": "lmstudio" });

            expect(await getRuntimeKind(workspacePath)).toBe("agent");
            expect(await getAgentProvider(workspacePath)).toBe("lmstudio");
            expect(await getTmuxClient(workspacePath)).toBe("none");
            expect(await getDefaultRunner(workspacePath)).toBe("lmstudio");
        });

        it("openai -> runtime.kind=agent + agent.provider=openai", async () => {
            const { getRuntimeKind, getAgentProvider, getTmuxClient, getDefaultRunner } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, { "runner.default": "openai" });

            expect(await getRuntimeKind(workspacePath)).toBe("agent");
            expect(await getAgentProvider(workspacePath)).toBe("openai");
            expect(await getTmuxClient(workspacePath)).toBe("none");
            expect(await getDefaultRunner(workspacePath)).toBe("openai");
        });

        it("llama -> runtime.kind=agent + agent.provider=lmstudio（兼容降级）", async () => {
            const { getRuntimeKind, getAgentProvider, getTmuxClient, getDefaultRunner } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, { "runner.default": "llama" });

            expect(await getRuntimeKind(workspacePath)).toBe("agent");
            expect(await getAgentProvider(workspacePath)).toBe("lmstudio"); // 兼容降级
            expect(await getTmuxClient(workspacePath)).toBe("none");
            // getDefaultRunner 返回原始值（保持向后兼容）
            expect(await getDefaultRunner(workspacePath)).toBe("llama");
        });

        it("claude -> runtime.kind=agent + agent.provider=lmstudio（兼容降级）", async () => {
            const { getRuntimeKind, getAgentProvider, getTmuxClient, getDefaultRunner } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, { "runner.default": "claude" });

            expect(await getRuntimeKind(workspacePath)).toBe("agent");
            expect(await getAgentProvider(workspacePath)).toBe("lmstudio"); // 兼容降级
            expect(await getTmuxClient(workspacePath)).toBe("none");
            // getDefaultRunner 返回原始值（保持向后兼容）
            expect(await getDefaultRunner(workspacePath)).toBe("claude");
        });
    });

    describe("R1-2: 新字段优先", () => {
        it("新字段存在时优先读新字段", async () => {
            const { getRuntimeKind, getAgentProvider, getTmuxClient, getDefaultRunner } = await import("../src/config/workspace.js");

            // 同时有新字段和旧字段，新字段优先
            await writeConfig(workspacePath, {
                "runtime.kind": "tmux",
                "tmux.client": "claude-code",
                "runner.default": "lmstudio", // 旧字段应该被忽略
            });

            expect(await getRuntimeKind(workspacePath)).toBe("tmux");
            expect(await getTmuxClient(workspacePath)).toBe("claude-code");
            expect(await getDefaultRunner(workspacePath)).toBe("claude-code"); // 反向映射从新字段
        });

        it("仅有新字段时正常工作", async () => {
            const { getRuntimeKind, getAgentProvider, getTmuxClient, getDefaultRunner } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, {
                "runtime.kind": "agent",
                "agent.provider": "openai",
            });

            expect(await getRuntimeKind(workspacePath)).toBe("agent");
            expect(await getAgentProvider(workspacePath)).toBe("openai");
            expect(await getTmuxClient(workspacePath)).toBe("none");
            expect(await getDefaultRunner(workspacePath)).toBe("openai");
        });
    });

    describe("R1-3: 写配置只写新字段", () => {
        it("setDefaultRunner 写新字段", async () => {
            const { setDefaultRunner, loadWorkspaceConfig } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, {});
            await setDefaultRunner(workspacePath, "codex");

            const config = await loadWorkspaceConfig(workspacePath);
            expect(config["runtime.kind"]).toBe("tmux");
            expect(config["tmux.client"]).toBe("codex");
            // 旧字段不应该被写入（或者即使写入也不作为主判定）
        });

        it("setDefaultRunner 写 agent provider", async () => {
            const { setDefaultRunner, loadWorkspaceConfig } = await import("../src/config/workspace.js");

            await writeConfig(workspacePath, {});
            await setDefaultRunner(workspacePath, "openai");

            const config = await loadWorkspaceConfig(workspacePath);
            expect(config["runtime.kind"]).toBe("agent");
            expect(config["agent.provider"]).toBe("openai");
        });
    });

    describe("R1-4: 默认值", () => {
        it("无配置文件时使用默认值", async () => {
            const { getRuntimeKind, getAgentProvider, getTmuxClient, getDefaultRunner } = await import("../src/config/workspace.js");

            // 不写配置文件
            expect(await getRuntimeKind(workspacePath)).toBe("agent");
            expect(await getAgentProvider(workspacePath)).toBe("lmstudio");
            expect(await getTmuxClient(workspacePath)).toBe("none");
            expect(await getDefaultRunner(workspacePath)).toBe("lmstudio");
        });
    });

    describe("R1-5: session-orchestrator.resolveRunner", () => {
        it("resolveRunner 使用 runtime.kind 判断", async () => {
            const { resolveRunner } = await import("../src/runtime/session-orchestrator.js");

            // tmux 模式
            await writeConfig(workspacePath, { "runner.default": "codex" });
            let result = await resolveRunner(workspacePath);
            expect(result.runner).toBe("tmux");
            expect(result.runnerConfig).toBe("codex");

            // agent 模式
            await writeConfig(workspacePath, { "runner.default": "lmstudio" });
            result = await resolveRunner(workspacePath);
            expect(result.runner).toBe("direct");
            expect(result.runnerConfig).toBe("lmstudio");
        });

        it("resolveRunner 使用新字段", async () => {
            const { resolveRunner } = await import("../src/runtime/session-orchestrator.js");

            await writeConfig(workspacePath, {
                "runtime.kind": "tmux",
                "tmux.client": "claude-code",
            });

            const result = await resolveRunner(workspacePath);
            expect(result.runner).toBe("tmux");
            expect(result.runnerConfig).toBe("claude-code");
        });
    });
});

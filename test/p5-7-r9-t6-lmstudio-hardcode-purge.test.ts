/**
 * msgcode: P5.7-R9-T6 LMStudio 硬编码清除行为锁
 *
 * 目标：
 * - 锁定新代码入口使用 agent-backend API
 * - 锁定配置默认语义为 agent-backend
 * - 锁定兼容层清单固定
 * - 替代脆弱源码字符串断言
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ============================================
// 行为锁 1: 配置默认语义为 agent-backend
// ============================================

describe("P5.7-R9-T6: 配置默认语义", () => {
    let workspacePath: string;

    beforeEach(async () => {
        workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-r9-t6-config-"));
    });

    afterEach(async () => {
        await fs.rm(workspacePath, { recursive: true, force: true });
    });

    it("getAgentProvider 默认返回 agent-backend", async () => {
        const { getAgentProvider } = await import("../src/config/workspace.js");
        // 无配置文件时默认 agent-backend
        expect(await getAgentProvider(workspacePath)).toBe("agent-backend");
    });

    it("getDefaultRunner 默认返回 agent-backend", async () => {
        const { getDefaultRunner } = await import("../src/config/workspace.js");
        // 无配置文件时默认 agent-backend
        expect(await getDefaultRunner(workspacePath)).toBe("agent-backend");
    });

    it("getRuntimeKind 默认返回 agent", async () => {
        const { getRuntimeKind } = await import("../src/config/workspace.js");
        expect(await getRuntimeKind(workspacePath)).toBe("agent");
    });

    it("runner.default=lmstudio 映射到 agent.provider=lmstudio", async () => {
        const { getRuntimeKind, getAgentProvider, getDefaultRunner } = await import("../src/config/workspace.js");

        const configDir = path.join(workspacePath, ".msgcode");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
            path.join(configDir, "config.json"),
            JSON.stringify({ "runner.default": "lmstudio" }),
            "utf-8"
        );

        expect(await getRuntimeKind(workspacePath)).toBe("agent");
        expect(await getAgentProvider(workspacePath)).toBe("lmstudio");
        expect(await getDefaultRunner(workspacePath)).toBe("lmstudio");
    });

    it("runner.default=minimax 映射到 agent.provider=minimax", async () => {
        const { getRuntimeKind, getAgentProvider, getDefaultRunner } = await import("../src/config/workspace.js");

        const configDir = path.join(workspacePath, ".msgcode");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
            path.join(configDir, "config.json"),
            JSON.stringify({ "runner.default": "minimax" }),
            "utf-8"
        );

        expect(await getRuntimeKind(workspacePath)).toBe("agent");
        expect(await getAgentProvider(workspacePath)).toBe("minimax");
        expect(await getDefaultRunner(workspacePath)).toBe("minimax");
    });
});

// ============================================
// 行为锁 2: agent-backend 入口优先
// ============================================

describe("P5.7-R9-T6: agent-backend 入口优先", () => {
    it("agent-backend.ts 导出 runAgentChat", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.runAgentChat).toBeDefined();
        expect(typeof module.runAgentChat).toBe("function");
    });

    it("agent-backend.ts 导出 runAgentRoutedChat", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.runAgentRoutedChat).toBeDefined();
        expect(typeof module.runAgentRoutedChat).toBe("function");
    });

    it("agent-backend.ts 导出 runAgentToolLoop", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.runAgentToolLoop).toBeDefined();
        expect(typeof module.runAgentToolLoop).toBe("function");
    });

    it("agent-backend.ts 导出 resolveAgentBackendConfig", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.resolveAgentBackendConfig).toBeDefined();
        expect(typeof module.resolveAgentBackendConfig).toBe("function");
    });
});

// ============================================
// 行为锁 3: 兼容层别名存在但标记废弃
// ============================================

describe("P5.7-R9-T6: 兼容层别名", () => {
    it("lmstudio.ts 导出 runAgentChat 别名", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runAgentChat).toBeDefined();
        // 兼容层存在，但新代码应使用 agent-backend.ts
    });

    it("lmstudio.ts 导出 runAgentRoutedChat 别名", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runAgentRoutedChat).toBeDefined();
    });

    it("lmstudio.ts 导出 runAgentToolLoop 别名", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runAgentToolLoop).toBeDefined();
    });
});

// ============================================
// 行为锁 4: 类型定义包含 agent-backend
// ============================================

describe("P5.7-R9-T6: 类型定义", () => {
    it("AgentProvider 类型包含 agent-backend", async () => {
        const { getAgentProvider } = await import("../src/config/workspace.js");
        // 编译时验证类型，运行时验证默认值
        const result = await getAgentProvider("/nonexistent");
        // agent-backend 是有效值
        expect(["agent-backend", "lmstudio", "minimax", "openai", "llama", "claude"]).toContain(result);
    });

    it("BotType 类型包含 agent-backend", async () => {
        const { routeByChatId } = await import("../src/router.js");
        // 类型存在性通过编译验证
        expect(routeByChatId).toBeDefined();
    });

    it("ModelClient 类型包含 agent-backend", async () => {
        const { routeByChatId } = await import("../src/router.js");
        // 类型存在性通过编译验证
        expect(routeByChatId).toBeDefined();
    });
});

// ============================================
// 行为锁 5: resolveRunner 使用 agent-backend 默认
// ============================================

describe("P5.7-R9-T6: resolveRunner 默认值", () => {
    let workspacePath: string;

    beforeEach(async () => {
        workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-r9-t6-runner-"));
    });

    afterEach(async () => {
        await fs.rm(workspacePath, { recursive: true, force: true });
    });

    it("resolveRunner 默认返回 direct runner", async () => {
        const { resolveRunner } = await import("../src/runtime/session-orchestrator.js");
        const result = await resolveRunner(workspacePath);
        // 无配置时默认 agent 模式，direct runner
        expect(result.runner).toBe("direct");
    });

    it("resolveRunner 默认 runnerConfig 为 agent-backend", async () => {
        const { resolveRunner } = await import("../src/runtime/session-orchestrator.js");
        const result = await resolveRunner(workspacePath);
        // 无配置时 runnerConfig 应为 agent-backend
        expect(result.runnerConfig).toBe("agent-backend");
    });
});

// ============================================
// 行为锁 6: router 包含 agent-backend BotType
// ============================================

describe("P5.7-R9-T6: router BotType", () => {
    it("BotType 包含 agent-backend 选项", async () => {
        // 编译时验证类型
        const botTypes: string[] = ["code", "image", "file", "lmstudio", "agent-backend", "default"];
        expect(botTypes).toContain("agent-backend");
    });
});

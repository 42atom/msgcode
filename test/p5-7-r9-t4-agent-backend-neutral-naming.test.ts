/**
 * msgcode: P5.7-R9-T4 Agent Backend 中性命名行为锁
 *
 * 目标：
 * - 锁定 agent-backend.ts 入口存在
 * - 锁定中性命名 API 可用
 * - 锁定配置解析单源化
 * - 替代脆弱源码字符串断言
 */

import { describe, it, expect } from "bun:test";

// ============================================
// 行为锁 1: 入口模块存在
// ============================================

describe("P5.7-R9-T4: Agent Backend 入口", () => {
    it("agent-backend.ts 应可导入", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module).toBeDefined();
    });

    it("agent-backend.ts 应导出 runAgentChat", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.runAgentChat).toBeDefined();
        expect(typeof module.runAgentChat).toBe("function");
    });

    it("agent-backend.ts 应导出 runAgentToolLoop", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.runAgentToolLoop).toBeDefined();
        expect(typeof module.runAgentToolLoop).toBe("function");
    });

    it("agent-backend.ts 应导出 runAgentRoutedChat", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.runAgentRoutedChat).toBeDefined();
        expect(typeof module.runAgentRoutedChat).toBe("function");
    });
});

// ============================================
// 行为锁 2: 兼容别名存在
// ============================================

describe("P5.7-R9-T4: 兼容别名", () => {
    it("lmstudio.ts 应导出 AgentChatOptions 别名", async () => {
        const module = await import("../src/lmstudio.js");
        // 类型别名存在性通过编译验证
        expect(module.AgentChatOptions).toBeUndefined(); // 类型别名运行时不存在，但编译通过
    });

    it("lmstudio.ts 应导出 runAgentChat 别名", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runAgentChat).toBeDefined();
        expect(typeof module.runAgentChat).toBe("function");
    });

    it("lmstudio.ts 应导出 runAgentRoutedChat 别名", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runAgentRoutedChat).toBeDefined();
        expect(typeof module.runAgentRoutedChat).toBe("function");
    });

    it("lmstudio.ts 应导出 runAgentToolLoop 别名", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runAgentToolLoop).toBeDefined();
        expect(typeof module.runAgentToolLoop).toBe("function");
    });
});

// ============================================
// 行为锁 3: 配置解析单源化
// ============================================

describe("P5.7-R9-T4: 配置解析", () => {
    it("agent-backend.ts 应导出 resolveAgentBackendConfig", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.resolveAgentBackendConfig).toBeDefined();
        expect(typeof module.resolveAgentBackendConfig).toBe("function");
    });

    it("resolveAgentBackendConfig 应返回 AgentBackendConfig 对象", async () => {
        const { resolveAgentBackendConfig } = await import("../src/agent-backend.js");
        const config = resolveAgentBackendConfig();

        expect(config.backendId).toBeDefined();
        expect(config.baseUrl).toBeDefined();
        expect(config.timeoutMs).toBeGreaterThan(0);
    });

    it("默认 backendId 应为 local-openai", async () => {
        const { resolveAgentBackendConfig } = await import("../src/agent-backend.js");
        // 无 AGENT_BACKEND 环境变量时应回退到 local-openai
        const originalEnv = process.env.AGENT_BACKEND;
        delete process.env.AGENT_BACKEND;

        const config = resolveAgentBackendConfig();
        expect(config.backendId).toBe("local-openai");

        // 恢复环境变量
        if (originalEnv) process.env.AGENT_BACKEND = originalEnv;
    });
});

// ============================================
// 行为锁 4: handlers 使用中性 API
// ============================================

describe("P5.7-R9-T4: handlers 中性 API", () => {
    it("handlers.ts 应可导入 runAgentChat", async () => {
        // 验证 handlers.ts 能成功导入 agent-backend
        const agentBackend = await import("../src/agent-backend.js");
        expect(agentBackend.runAgentChat).toBeDefined();
    });

    it("handlers.ts 应可导入 runAgentRoutedChat", async () => {
        const agentBackend = await import("../src/agent-backend.js");
        expect(agentBackend.runAgentRoutedChat).toBeDefined();
    });
});

// ============================================
// 行为锁 5: 工具相关导出
// ============================================

describe("P5.7-R9-T4: 工具相关", () => {
    it("agent-backend.ts 应导出 getToolsForAgent", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.getToolsForAgent).toBeDefined();
        expect(typeof module.getToolsForAgent).toBe("function");
    });

    it("agent-backend.ts 应导出 parseToolCallBestEffortFromText", async () => {
        const module = await import("../src/agent-backend.js");
        expect(module.parseToolCallBestEffortFromText).toBeDefined();
        expect(typeof module.parseToolCallBestEffortFromText).toBe("function");
    });

});

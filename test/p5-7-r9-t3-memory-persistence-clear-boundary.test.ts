/**
 * msgcode: P5.7-R9-T3 记忆持久化与 /clear 边界回归锁
 *
 * 目标：
 * - 锁定重启续聊能力
 * - 锁定切模续聊能力
 * - 锁定 /clear 边界（只清短期，不清长期）
 * - 锁定提前摘要禁止（低于 70% 不摘要）
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ============================================
// 回归锁 1: 记忆默认开启
// ============================================

describe("P5.7-R9-T3: 记忆默认开启", () => {
    it("handlers.ts 应通过 assembleAgentContext 注入 windowMessages", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        expect(code).toContain('import { assembleAgentContext } from "./runtime/context-policy.js"');
        expect(code).toContain("const assembledContext = await assembleAgentContext({");
        expect(code).toContain("assembledContext.windowMessages");
    });

    it("handlers.ts 应通过 assembleAgentContext 注入 summaryContext", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        expect(code).toContain("assembledContext.summaryContext");
        expect(code).toContain("memoryInjected: assembledContext.windowMessages.length > 0 || !!assembledContext.summaryContext");
    });

    it("handlers.ts 应在请求后写回 window（TTS 路径也写回）", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：TTS 路径也必须写回
        expect(code).toContain("TTS 模式也必须写回会话窗口");
        expect(code).toContain("TTS 模式也必须写回线程");
    });
});

// ============================================
// 回归锁 2: /clear 边界（短期 vs 长期）
// ============================================

describe("P5.7-R9-T3: /clear 边界", () => {
    it("session-orchestrator.ts 应有 clearScope=short-term 日志字段", () => {
        const code = readFileSync(resolve(process.cwd(), "src/runtime/session-orchestrator.ts"), "utf-8");
        // 锁定：clear 日志必须包含 clearScope
        expect(code).toContain("clearScope");
        expect(code).toContain("short-term");
    });

    it("session-orchestrator.ts 应明确列出 clearedItems", () => {
        const code = readFileSync(resolve(process.cwd(), "src/runtime/session-orchestrator.ts"), "utf-8");
        // 锁定：明确列出清理项
        expect(code).toContain("clearedItems");
        expect(code).toContain("window");
        expect(code).toContain("summary");
    });

    it("session-orchestrator.ts 应明确列出 preservedItems（memory 不清）", () => {
        const code = readFileSync(resolve(process.cwd(), "src/runtime/session-orchestrator.ts"), "utf-8");
        // 锁定：明确列出保留项
        expect(code).toContain("preservedItems");
        expect(code).toContain("memory");
    });

    it("session-artifacts.ts 应只清理 window 和 summary", () => {
        const code = readFileSync(resolve(process.cwd(), "src/session-artifacts.ts"), "utf-8");
        // 锁定：只调用 clearWindow 和 clearSummary
        expect(code).toContain("clearWindow");
        expect(code).toContain("clearSummary");
        // 不应调用 clearMemory 或类似长期记忆清理
        expect(code).not.toContain("clearMemory");
    });
});

// ============================================
// 回归锁 3: 延迟摘要（70% 阈值）
// ============================================

describe("P5.7-R9-T3: 延迟摘要", () => {
    it("context-policy.ts 应在 70% 阈值触发 compact", () => {
        const code = readFileSync(resolve(process.cwd(), "src/runtime/context-policy.ts"), "utf-8");
        expect(code).toContain("export const CONTEXT_COMPACT_SOFT_THRESHOLD = 70");
        expect(code).toContain("contextUsagePct >= CONTEXT_COMPACT_SOFT_THRESHOLD");
    });

    it("context-policy.ts 应只在 compact 块内提取摘要并重写 summary/window", () => {
        const code = readFileSync(resolve(process.cwd(), "src/runtime/context-policy.ts"), "utf-8");
        expect(code).toContain("const trimResult = trimWindowWithResult(windowMessages, CONTEXT_COMPACT_KEEP_RECENT);");
        expect(code).toContain("const newSummary = extractSummary(trimResult.trimmed, windowMessages);");
        expect(code).toContain("await saveSummary(input.workspacePath, input.chatId, mergedSummary);");
        expect(code).toContain("await rewriteWindow(input.workspacePath, input.chatId, trimResult.messages);");
    });

    it("handlers.ts / context-policy.ts 应暴露 compact 原因", () => {
        const handlersCode = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        const policyCode = readFileSync(resolve(process.cwd(), "src/runtime/context-policy.ts"), "utf-8");
        expect(handlersCode).toContain("compactionReason: assembledContext.compactionReason");
        expect(policyCode).toContain("let compactionReason: string | undefined;");
        expect(policyCode).toContain("compactionReason");
    });
});

// ============================================
// 回归锁 4: 系统提示词文件化
// ============================================

describe("P5.7-R9-T3: 系统提示词文件化", () => {
    it("agent-backend/prompt.ts 应有默认系统提示词文件路径", () => {
        const code = readFileSync(resolve(process.cwd(), "src/agent-backend/prompt.ts"), "utf-8");
        expect(code).toContain("DEFAULT_SYSTEM_PROMPT_FILE");
    });

    it("agent-backend/prompt.ts 应包含完整路径定义", () => {
        const code = readFileSync(resolve(process.cwd(), "src/agent-backend/prompt.ts"), "utf-8");
        // 路径应锚定仓库源码位置，而不是 process.cwd()
        expect(code).toContain("fileURLToPath(import.meta.url)");
        expect(code).toContain('"prompts"');
        expect(code).toContain('"agents-prompt.md"');
        expect(code).not.toContain('path.resolve(process.cwd(), "prompts", "agents-prompt.md")');
    });

    it("agent-backend/prompt.ts 应仅支持 AGENT_SYSTEM_PROMPT_FILE 环境变量覆盖", () => {
        const configCode = readFileSync(resolve(process.cwd(), "src/config.ts"), "utf-8");
        // 锁定：仅 AGENT_*，无 LMSTUDIO 兼容回退
        expect(configCode).toContain("AGENT_SYSTEM_PROMPT_FILE");
        expect(configCode).not.toContain("LMSTUDIO_SYSTEM_PROMPT_FILE");
    });

    it("agent-backend/prompt.ts 应有 resolveBaseSystemPrompt 函数", () => {
        const code = readFileSync(resolve(process.cwd(), "src/agent-backend/prompt.ts"), "utf-8");
        // 锁定：加载入口函数
        expect(code).toContain("async function resolveBaseSystemPrompt");
    });
});

// ============================================
// 回归锁 5: 会话持久化（重启/切模续聊）
// ============================================

describe("P5.7-R9-T3: 会话持久化", () => {
    it("session-window.ts 应支持 loadWindow 从文件恢复", () => {
        const code = readFileSync(resolve(process.cwd(), "src/session-window.ts"), "utf-8");
        // 锁定：从文件加载窗口
        expect(code).toContain("export async function loadWindow");
        expect(code).toContain(".msgcode/sessions");
    });

    it("summary.ts 应支持 loadSummary 从文件恢复", () => {
        const code = readFileSync(resolve(process.cwd(), "src/summary.ts"), "utf-8");
        // 锁定：从文件加载摘要
        expect(code).toContain("export async function loadSummary");
        expect(code).toContain("summary.md");
    });

    it("统一入口应在有 workspacePath 时加载持久化上下文", () => {
        const handlersCode = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        const policyCode = readFileSync(resolve(process.cwd(), "src/runtime/context-policy.ts"), "utf-8");
        expect(handlersCode).toContain("workspacePath: context.projectDir");
        expect(handlersCode).toContain("const assembledContext = await assembleAgentContext({");
        expect(policyCode).toContain("windowMessages = await loadWindow(input.workspacePath, input.chatId);");
        expect(policyCode).toContain("summaryData = await loadSummary(input.workspacePath, input.chatId);");
    });
});

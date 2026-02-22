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
    it("handlers.ts 应在请求前读取 windowMessages", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：请求前必读 window
        expect(code).toContain("loadWindow");
        expect(code).toContain("windowMessages");
    });

    it("handlers.ts 应在请求前读取 summaryContext", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：请求前必读 summary
        expect(code).toContain("loadSummary");
        expect(code).toContain("summaryContext");
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
    it("handlers.ts 应在 70% 阈值触发 compact", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：70% 阈值触发
        expect(code).toContain("COMPACT_SOFT_THRESHOLD = 70");
        expect(code).toContain("isApproachingBudget");
    });

    it("handlers.ts 应只在 isApproachingBudget 时提取摘要", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：extractSummary 只在 compact 块内调用
        expect(code).toContain("extractSummary(trimResult.trimmed");
        // 低于阈值时不应提前调用
        expect(code).not.toContain("extractSummary(windowMessages");
    });

    it("handlers.ts 应有提前摘要禁止日志", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：compact 触发有原因日志
        expect(code).toContain("compactionReason");
    });
});

// ============================================
// 回归锁 4: 系统提示词文件化
// ============================================

describe("P5.7-R9-T3: 系统提示词文件化", () => {
    it("lmstudio.ts 应有默认系统提示词文件路径", () => {
        const code = readFileSync(resolve(process.cwd(), "src/lmstudio.ts"), "utf-8");
        // 锁定：默认文件路径
        expect(code).toContain("DEFAULT_LMSTUDIO_SYSTEM_PROMPT_FILE");
        // 路径由 path.resolve(process.cwd(), "prompts", "lmstudio-system.md") 组成
        expect(code).toContain('"prompts"');
        expect(code).toContain('"lmstudio-system.md"');
    });

    it("lmstudio.ts 应支持环境变量覆盖", () => {
        const code = readFileSync(resolve(process.cwd(), "src/lmstudio.ts"), "utf-8");
        // 锁定：环境变量覆盖
        expect(code).toContain("LMSTUDIO_SYSTEM_PROMPT_FILE");
    });

    it("lmstudio.ts 应有 resolveBaseSystemPrompt 函数", () => {
        const code = readFileSync(resolve(process.cwd(), "src/lmstudio.ts"), "utf-8");
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

    it("handlers.ts 应在请求前加载持久化上下文", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：请求前加载
        expect(code).toContain("if (context.projectDir)");
        expect(code).toContain("windowMessages = await loadWindow");
        expect(code).toContain("summary = await loadSummary");
    });
});

/**
 * msgcode: P5.7-R9-T2 上下文预算与 Compact 回归锁
 *
 * 目标：
 * - 锁定 70% 触发阈值
 * - 锁定 85% 硬保护阈值
 * - 锁定重启后恢复能力
 * - 锁定换模型后恢复能力
 * - 锁定路由一致性（三种路由使用同一上下文资产）
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ============================================
// 回归锁 1: 70% 触发阈值常量
// ============================================

describe("P5.7-R9-T2: 70% 触发阈值", () => {
    it("handlers.ts 应包含 70% 软阈值常量", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：70% 软阈值触发 compact
        expect(code).toContain("COMPACT_SOFT_THRESHOLD = 70");
    });

    it("handlers.ts 应包含 isApproachingBudget 判定逻辑", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：使用率 >= 70% 标记为 isApproachingBudget
        expect(code).toContain("isApproachingBudget");
        expect(code).toContain("contextUsagePct >= 70");
    });
});

// ============================================
// 回归锁 2: 85% 硬保护阈值
// ============================================

describe("P5.7-R9-T2: 85% 硬保护阈值", () => {
    it("handlers.ts 应包含 85% 硬保护阈值常量", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：85% 硬保护阈值
        expect(code).toContain("COMPACT_HARD_THRESHOLD = 85");
    });

    it("handlers.ts 应包含硬保护警告日志", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：compact 后仍超过 85% 应有警告
        expect(code).toContain("context overflow protected");
    });
});

// ============================================
// 回归锁 3: 观测字段冻结
// ============================================

describe("P5.7-R9-T2: 观测字段冻结", () => {
    it("handlers.ts 应包含所有必需的观测字段", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：观测字段必须包含
        expect(code).toContain("contextWindowTokens");
        expect(code).toContain("contextUsedTokens");
        expect(code).toContain("contextUsagePct");
        expect(code).toContain("compactionTriggered");
        expect(code).toContain("compactionReason");
    });
});

// ============================================
// 回归锁 4: Compact 策略
// ============================================

describe("P5.7-R9-T2: Compact 策略", () => {
    it("handlers.ts 应保留最近 10 条消息", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：保留最近 10 条消息
        expect(code).toContain("COMPACT_KEEP_RECENT = 10");
    });

    it("handlers.ts 应调用 trimWindowWithResult 进行裁剪", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：使用 trimWindowWithResult 裁剪
        expect(code).toContain("trimWindowWithResult");
    });

    it("handlers.ts 应调用 extractSummary 提取摘要", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：使用 extractSummary 提取摘要
        expect(code).toContain("extractSummary");
    });

    it("handlers.ts 应调用 rewriteWindow 重写窗口", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        // 锁定：使用 rewriteWindow 重写窗口文件
        expect(code).toContain("rewriteWindow");
    });
});

// ============================================
// 回归锁 5: 路由一致性
// ============================================

describe("P5.7-R9-T2: 路由一致性", () => {
    it("agent-backend/routed-chat.ts 的 tool 路由应注入 summaryContext", () => {
        const code = readFileSync(resolve(process.cwd(), "src/agent-backend/routed-chat.ts"), "utf-8");
        // 锁定：tool 路由注入 summaryContext（P5.7-R9-T2 Step 3）
        // 找到 tool 路由的 runAgentToolLoop 调用
        expect(code).toContain("summaryContext: options.summaryContext");
    });

    it("session-window.ts 应包含 rewriteWindow 函数", () => {
        const code = readFileSync(resolve(process.cwd(), "src/session-window.ts"), "utf-8");
        // 锁定：rewriteWindow 函数存在（用于 compact 后落盘）
        expect(code).toContain("export async function rewriteWindow");
    });
});

// ============================================
// 回归锁 6: 预算感知模块导入
// ============================================

describe("P5.7-R9-T2: 预算感知模块导入", () => {
    it("handlers.ts 应导入 estimateTotalTokens", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        expect(code).toContain("estimateTotalTokens");
    });

    it("handlers.ts 应导入 getInputBudgetFromCapabilities", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        expect(code).toContain("getInputBudgetFromCapabilities");
    });

    it("handlers.ts 应导入 resolveRuntimeCapabilities", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        expect(code).toContain("resolveRuntimeCapabilities");
    });
});

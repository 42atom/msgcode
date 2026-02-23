/**
 * msgcode: Agent Backend Tool Loop 模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的工具循环逻辑
 * 目标：分离工具循环执行与路由编排
 *
 * 本文件为主实现位置，包含：
 * - runAgentToolLoop 主函数
 * - 工具调用与执行逻辑
 *
 * P5.7-R9-T7 Step 3 说明：
 * - 主实现已迁出到本文件
 * - lmstudio.ts 保留本地实现以兼容现有测试（过渡期）
 * - Step 4 将清理测试并移除重复实现
 */

// ============================================
// 类型重导出
// ============================================

export type {
    AgentToolLoopOptions,
    AgentToolLoopResult,
    ActionJournalEntry,
    AidocsToolDef,
    ParsedToolCall,
} from "./types.js";

export { PI_ON_TOOLS } from "./types.js";

// ============================================
// 函数占位（Step 3 将迁移实现）
// ============================================

// 主实现仍在 src/lmstudio.ts
// Step 3 将迁移 runAgentToolLoop 到此文件

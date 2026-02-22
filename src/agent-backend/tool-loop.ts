/**
 * msgcode: Agent Backend Tool Loop 模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的工具循环逻辑
 * 目标：分离工具循环执行与路由编排
 *
 * 约束：
 * - 本文件为接口定义层
 * - 主实现迁移完成后，将包含 runAgentToolLoop 实现
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

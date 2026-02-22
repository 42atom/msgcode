/**
 * msgcode: Agent Backend Routed Chat 模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的路由聊天逻辑
 * 目标：分离路由编排与执行逻辑
 *
 * 约束：
 * - 本文件为接口定义层
 * - 主实现迁移完成后，将包含 runAgentRoutedChat 实现
 */

// ============================================
// 类型重导出
// ============================================

export type {
    AgentRoutedChatOptions,
    AgentRoutedChatResult,
} from "./types.js";

// ============================================
// 函数占位（Step 3 将迁移实现）
// ============================================

// 主实现仍在 src/lmstudio.ts
// Step 3 将迁移 runAgentRoutedChat 到此文件

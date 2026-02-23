/**
 * msgcode: Agent Backend Routed Chat 模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的路由聊天逻辑
 * 目标：分离路由编排与执行逻辑
 *
 * 本文件为主实现位置，包含：
 * - runAgentRoutedChat 主函数
 * - 路由分类与分发逻辑
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
    AgentRoutedChatOptions,
    AgentRoutedChatResult,
} from "./types.js";

// ============================================
// 函数占位（Step 3 将迁移实现）
// ============================================

// 主实现仍在 src/lmstudio.ts
// Step 3 将迁移 runAgentRoutedChat 到此文件

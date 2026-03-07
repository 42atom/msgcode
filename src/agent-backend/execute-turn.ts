/**
 * msgcode: Agent Backend 唯一执行入口
 *
 * 目的：
 * - 给所有调用方提供统一的 agent turn 入口
 * - 收口 handlers、task-supervisor 等上层模块的直接实现依赖
 *
 * 注意：
 * - 本文件不新增业务分支，只转发到 routed-chat 主实现
 * - 上层只依赖 executeAgentTurn，避免继续长出平行入口
 */

import type {
    AgentRoutedChatOptions,
    AgentRoutedChatResult,
} from "./types.js";
import { runAgentRoutedChat } from "./routed-chat.js";

export async function executeAgentTurn(
    options: AgentRoutedChatOptions
): Promise<AgentRoutedChatResult> {
    return runAgentRoutedChat(options);
}

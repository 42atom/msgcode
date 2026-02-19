/**
 * msgcode: 记忆域命令（cursor/reset-cursor/mem）
 */

import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

export async function handleCursorCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { loadState } = await import("../state/store.js");
  const state = loadState();
  const chatState = state.chats[options.chatId];

  if (!chatState) {
    return {
      success: true,
      message: `当前群组无游标记录\n` +
        `\n` +
        `游标会在处理消息后自动建立`,
    };
  }

  const lastSeen = new Date(chatState.lastSeenAt);
  const timeAgo = Math.floor((Date.now() - lastSeen.getTime()) / 60000);

  return {
    success: true,
    message: `游标状态\n` +
      `\n` +
      `RowID: ${chatState.lastSeenRowid}\n` +
      `最后消息 ID: ${chatState.lastMessageId || "无"}\n` +
      `最后处理: ${timeAgo} 分钟前\n` +
      `累计消息: ${chatState.messageCount} 条`,
  };
}

export async function handleResetCursorCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { loadState, resetChatState } = await import("../state/store.js");
  const state = loadState();
  const chatState = state.chats[options.chatId];

  if (!chatState) {
    return {
      success: true,
      message: `当前群组无游标记录，无需重置`,
    };
  }

  const oldRowid = chatState.lastSeenRowid;
  resetChatState(options.chatId);

  return {
    success: true,
    message: `已重置游标\n` +
      `\n` +
      `旧 RowID: ${oldRowid}\n` +
      `新消息将从下一条开始处理`,
  };
}

export async function handleMemCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const { saveWorkspaceConfig, getMemoryInjectConfig } = await import("../config/workspace.js");

  const entry = getRouteByChatId(chatId);
  if (!entry || !entry.workspacePath) {
    return {
      success: false,
      message: `本群未绑定工作目录\n` +
        `\n` +
        `请先使用 /bind <dir> 绑定工作空间后使用记忆功能`,
    };
  }

  const projectDir = entry.workspacePath;
  const action = args[0] || "status";

  if (action === "status") {
    const memConfig = await getMemoryInjectConfig(projectDir);
    return {
      success: true,
      message: `记忆注入状态\n` +
        `\n` +
        `状态: ${memConfig.enabled ? "已启用" : "已禁用"}\n` +
        `工作目录: ${entry.label || projectDir}\n` +
        `检索条数: topK=${memConfig.topK}\n` +
        `最大字符: maxChars=${memConfig.maxChars}`,
    };
  }

  if (action === "on") {
    await saveWorkspaceConfig(projectDir, { "memory.inject.enabled": true });
    return {
      success: true,
      message: `记忆注入已启用\n` +
        `\n` +
        `工作目录: ${entry.label || projectDir}\n` +
        `\n` +
        `下次提问时会自动检索相关记忆并注入上下文`,
    };
  }

  if (action === "off") {
    await saveWorkspaceConfig(projectDir, { "memory.inject.enabled": false });
    return {
      success: true,
      message: `记忆注入已禁用\n` +
        `\n` +
        `工作目录: ${entry.label || projectDir}\n` +
        `\n` +
        `下次提问时将不会检索记忆`,
    };
  }

  if (action === "force") {
    return {
      success: true,
      message: `强制记忆注入已启用（本次有效）\n` +
        `\n` +
        `请在下一条消息中包含 --force-mem 标志\n` +
        `例如: 上次我们讨论了什么？ --force-mem\n` +
        `\n` +
        `这将强制检索记忆，忽略配置中的启用状态和触发关键词限制`,
    };
  }

  return {
    success: false,
    message: `未知操作: /mem ${action}\n` +
      `\n` +
      `可用操作: status, on, off, force\n` +
      `用法:\n` +
      `  /mem status  查看状态\n` +
      `  /mem on     启用注入\n` +
      `  /mem off    禁用注入\n` +
      `  /mem force  查看强制注入说明`,
  };
}

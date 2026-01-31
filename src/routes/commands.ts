/**
 * msgcode: 路由命令处理器
 *
 * 处理 /bind, /where, /unbind 命令
 * 这些命令在 listener.ts 早期截获，优先于其他所有命令
 */

import type { BotType, ModelClient } from "../router.js";
import {
  createRoute,
  getRouteByChatId,
  updateRouteStatus,
  getWorkspaceRootForDisplay,
  getActiveRoutes,
} from "./store.js";
import { getChatState } from "../state/store.js";

/**
 * E13: 有效的 ModelClient 列表
 */
const VALID_MODEL_CLIENTS: ModelClient[] = ["claude", "codex", "opencode"];

/**
 * E13: 检查是否为有效的 ModelClient
 */
function isValidModelClient(type: string): type is ModelClient {
  return VALID_MODEL_CLIENTS.includes(type as ModelClient);
}

/**
 * 默认 BotType（E13: 固定为 lmstudio）
 */
const DEFAULT_BOT_TYPE: BotType = "lmstudio";

// ============================================
// 类型定义
// ============================================

/**
 * 命令处理结果
 */
export interface CommandResult {
  /** 是否成功 */
  success: boolean;
  /** 返回给用户的消息 */
  message: string;
}

/**
 * 命令处理器选项
 */
export interface CommandHandlerOptions {
  /** Chat ID（完整 chatGuid 或归一化 chatId） */
  chatId: string;
  /** 命令参数 */
  args: string[];
}

// ============================================
// 辅助函数
// ============================================

/**
 * 生成建议的目录名（基于 chatGuid 后 8 位）
 */
function generateSuggestedDir(chatId: string): string {
  const normalized = chatId.split(";").pop() || chatId;
  return `workspace-${normalized.slice(-8)}`;
}

/**
 * 验证相对路径格式
 */
function isValidRelativePath(path: string): boolean {
  if (!path || path.trim().length === 0) {
    return false;
  }

  // 拒绝对对路径
  if (path.startsWith("/")) {
    return false;
  }

  // 拒绝包含特殊字符的路径
  if (path.includes("..") || path.includes("~")) {
    return false;
  }

  return true;
}

// ============================================
// 命令处理器
// ============================================

/**
 * 处理 /bind 命令
 *
 * 用法：
 * - /bind <dir> [botType] : 绑定到指定目录（相对路径），可选指定 botType
 * - /bind                  : 返回建议目录并要求确认
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleBindCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;

  // 无参数：返回建议目录
  if (args.length === 0) {
    const existing = getRouteByChatId(chatId);
    const suggested = existing ? existing.label || generateSuggestedDir(chatId) : generateSuggestedDir(chatId);
    const workspaceRoot = getWorkspaceRootForDisplay();

    return {
      success: true,
      message: `请输入要绑定的目录（相对路径）\n` +
        `例如: /bind acme/ops claude\n` +
        `\n` +
        `工作空间根目录: ${workspaceRoot}\n` +
        `建议目录: ${suggested}\n` +
        `可选模型客户端: ${VALID_MODEL_CLIENTS.join(", ")}\n` +
        `\n` +
        `绑定后将路由到: ${workspaceRoot}/${suggested}`,
    };
  }

  // 有参数：绑定到指定目录
  const relativePath = args[0];

  // 验证路径格式
  if (!isValidRelativePath(relativePath)) {
    const workspaceRoot = getWorkspaceRootForDisplay();
    return {
      success: false,
      message: `路径格式错误\n` +
        `\n` +
        `• 必须是相对路径（不能以 / 开头）\n` +
        `• 不能包含 .. 或 ~\n` +
        `• 必须在 ${workspaceRoot} 目录下\n` +
        `\n` +
        `正确示例: /bind acme/ops\n` +
        `错误示例: /bind /etc/passwd, /bind ../evil`,
    };
  }

  // E13: 可选：验证 modelClient
  let modelClient: ModelClient = "claude"; // 默认 claude
  if (args.length >= 2) {
    const requestedClient = args[1];
    if (!isValidModelClient(requestedClient)) {
      return {
        success: false,
        message: `无效的模型客户端: ${requestedClient}\n` +
          `\n` +
          `可用的客户端: ${VALID_MODEL_CLIENTS.join(", ")}`,
      };
    }
    modelClient = requestedClient;
  }

  try {
    // E13: 创建路由（使用 modelClient，botType 固定为 lmstudio）
    const entry = createRoute(chatId, relativePath, {
      label: relativePath,
      botType: DEFAULT_BOT_TYPE,
      modelClient,
    });

    return {
      success: true,
      message: `绑定成功\n` +
        `\n` +
        `工作目录: ${entry.workspacePath}\n` +
        `标签: ${entry.label}\n` +
        `模型客户端: ${entry.modelClient || "claude"}\n` +
        `\n` +
        `现在可以发送消息开始使用`,
    };
  } catch (error) {
    return {
      success: false,
      message: `绑定失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 /where 命令
 *
 * 回显当前群绑定的工作目录
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleWhereCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId } = options;

  const entry = getRouteByChatId(chatId);

  if (!entry) {
    return {
      success: true,
      message: `本群未绑定任何工作目录\n` +
        `\n` +
        `使用 /bind <dir> [client] 绑定工作空间\n` +
        `例如: /bind acme/ops claude`,
    };
  }

  if (entry.status !== "active") {
    return {
      success: true,
      message: `绑定已暂停\n` +
        `\n` +
        `工作目录: ${entry.workspacePath}\n` +
        `标签: ${entry.label}\n` +
        `状态: ${entry.status}\n` +
        `\n` +
        `使用 /bind 重新绑定或修改`,
    };
  }

  const formatTime = (iso: string): string => {
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return "未知";
    return new Date(ts).toLocaleString("zh-CN");
  };

  return {
    success: true,
    message: `当前绑定\n` +
      `\n` +
      `工作目录: ${entry.workspacePath}\n` +
      `标签: ${entry.label}\n` +
      `模型客户端: ${entry.modelClient || "claude"}\n` +
      `状态: ${entry.status}\n` +
      `绑定时间: ${formatTime(entry.createdAt)}\n` +
      `更新时间: ${formatTime(entry.updatedAt)}`,
  };
}

/**
 * 处理 /unbind 命令
 *
 * 解除绑定（将状态设为 archived）
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleUnbindCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId } = options;

  const entry = getRouteByChatId(chatId);

  if (!entry) {
    return {
      success: true,
      message: `本群未绑定任何工作目录\n` +
        `\n` +
        `使用 /bind <dir> 绑定工作空间`,
    };
  }

  try {
    // 将状态设为 archived（保留记录）
    updateRouteStatus(chatId, "archived");

    return {
      success: true,
      message: `解除绑定成功\n` +
        `\n` +
        `原工作目录: ${entry.workspacePath}\n` +
        `标签: ${entry.label}\n` +
        `\n` +
        `使用 /bind 重新绑定\n` +
        `工作目录不会被删除`,
    };
  } catch (error) {
    return {
      success: false,
      message: `解除绑定失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 /info 命令
 *
 * E14: 查看当前群的处理状态（只读）
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleInfoCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId } = options;

  const cursor = getChatState(chatId);

  if (!cursor) {
    return {
      success: true,
      message: `本群暂无处理记录\n` +
        `\n` +
        `首次启动或未处理过消息\n` +
        `记录会在处理第一条消息后自动创建`,
    };
  }

  const normalized = cursor.chatGuid.split(";").pop() || cursor.chatGuid;
  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  return {
    success: true,
    message: `群组处理状态\n` +
      `\n` +
      `群组: #${suffix}\n` +
      `已处理消息: ${cursor.messageCount} 条\n` +
      `最后处理: ${new Date(cursor.lastSeenAt).toLocaleString("zh-CN")}`,
  };
}

/**
 * E13: 处理 /model 命令
 *
 * 用法：
 * - /model              : 查看当前模型客户端
 * - /model <client>     : 切换到指定模型客户端
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleModelCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const { loadState, saveState } = await import("../state/store.js");

  const entry = getRouteByChatId(chatId);

  if (!entry) {
    return {
      success: false,
      message: `本群未绑定任何工作目录\n` +
        `\n` +
        `请先使用 /bind <dir> [client] 绑定工作空间`,
    };
  }

  // 无参数：查看当前模型客户端
  if (args.length === 0) {
    return {
      success: true,
      message: `当前模型客户端: ${entry.modelClient || "claude"}\n` +
        `\n` +
        `可用客户端: ${VALID_MODEL_CLIENTS.join(", ")}\n` +
        `\n` +
        `使用 /model <client> 切换客户端`,
    };
  }

  // 有参数：切换模型客户端
  const requestedClient = args[0];

  if (!isValidModelClient(requestedClient)) {
    return {
      success: false,
      message: `无效的模型客户端: ${requestedClient}\n` +
        `\n` +
        `可用的客户端: ${VALID_MODEL_CLIENTS.join(", ")}`,
    };
  }

  try {
    const { setRoute } = await import("./store.js");
    const updatedEntry: typeof entry = {
      ...entry,
      modelClient: requestedClient,
      updatedAt: new Date().toISOString(),
    };
    setRoute(entry.chatGuid, updatedEntry);

    return {
      success: true,
      message: `已切换模型客户端\n` +
        `\n` +
        `旧客户端: ${entry.modelClient || "claude"}\n` +
        `新客户端: ${requestedClient}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `切换失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 路由命令分发器
 *
 * 根据命令名分发到对应的处理器
 *
 * @param command 命令名（bind, where, unbind, chatlist, help）
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleRouteCommand(
  command: string,
  options: CommandHandlerOptions
): Promise<CommandResult> {
  switch (command) {
    case "bind":
      return handleBindCommand(options);
    case "where":
      return handleWhereCommand(options);
    case "unbind":
      return handleUnbindCommand(options);
    case "info":
      return handleInfoCommand(options);
    case "model":
      return handleModelCommand(options);
    case "chatlist":
      return handleChatlistCommand(options);
    case "cursor":
      return handleCursorCommand(options);
    case "resetCursor":
      return handleResetCursorCommand(options);
    case "help":
      return handleHelpCommand(options);
    default:
      return {
        success: false,
        message: `未知命令: /${command}\n` +
          `\n` +
          `可用命令: /bind, /where, /unbind, /info, /model, /chatlist, /cursor, /reset-cursor, /help`,
      };
  }
}

/**
 * 检查消息是否为路由命令
 *
 * @param text 消息文本
 * @returns 是否为路由命令
 */
export function isRouteCommand(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("/bind ") ||
    trimmed === "/bind" ||
    trimmed === "/where" ||
    trimmed === "/unbind" ||
    trimmed === "/info" ||
    trimmed.startsWith("/model ") ||
    trimmed === "/model" ||
    trimmed === "/chatlist" ||
    trimmed === "/cursor" ||
    trimmed === "/reset-cursor" ||
    trimmed.startsWith("/reset-cursor") ||
    trimmed === "/help"
  );
}

/**
 * 解析路由命令
 *
 * @param text 消息文本
 * @returns { command, args } 或 null
 */
export function parseRouteCommand(text: string): { command: string; args: string[] } | null {
  const trimmed = text.trim();

  if (trimmed.startsWith("/bind ")) {
    const parts = trimmed.split(/\s+/);
    return {
      command: "bind",
      args: parts.slice(1),
    };
  }

  if (trimmed === "/bind") {
    return { command: "bind", args: [] };
  }

  if (trimmed === "/where") {
    return { command: "where", args: [] };
  }

  if (trimmed === "/unbind") {
    return { command: "unbind", args: [] };
  }

  if (trimmed === "/info") {
    return { command: "info", args: [] };
  }

  if (trimmed.startsWith("/model ")) {
    const parts = trimmed.split(/\s+/);
    return {
      command: "model",
      args: parts.slice(1),
    };
  }

  if (trimmed === "/model") {
    return { command: "model", args: [] };
  }

  if (trimmed === "/chatlist") {
    return { command: "chatlist", args: [] };
  }

  if (trimmed === "/cursor") {
    return { command: "cursor", args: [] };
  }

  if (trimmed.startsWith("/reset-cursor")) {
    return { command: "resetCursor", args: [] };
  }

  if (trimmed === "/help") {
    return { command: "help", args: [] };
  }

  return null;
}

/**
 * 处理 /chatlist 命令
 *
 * 列出所有已绑定的群组和会话
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleChatlistCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const routes = getActiveRoutes();

  if (routes.length === 0) {
    return {
      success: true,
      message: `暂无已绑定的群组\n` +
        `\n` +
        `使用 /bind <dir> 绑定工作空间\n` +
        `例如: /bind acme/ops`,
    };
  }

  const sorted = routes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const lines: string[] = [`已绑定群组 (${routes.length})`];

  for (const route of sorted) {
    const normalized = route.chatGuid.split(";").pop() || route.chatGuid;
    const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;
    const label = route.label || route.chatGuid;
    lines.push(`${label} -> ${route.workspacePath} [${route.status}] (#${suffix})`);
  }

  return {
    success: true,
    message: lines.join("\n"),
  };
}

/**
 * 处理 /help 命令
 *
 * 显示帮助信息
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleHelpCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  return {
    success: true,
    message: `msgcode 2.0 命令帮助\n` +
      `\n` +
      `群组管理:\n` +
      `  /bind <dir> [client]  绑定群组到工作目录（相对路径）\n` +
      `  /where               查看当前群组绑定\n` +
      `  /unbind              解除当前群组绑定\n` +
      `  /model [client]      查看或切换模型客户端\n` +
      `  /info                查看处理状态\n` +
      `  /chatlist            列出所有已绑定的群组\n` +
      `\n` +
      `会话管理:\n` +
      `  /help                显示命令帮助\n` +
      `  /start               启动 Claude 会话\n` +
      `  /stop                停止 Claude 会话\n` +
      `  /status              查看会话状态\n` +
      `  /snapshot            获取终端输出快照\n` +
      `  /esc                 发送 ESC 中断\n` +
      `  /clear               清空会话上下文\n` +
      `\n` +
      `示例:\n` +
      `  /bind acme/ops claude   绑定到 $WORKSPACE_ROOT/acme/ops 并使用 claude\n` +
      `  /where                  查看当前绑定\n` +
      `  /model                  查看当前模型客户端\n` +
      `  /model opencode         切换到 opencode 客户端\n` +
      `  /info                   查看处理状态\n` +
      `  /chatlist               查看所有绑定\n` +
      `  /cursor                 查看游标状态\n` +
      `  /reset-cursor           重置游标`,
  };
}

/**
 * 处理 /cursor 命令
 *
 * 显示当前群组的游标状态
 */
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

/**
 * 处理 /reset-cursor 命令
 *
 * 重置当前群组的游标
 */
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

/**
 * msgcode: 管理域命令（bind/where/unbind）
 */

import type { BotType, ModelClient } from "../router.js";
import {
  createRoute,
  getRouteByChatId,
  getWorkspaceRootForDisplay,
  updateRouteStatus,
} from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

const VALID_MODEL_CLIENTS: ModelClient[] = ["claude", "codex", "opencode"];
const DEFAULT_BOT_TYPE: BotType = "lmstudio";

function isValidModelClient(type: string): type is ModelClient {
  return VALID_MODEL_CLIENTS.includes(type as ModelClient);
}

function generateSuggestedDir(chatId: string): string {
  const normalized = chatId.split(";").pop() || chatId;
  return `workspace-${normalized.slice(-8)}`;
}

function isValidRelativePath(path: string): boolean {
  if (!path || path.trim().length === 0) {
    return false;
  }
  if (path.startsWith("/")) {
    return false;
  }
  if (path.includes("..") || path.includes("~")) {
    return false;
  }
  return true;
}

export async function handleBindCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;

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

  const relativePath = args[0];

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

  let modelClient: ModelClient = "claude";
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
    const entry = createRoute(chatId, relativePath, {
      label: relativePath,
      botType: DEFAULT_BOT_TYPE,
      modelClient,
    });

    let displayModelClient = modelClient || "claude";
    try {
      const { getDefaultRunner } = await import("../config/workspace.js");
      const actualRunner = await getDefaultRunner(entry.workspacePath);
      displayModelClient = actualRunner;
    } catch {
    }

    return {
      success: true,
      message: `绑定成功\n` +
        `\n` +
        `工作目录: ${entry.workspacePath}\n` +
        `标签: ${entry.label}\n` +
        `模型客户端: ${displayModelClient}\n` +
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

  let displayModelClient = entry.modelClient || "claude";
  try {
    const { getDefaultRunner } = await import("../config/workspace.js");
    const actualRunner = await getDefaultRunner(entry.workspacePath);
    displayModelClient = actualRunner;
  } catch {
  }

  return {
    success: true,
    message: `当前绑定\n` +
      `\n` +
      `工作目录: ${entry.workspacePath}\n` +
      `标签: ${entry.label}\n` +
      `模型客户端: ${displayModelClient}\n` +
      `状态: ${entry.status}\n` +
      `绑定时间: ${formatTime(entry.createdAt)}\n` +
      `更新时间: ${formatTime(entry.updatedAt)}`,
  };
}

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

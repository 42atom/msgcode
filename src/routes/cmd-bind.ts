/**
 * msgcode: 管理域命令（bind/where/unbind）
 */

import path from "node:path";
import fs from "node:fs";
import type { BotType, ModelClient } from "../router.js";
import { config } from "../config.js";
import {
  createRoute,
  getRouteByChatId,
  getWorkspaceRootForDisplay,
  updateRouteStatus,
} from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";
import { getRuntimeKind, getTmuxClient } from "../config/workspace.js";

const VALID_MODEL_CLIENTS: ModelClient[] = ["claude", "codex", "opencode"];
const DEFAULT_BOT_TYPE: BotType = "agent-backend";

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

function normalizeGlobalAgentBackend(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value || value === "agent" || value === "agent-backend" || value === "lmstudio" || value === "local-openai") {
    return "agent-backend";
  }
  return value;
}

function formatAgentBackendLabel(provider: string): string {
  if (provider === "agent-backend") {
    return "agent-backend(local-openai/lmstudio)";
  }
  return provider;
}

async function resolveRuntimeDisplay(workspacePath: string): Promise<{
  runtimeLine: string;
  targetLine: string;
}> {
  try {
    const runtimeKind = await getRuntimeKind(workspacePath);
    if (runtimeKind === "tmux") {
      const client = await getTmuxClient(workspacePath);
      return {
        runtimeLine: "运行形态：tmux（透传执行臂）",
        targetLine: `Tmux Client: ${client}`,
      };
    }
  } catch {
    // ignore and fall through to agent default
  }

  const provider = formatAgentBackendLabel(normalizeGlobalAgentBackend(process.env.AGENT_BACKEND || ""));
  return {
    runtimeLine: "运行形态：agent（智能体编排）",
    targetLine: `Agent Backend: ${provider}`,
  };
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
    const runtimeDisplay = await resolveRuntimeDisplay(entry.workspacePath);

    return {
      success: true,
      message: `绑定成功\n` +
        `\n` +
        `工作目录: ${entry.workspacePath}\n` +
        `标签: ${entry.label}\n` +
        `${runtimeDisplay.runtimeLine}\n` +
        `${runtimeDisplay.targetLine}\n` +
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
    const workspaceRoot = getWorkspaceRootForDisplay();
    const defaultDir = (process.env.MSGCODE_DEFAULT_WORKSPACE_DIR || "").trim() || config.defaultWorkspaceDir || "default";
    const defaultPath = path.resolve(workspaceRoot, defaultDir);
    try {
      if (!fs.existsSync(defaultPath)) {
        fs.mkdirSync(defaultPath, { recursive: true });
      }
    } catch {
      // ignore
    }
    return {
      success: true,
      message: `本群未绑定任何工作目录（将使用默认工作目录）\n` +
        `\n` +
        `默认工作目录: ${defaultPath}\n` +
        `\n` +
        `使用 /bind <dir> [client] 绑定工作空间（覆盖默认）\n` +
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

  const runtimeDisplay = await resolveRuntimeDisplay(entry.workspacePath);

  return {
    success: true,
    message: `当前绑定\n` +
      `\n` +
      `工作目录: ${entry.workspacePath}\n` +
      `标签: ${entry.label}\n` +
      `${runtimeDisplay.runtimeLine}\n` +
      `${runtimeDisplay.targetLine}\n` +
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

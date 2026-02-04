/**
 * msgcode: 路由命令处理器
 *
 * 处理 /bind, /where, /unbind 命令
 * 这些命令在 listener.ts 早期截获，优先于其他所有命令
 */

import { routeByChatId } from "../router.js";
import type { BotType, ModelClient } from "../router.js";
import {
  createRoute,
  getRouteByChatId,
  updateRouteStatus,
  getWorkspaceRootForDisplay,
  getActiveRoutes,
} from "./store.js";
import { getChatState } from "../state/store.js";
import { join } from "node:path";

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
 * - /model              : 查看当前执行臂和策略模式
 * - /model <runner>     : 切换到指定执行臂
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleModelCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const {
    getPolicyMode,
    getDefaultRunner,
    setDefaultRunner,
  } = await import("../config/workspace.js");

  // 优先使用 RouteStore（动态绑定）；fallback 到 GROUP_* 静态配置（不破现网）
  const entry = getRouteByChatId(chatId);
  const fallback = !entry ? routeByChatId(chatId) : null;
  const projectDir = entry?.workspacePath || fallback?.projectDir;
  const label = entry?.label || fallback?.groupName;

  if (!projectDir) {
    return {
      success: false,
      message: `本群未绑定任何工作目录\n` +
        `\n` +
        `请先使用 /bind <dir> [client] 绑定工作空间`,
    };
  }

  // 无参数：查看当前执行臂和策略模式
  if (args.length === 0) {
    const currentMode = await getPolicyMode(projectDir);
    const currentRunner = await getDefaultRunner(projectDir);

    return {
      success: true,
      message: `执行臂配置\n` +
        `\n` +
        `策略模式: ${currentMode}\n` +
        `默认执行臂: ${currentRunner}\n` +
        `工作目录: ${label || projectDir}\n` +
        `\n` +
        `可用执行臂:\n` +
        `  lmstudio    本地模型（默认）\n` +
        `  codex       Codex CLI（需要 egress-allowed）\n` +
        `  claude-code Claude Code CLI（需要 egress-allowed）\n` +
        `\n` +
        `使用 /model <runner> 切换执行臂\n` +
        `使用 /policy <mode> 切换策略模式`,
    };
  }

  // 有参数：切换执行臂
  const requestedRunner = args[0] as "lmstudio" | "codex" | "claude-code";

  if (requestedRunner !== "lmstudio" && requestedRunner !== "codex" && requestedRunner !== "claude-code") {
    return {
      success: false,
      message: `无效的执行臂: ${requestedRunner}\n` +
        `\n` +
        `可用的执行臂:\n` +
        `  lmstudio    本地模型\n` +
        `  codex       Codex CLI\n` +
        `  claude-code Claude Code CLI`,
    };
  }

  try {
    // M5-1: 检查策略模式，local-only 时禁止 codex/claude-code
    const currentMode = await getPolicyMode(projectDir);
    const oldRunner = await getDefaultRunner(projectDir); // 切换前保存
    const result = await setDefaultRunner(projectDir, requestedRunner, currentMode);

    if (!result.success) {
      return {
        success: false,
        message: result.error || `切换失败`,
      };
    }

    return {
      success: true,
      message: `已切换执行臂\n` +
        `\n` +
        `旧执行臂: ${oldRunner}\n` +
        `新执行臂: ${requestedRunner}\n` +
        `\n` +
        `下次提问时将使用 ${requestedRunner}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `切换失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * M5-1: 处理 /policy 命令
 *
 * 用法：
 * - /policy            : 查看当前策略模式
 * - /policy <mode>     : 切换策略模式
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handlePolicyCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const { getPolicyMode, setPolicyMode } = await import("../config/workspace.js");

  // 优先使用 RouteStore（动态绑定）；fallback 到 GROUP_* 静态配置（不破现网）
  const entry = getRouteByChatId(chatId);
  const fallback = !entry ? routeByChatId(chatId) : null;
  const projectDir = entry?.workspacePath || fallback?.projectDir;
  const label = entry?.label || fallback?.groupName;

  if (!projectDir) {
    return {
      success: false,
      message: `本群未绑定工作目录\n` +
        `\n` +
        `请先使用 /bind <dir> 绑定工作空间`,
    };
  }

  // 无参数：查看当前策略模式
  if (args.length === 0) {
    const currentMode = await getPolicyMode(projectDir);

    return {
      success: true,
      message: `策略模式\n` +
        `\n` +
        `当前模式: ${currentMode}\n` +
        `工作目录: ${label || projectDir}\n` +
        `\n` +
        `可用模式:\n` +
        `  local-only      仅本地模式（禁止外网访问）\n` +
        `  egress-allowed 允许外网访问（可使用 codex/claude-code）\n` +
        `\n` +
        `使用 /policy <mode> 切换模式`,
    };
  }

  // 有参数：切换策略模式
  const requestedMode = args[0] as "local-only" | "egress-allowed";

  if (requestedMode !== "local-only" && requestedMode !== "egress-allowed") {
    return {
      success: false,
      message: `无效的策略模式: ${requestedMode}\n` +
        `\n` +
        `可用模式:\n` +
        `  local-only      仅本地模式\n` +
        `  egress-allowed 允许外网访问`,
    };
  }

  try {
    const oldMode = await getPolicyMode(projectDir);
    await setPolicyMode(projectDir, requestedMode);

    return {
      success: true,
      message: `已切换策略模式\n` +
        `\n` +
        `旧模式: ${oldMode}\n` +
        `新模式: ${requestedMode}\n` +
        `\n` +
        `${requestedMode === "egress-allowed"
          ? "现在可以使用 codex/claude-code 执行臂了"
          : "已禁止使用外网执行臂，只能使用本地模型"}`,
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
    case "mem":
      return handleMemCommand(options);
    case "policy":
      return handlePolicyCommand(options);
    // v2.2: Persona commands
    case "personaList":
      return handlePersonaListCommand(options);
    case "personaUse":
      return handlePersonaUseCommand(options);
    case "personaCurrent":
      return handlePersonaCurrentCommand(options);
    // v2.2: Schedule commands
    case "scheduleList":
      return handleScheduleListCommand(options);
    case "scheduleValidate":
      return handleScheduleValidateCommand(options);
    case "scheduleEnable":
      return handleScheduleEnableCommand(options);
    case "scheduleDisable":
      return handleScheduleDisableCommand(options);
    // v2.2: Reload command
    case "reload":
      return handleReloadCommand(options);
    default:
      return {
        success: false,
        message: `未知命令: /${command}\n` +
          `\n` +
          `可用命令: /bind, /where, /unbind, /info, /model, /chatlist, /mem, /cursor, /reset-cursor, /help, /persona, /schedule, /reload`,
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
    trimmed.startsWith("/mem ") ||
    trimmed === "/mem" ||
    trimmed.startsWith("/policy ") ||
    trimmed === "/policy" ||
    trimmed === "/help" ||
    // v2.2: Persona commands
    trimmed === "/persona" ||
    trimmed.startsWith("/persona ") ||
    trimmed === "/schedule" ||
    trimmed.startsWith("/schedule ") ||
    // v2.2: Reload command
    trimmed === "/reload"
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

  if (trimmed.startsWith("/mem ")) {
    const parts = trimmed.split(/\s+/);
    return {
      command: "mem",
      args: parts.slice(1),
    };
  }

  if (trimmed === "/mem") {
    return { command: "mem", args: [] };
  }

  if (trimmed.startsWith("/policy ")) {
    const parts = trimmed.split(/\s+/);
    return {
      command: "policy",
      args: parts.slice(1),
    };
  }

  if (trimmed === "/policy") {
    return { command: "policy", args: [] };
  }

  // v2.2: Persona commands
  if (trimmed === "/persona") {
    return { command: "personaList", args: [] };
  }

  if (trimmed.startsWith("/persona ")) {
    const parts = trimmed.split(/\s+/);
    const subCommand = parts[1]; // list, use, current
    if (subCommand === "list") {
      return { command: "personaList", args: [] };
    } else if (subCommand === "use") {
      return { command: "personaUse", args: parts.slice(2) };
    } else if (subCommand === "current") {
      return { command: "personaCurrent", args: [] };
    }
    // Invalid subcommand, return null to trigger error
    return { command: "personaList", args: [] };
  }

  // v2.2: Schedule commands
  if (trimmed === "/schedule") {
    return { command: "scheduleList", args: [] };
  }

  if (trimmed.startsWith("/schedule ")) {
    const parts = trimmed.split(/\s+/);
    const subCommand = parts[1]; // list, validate, enable, disable
    if (subCommand === "list") {
      return { command: "scheduleList", args: [] };
    } else if (subCommand === "validate") {
      return { command: "scheduleValidate", args: [] };
    } else if (subCommand === "enable") {
      return { command: "scheduleEnable", args: parts.slice(2) };
    } else if (subCommand === "disable") {
      return { command: "scheduleDisable", args: parts.slice(2) };
    }
    // Invalid subcommand, return null to trigger error
    return { command: "scheduleList", args: [] };
  }

  // v2.2: Reload command
  if (trimmed === "/reload") {
    return { command: "reload", args: [] };
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
  const entry = getRouteByChatId(options.chatId);
  const isLmStudioBot = entry?.botType === "lmstudio";

  return {
    success: true,
    message: `msgcode 2.2 命令帮助\n` +
      `\n` +
      `群组管理:\n` +
      `  /bind <dir> [client]  绑定群组到工作目录（相对路径）\n` +
      `  /where               查看当前群组绑定\n` +
      `  /unbind              解除当前群组绑定\n` +
      `  /model [runner]      查看或切换执行臂\n` +
      `  /policy [mode]       查看或切换策略模式\n` +
      `  /info                查看处理状态\n` +
      `  /chatlist            列出所有已绑定的群组\n` +
      `\n` +
      `编排层（v2.2）:\n` +
      `  /persona list        列出所有 personas\n` +
      `  /persona use <id>    切换到指定 persona\n` +
      `  /persona current     查看当前激活的 persona\n` +
      `  /schedule list       列出所有 schedules\n` +
      `  /schedule validate   验证所有 schedules\n` +
      `  /schedule enable <id>    启用指定 schedule\n` +
      `  /schedule disable <id>   禁用指定 schedule\n` +
      `  /reload              重新扫描加载配置\n` +
      `\n` +
      `记忆注入:\n` +
      `  /mem [status|on|off] 记忆注入控制\n` +
      `  /mem force            查看强制注入说明\n` +
      `  触发关键词: 上次, 记得, 复盘, 错误码, 命令, 之前, 历史\n` +
      `  强制检索: 消息中包含 --force-mem 标志\n` +
      `\n` +
      `会话管理:\n` +
      `  /help                显示命令帮助\n` +
      `  /start               启动 Claude 会话\n` +
      `  /stop                停止 Claude 会话\n` +
      `  /status              查看会话状态（秒回）\n` +
      `  /snapshot            获取终端输出快照\n` +
      `  /esc                 发送 ESC 中断\n` +
      `  /clear               清空会话上下文\n` +
      (isLmStudioBot
        ? `\n` +
          `语音（LM Studio Bot 专用）:\n` +
          `  /tts <text>          把文本生成语音附件并回发\n` +
          `  /voice <question>    先回答，再把回答转成语音附件回发\n` +
          `  /mode                查看语音回复模式\n` +
          `  /mode voice on|off|both|audio  设置语音模式\n` +
          `  /mode style <desc>   设置语音风格描述（VoiceDesign）\n` +
          `  /mode style-reset    清空语音风格（恢复默认）\n` +
          `\n` +
          `示例:\n` +
          `  /tts 那真是太好了！保持这种好心情。\n` +
          `  /voice 南京是哪里的城市？\n` +
          `  /mode voice on\n` +
          `  /mode style 温柔女声，语速稍慢\n`
        : ``) +
      `\n` +
      `示例:\n` +
      `  /bind acme/ops claude   绑定到 $WORKSPACE_ROOT/acme/ops\n` +
      `  /where                  查看当前绑定\n` +
      `  /model                  查看当前执行臂和策略模式\n` +
      `  /model codex            切换到 Codex 执行臂\n` +
      `  /policy egress-allowed  允许外网访问\n` +
      `  /info                   查看处理状态\n` +
      `  /chatlist               查看所有绑定\n` +
      `  /mem status             查看记忆注入状态\n` +
      `  /mem force              查看强制注入说明\n` +
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

/**
 * 处理 /mem 命令
 *
 * 用法：
 * - /mem status   - 查看当前记忆注入状态
 * - /mem on      - 启用当前群的记忆注入
 * - /mem off     - 禁用当前群的记忆注入
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleMemCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const { getRouteByChatId } = await import("./store.js");
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
    // 查看当前状态
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
    // 启用记忆注入
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
    // 禁用记忆注入
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
    // 临时强制注入（不改变配置）
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

  // 未知操作
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

// ============================================
// v2.2: Persona 命令
// ============================================

/**
 * 处理 /persona list 命令
 *
 * 列出所有可用的 personas
 */
export async function handlePersonaListCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { listPersonas } = await import("../config/personas.js");
  const { loadWorkspaceConfig } = await import("../config/workspace.js");
  const personas = await listPersonas(entry.workspacePath);

  if (personas.length === 0) {
    return {
      success: true,
      message: `当前工作区暂无 personas\n` +
        `\n` +
        `创建方法：在 ${entry.workspacePath}/.msgcode/personas/ 目录下创建 .md 文件\n` +
        `例如: echo "# Expert Coder\\n\\nYou are an expert..." > personas/coder.md`,
    };
  }

  // 读取当前激活的 persona
  const workspaceConfig = await loadWorkspaceConfig(entry.workspacePath);
  const activePersonaId = workspaceConfig["persona.active"];

  const lines: string[] = [`Personas (${personas.length})`];

  for (const persona of personas) {
    const isActive = persona.id === activePersonaId ? " [当前]" : "";
    lines.push(`${isActive ? "→ " : "  "}${persona.id}${isActive} - ${persona.name}`);
  }

  lines.push(`\n使用 /persona use <id> 切换 persona`);

  return {
    success: true,
    message: lines.join("\n"),
  };
}

/**
 * 处理 /persona use <id> 命令
 *
 * 设置当前激活的 persona
 */
export async function handlePersonaUseCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const personaId = options.args[0];

  if (!personaId) {
    return {
      success: false,
      message: `用法: /persona use <personaId>\n` +
        `\n` +
        `使用 /persona list 查看可用的 personas`,
    };
  }

  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { getPersona, setActivePersona } = await import("../config/personas.js");
  const persona = await getPersona(entry.workspacePath, personaId);

  if (!persona) {
    return {
      success: false,
      message: `Persona "${personaId}" 不存在\n` +
        `\n` +
        `使用 /persona list 查看可用的 personas`,
    };
  }

  // 保存到 workspace config
  await setActivePersona(entry.workspacePath, personaId);

  // 检查当前 runner，如果是 tmux runner (codex/claude) 需要提示 /clear
  let boundaryHint = "";
  try {
    const { getDefaultRunner } = await import("../config/workspace.js");
    const runner = await getDefaultRunner(entry.workspacePath);
    if (runner === "codex" || runner === "claude-code") {
      boundaryHint = `\n\n注意：Tmux runner 需要 /clear 后 persona 才能完全生效`;
    }
  } catch {
    // 忽略错误，使用默认提示
  }

  return {
    success: true,
    message: `已切换到 persona: ${personaId}\n` +
      `\n` +
      `${persona.name}\n` +
      boundaryHint,
  };
}

/**
 * 处理 /persona current 命令
 *
 * 显示当前激活的 persona
 */
export async function handlePersonaCurrentCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { getActivePersona } = await import("../config/personas.js");
  const { loadWorkspaceConfig } = await import("../config/workspace.js");
  const workspaceConfig = await loadWorkspaceConfig(entry.workspacePath);
  const activePersonaId = workspaceConfig["persona.active"];

  if (!activePersonaId) {
    return {
      success: true,
      message: `当前未使用自定义 persona\n` +
        `\n` +
        `使用 /persona list 查看可用的 personas\n` +
        `使用 /persona use <id> 切换 persona`,
    };
  }

  const persona = await getActivePersona(entry.workspacePath, activePersonaId);

  if (!persona) {
    return {
      success: false,
      message: `当前激活的 persona "${activePersonaId}" 不存在\n` +
        `\n` +
        `可能已被删除或移动\n` +
        `使用 /persona use 重新设置`,
    };
  }

  return {
    success: true,
    message: `当前 persona: ${persona.id}\n` +
      `\n` +
      `${persona.name}\n` +
      `\n` +
      `使用 /persona list 查看所有可用的 personas\n` +
      `使用 /persona use <id> 切换 persona`,
  };
}

// ============================================
// v2.2: Schedule 命令
// ============================================

/**
 * 处理 /schedule list 命令
 *
 * 列出所有 schedules
 */
export async function handleScheduleListCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { listSchedules } = await import("../config/schedules.js");
  const schedules = await listSchedules(entry.workspacePath);

  if (schedules.length === 0) {
    return {
      success: true,
      message: `当前工作区暂无 schedules\n` +
        `\n` +
        `创建方法：在 ${entry.workspacePath}/.msgcode/schedules/ 目录下创建 .json 文件\n` +
        `格式参考:\n` +
        `{\n` +
        `  "version": 1,\n` +
        `  "enabled": true,\n` +
        `  "tz": "Asia/Shanghai",\n` +
        `  "cron": "0 9 * * 1-5",\n` +
        `  "message": "工作日早上9点提醒",\n` +
        `  "delivery": { "mode": "reply-to-same-chat", "maxChars": 2000 }\n` +
        `}`,
    };
  }

  const lines: string[] = [`Schedules (${schedules.length})`];

  for (const schedule of schedules) {
    const status = schedule.enabled ? "✓" : "✗";
    lines.push(`${status} ${schedule.id} - ${schedule.cron} (${schedule.tz})`);
  }

  lines.push(`\n使用 /schedule validate 验证所有 schedules`);
  lines.push(`使用 /schedule enable <id> 启用 schedule`);
  lines.push(`使用 /schedule disable <id> 禁用 schedule`);

  return {
    success: true,
    message: lines.join("\n"),
  };
}

/**
 * 处理 /schedule validate 命令
 *
 * 验证所有 schedules
 */
export async function handleScheduleValidateCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { validateAllSchedules } = await import("../config/schedules.js");
  const results = await validateAllSchedules(entry.workspacePath);

  if (results.length === 0) {
    return {
      success: true,
      message: `当前工作区暂无 schedules`,
    };
  }

  const valid = results.filter(r => r.valid).length;
  const invalid = results.length - valid;

  const lines: string[] = [`Schedule 验证结果 (${valid}/${results.length} 有效)`];

  for (const result of results) {
    if (result.valid) {
      lines.push(`✓ ${result.id}`);
    } else {
      lines.push(`✗ ${result.id} - ${result.error}`);
    }
  }

  return {
    success: true,
    message: lines.join("\n"),
  };
}

/**
 * 处理 /schedule enable <id> 命令
 *
 * 启用指定的 schedule
 */
export async function handleScheduleEnableCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const scheduleId = options.args[0];

  if (!scheduleId) {
    return {
      success: false,
      message: `用法: /schedule enable <scheduleId>\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { setScheduleEnabled } = await import("../config/schedules.js");
  const success = await setScheduleEnabled(entry.workspacePath, scheduleId, true);

  if (!success) {
    return {
      success: false,
      message: `Schedule "${scheduleId}" 不存在\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  return {
    success: true,
    message: `已启用 schedule: ${scheduleId}\n` +
      `\n` +
      `提示: 修改后请使用 /reload 重新加载 schedules`,
  };
}

/**
 * 处理 /schedule disable <id> 命令
 *
 * 禁用指定的 schedule
 */
export async function handleScheduleDisableCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const scheduleId = options.args[0];

  if (!scheduleId) {
    return {
      success: false,
      message: `用法: /schedule disable <scheduleId>\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { setScheduleEnabled } = await import("../config/schedules.js");
  const success = await setScheduleEnabled(entry.workspacePath, scheduleId, false);

  if (!success) {
    return {
      success: false,
      message: `Schedule "${scheduleId}" 不存在\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  return {
    success: true,
    message: `已禁用 schedule: ${scheduleId}\n` +
      `\n` +
      `提示: 修改后请使用 /reload 重新加载 schedules`,
  };
}

// ============================================
// v2.2: Reload 命令
// ============================================

/**
 * 处理 /reload 命令
 *
 * 重新扫描并加载 personas/schedules/skills
 * 将启用的 schedules 映射到 jobs.json（scheduler 会在下次 tick 自动加载）
 */
export async function handleReloadCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const results: string[] = [];
  const { listPersonas } = await import("../config/personas.js");
  const { loadWorkspaceConfig } = await import("../config/workspace.js");
  const { listSchedules, validateAllSchedules, mapSchedulesToJobs } = await import("../config/schedules.js");
  const { createJobStore } = await import("../jobs/store.js");

  // 1. 扫描 personas
  const personas = await listPersonas(entry.workspacePath);
  const workspaceConfig = await loadWorkspaceConfig(entry.workspacePath);
  const activePersonaId = workspaceConfig["persona.active"];
  const activePersona = personas.find(p => p.id === activePersonaId);

  results.push(`Personas: ${personas.length} 个${activePersona ? ` (当前: ${activePersonaId})` : ""}`);

  // 2. 扫描并验证 schedules
  const schedules = await listSchedules(entry.workspacePath);
  const scheduleValidation = await validateAllSchedules(entry.workspacePath);
  const validSchedules = scheduleValidation.filter(r => r.valid).length;
  const enabledSchedules = schedules.filter(s => s.enabled).length;

  results.push(`Schedules: ${schedules.length} 个 (${enabledSchedules} 启用, ${validSchedules} 有效)`);

  if (validSchedules < schedules.length) {
    results.push(`  ⚠️ ${schedules.length - validSchedules} 个 schedule 验证失败`);
    results.push(`  使用 /schedule validate 查看详情`);
  }

  // 3. 映射 schedules 到 jobs 并保存
  const scheduleJobs = await mapSchedulesToJobs(entry.workspacePath, options.chatId);
  const store = createJobStore();
  const existingStore = store.loadJobs();

  if (existingStore) {
    // 合并策略：移除旧的 schedule jobs，添加新的，保留非-schedule jobs
    const nonScheduleJobs = existingStore.jobs.filter(j => !j.id.startsWith("schedule:"));
    const mergedJobs = [...nonScheduleJobs, ...scheduleJobs];
    store.saveJobs({ version: 1, jobs: mergedJobs });
    results.push(`Jobs: 已更新 ${scheduleJobs.length} 个 schedule jobs (共 ${mergedJobs.length} 个 jobs)`);
  } else {
    // 首次创建
    store.saveJobs({ version: 1, jobs: scheduleJobs });
    results.push(`Jobs: 已创建 ${scheduleJobs.length} 个 schedule jobs`);
  }

  // 4. Skills（全局扫描）
  // P0: 暂时只显示有效性，不做复杂加载
  const { existsSync } = await import("node:fs");
  const skillsDir = join(process.env.HOME || "", ".config", "msgcode", "skills");
  const skillsExist = existsSync(skillsDir);
  results.push(`Skills: ${skillsExist ? "已配置" : "未配置"} (~/.config/msgcode/skills/)`);

  results.push(`\n✓ 重新加载完成`);

  return {
    success: true,
    message: results.join("\n"),
  };
}

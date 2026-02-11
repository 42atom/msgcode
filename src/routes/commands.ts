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
import fs from "node:fs";
import os from "node:os";

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
// 群聊安全：owner 收口（写入 ~/.config/msgcode/.env）
// ============================================

function getUserEnvPath(): string {
  return join(os.homedir(), ".config", "msgcode", ".env");
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function upsertEnvLine(lines: string[], key: string, value: string): string[] {
  const prefix = `${key}=`;
  let replaced = false;
  const next = lines.map(line => {
    if (line.startsWith(prefix) && !replaced) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) next.push(`${key}=${value}`);
  return next;
}

function readEnvLines(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.split(/\r?\n/);
  } catch {
    return [];
  }
}

function writeEnvLines(filePath: string, lines: string[]): void {
  const dir = join(os.homedir(), ".config", "msgcode");
  fs.mkdirSync(dir, { recursive: true });
  const content = lines.join("\n").replace(/\n+$/, "\n");
  const tmp = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function readEnvValue(lines: string[], key: string): string | null {
  const prefix = `${key}=`;
  for (const line of lines) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return null;
}

function upsertCsvEnvValue(
  lines: string[],
  key: string,
  rawItem: string,
  kind: "email" | "phone"
): string[] {
  const current = readEnvValue(lines, key) ?? "";
  const items = splitCsv(current);

  const exists = items.some(existing => {
    if (kind === "email") {
      return existing.toLowerCase() === rawItem.toLowerCase();
    }
    const a = normalizePhone(existing);
    const b = normalizePhone(rawItem);
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
  });

  if (exists) return lines;

  const nextValue = items.length === 0 ? rawItem : `${items.join(",")},${rawItem}`;
  return upsertEnvLine(lines, key, nextValue);
}

function validateOwnerIdentifier(value: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: "owner 不能为空" };
  // 邮箱 or 电话（仅做弱校验）
  if (trimmed.includes("@")) return { ok: true };
  if (normalizePhone(trimmed).length >= 6) return { ok: true };
  return { ok: false, reason: "owner 格式不合法：请输入邮箱或电话号码（handle）" };
}

export async function handleOwnerCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { args } = options;
  const envPath = getUserEnvPath();

  // 查看当前状态
  if (args.length === 0) {
    const owner = process.env.MSGCODE_OWNER || "";
    const enabled = process.env.MSGCODE_OWNER_ONLY_IN_GROUP || "0";
    return {
      success: true,
      message: `owner 配置\n` +
        `\n` +
        `MSGCODE_OWNER_ONLY_IN_GROUP=${enabled}\n` +
        `MSGCODE_OWNER=${owner || "<未设置>"}\n` +
        `\n` +
        `配置文件: ${envPath}\n` +
        `\n` +
        `用法:\n` +
        `  /owner <你的邮箱或电话>\n` +
        `  /owner-only on|off|status\n` +
        `\n` +
        `修改后需要重启 msgcode 才会生效`,
    };
  }

  const requestedOwner = args[0] ?? "";
  const check = validateOwnerIdentifier(requestedOwner);
  if (!check.ok) {
    return { success: false, message: `设置失败: ${check.reason}` };
  }

  const owner = requestedOwner.trim();
  let lines = readEnvLines(envPath);
  lines = upsertEnvLine(lines, "MSGCODE_OWNER", owner);

  // 确保白名单包含 owner，避免“owner-only 打开后仍被白名单拦截”
  if (owner.includes("@")) {
    lines = upsertCsvEnvValue(lines, "MY_EMAIL", owner, "email");
  } else {
    lines = upsertCsvEnvValue(lines, "MY_PHONE", owner, "phone");
  }

  try {
    writeEnvLines(envPath, lines);
    return {
      success: true,
      message: `已写入 owner 配置\n` +
        `\n` +
        `MSGCODE_OWNER=${owner}\n` +
        `\n` +
        `下一步:\n` +
        `1) 重启 msgcode\n` +
        `2) 群里执行 /owner-only on（可选）\n` +
        `3) 再执行 /clear 清理会话`,
    };
  } catch (error) {
    return {
      success: false,
      message: `写入失败: ${error instanceof Error ? error.message : String(error)}\n` +
        `\n` +
        `请手动编辑: ${envPath}`,
    };
  }
}

export async function handleOwnerOnlyCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { args } = options;
  const envPath = getUserEnvPath();

  const raw = (args[0] ?? "status").trim().toLowerCase();
  const currentEnabled = process.env.MSGCODE_OWNER_ONLY_IN_GROUP || "0";
  const currentOwner = process.env.MSGCODE_OWNER || "";

  if (raw === "status") {
    return {
      success: true,
      message: `owner-only 状态\n` +
        `\n` +
        `MSGCODE_OWNER_ONLY_IN_GROUP=${currentEnabled}\n` +
        `MSGCODE_OWNER=${currentOwner || "<未设置>"}\n` +
        `\n` +
        `配置文件: ${envPath}`,
    };
  }

  const enable =
    raw === "on" || raw === "1" || raw === "true" || raw === "yes" || raw === "enable";
  const disable =
    raw === "off" || raw === "0" || raw === "false" || raw === "no" || raw === "disable";

  if (!enable && !disable) {
    return {
      success: false,
      message: `用法错误\n` +
        `\n` +
        `  /owner-only on\n` +
        `  /owner-only off\n` +
        `  /owner-only status`,
    };
  }

  // 启用时必须已配置 owner（避免把自己锁死）
  if (enable && !currentOwner) {
    // 允许“先写 env 再重启”的工作流：从文件里读取一次
    const fromFile = readEnvValue(readEnvLines(envPath), "MSGCODE_OWNER") ?? "";
    if (fromFile) {
      // 文件里已有 owner，允许继续写 owner-only 开关
    } else {
    return {
      success: false,
      message: `启用失败：未设置 MSGCODE_OWNER\n` +
        `\n` +
        `请先执行:\n` +
        `  /owner <你的邮箱或电话>`,
    };
    }
  }

  let lines = readEnvLines(envPath);
  lines = upsertEnvLine(lines, "MSGCODE_OWNER_ONLY_IN_GROUP", enable ? "1" : "0");

  try {
    writeEnvLines(envPath, lines);
    return {
      success: true,
      message: `已写入 owner-only 配置\n` +
        `\n` +
        `MSGCODE_OWNER_ONLY_IN_GROUP=${enable ? "1" : "0"}\n` +
        `\n` +
        `修改后需要重启 msgcode 才会生效`,
    };
  } catch (error) {
    return {
      success: false,
      message: `写入失败: ${error instanceof Error ? error.message : String(error)}\n` +
        `\n` +
        `请手动编辑: ${envPath}`,
    };
  }
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

    // P0: 显示实际的 runner（从 config.json 读取）
    let displayModelClient = modelClient || "claude";
    try {
      const { getDefaultRunner } = await import("../config/workspace.js");
      const actualRunner = await getDefaultRunner(entry.workspacePath);
      displayModelClient = actualRunner;
    } catch {
      // 读取失败，使用传入的 modelClient
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

  // P0: 显示实际的 runner（从 config.json 读取），而不是 modelClient
  // 这样确保显示与实际使用的客户端一致
  let displayModelClient = entry.modelClient || "claude";
  try {
    const { getDefaultRunner } = await import("../config/workspace.js");
    const actualRunner = await getDefaultRunner(entry.workspacePath);
    displayModelClient = actualRunner;
  } catch {
    // 读取失败，使用 modelClient
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

  function formatPolicyMode(mode: "local-only" | "egress-allowed"): string {
    if (mode === "egress-allowed") return `full（外网已开；raw=${mode}）`;
    return `limit（仅本地；raw=${mode}）`;
  }

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
        `策略模式: ${formatPolicyMode(currentMode)}\n` +
        `默认执行臂: ${currentRunner}\n` +
        `工作目录: ${label || projectDir}\n` +
        `\n` +
        `可用执行臂:\n` +
        `  lmstudio    本地模型（默认）\n` +
        `  mlx         MLX LM Server（工具闭环推荐）\n` +
        `  codex       Codex CLI（需要 egress-allowed）\n` +
        `  claude-code Claude Code CLI（需要 egress-allowed）\n` +
        `\n` +
        `计划中（planned）:\n` +
        `  llama       llama-server / llama.cpp（*.gguf）\n` +
        `  claude      Anthropic Claude API\n` +
        `  openai      OpenAI API（GPT-4, o1, etc.）\n` +
        `\n` +
        `使用 /model <runner> 切换执行臂\n` +
        `使用 /policy <mode> 切换策略模式`,
    };
  }

  // 有参数：切换执行臂
  const requestedRunner = args[0];

  // 校验：拒绝 planned 执行臂
  const plannedRunners = ["llama", "claude", "openai"];
  const validRunners = ["lmstudio", "mlx", "codex", "claude-code"];

  if (plannedRunners.includes(requestedRunner)) {
    return {
      success: false,
      message: `"${requestedRunner}" 执行臂尚未实现。\n` +
        `\n` +
        `计划中的执行臂:\n` +
        `  llama       llama-server / llama.cpp（*.gguf）\n` +
        `  claude      Anthropic Claude API\n` +
        `  openai      OpenAI API（GPT-4, o1, etc.）\n` +
        `\n` +
        `目前可用的执行臂:\n` +
        `  lmstudio    本地模型\n` +
        `  mlx         MLX LM Server（工具闭环推荐）\n` +
        `  codex       Codex CLI\n` +
        `  claude-code Claude Code CLI`,
    };
  }

  if (!validRunners.includes(requestedRunner)) {
    return {
      success: false,
      message: `无效的执行臂: ${requestedRunner}\n` +
        `\n` +
        `可用的执行臂:\n` +
        `  lmstudio    本地模型\n` +
        `  mlx         MLX LM Server（工具闭环推荐）\n` +
        `  codex       Codex CLI\n` +
        `  claude-code Claude Code CLI`,
    };
  }

  try {
    // M5-1: 检查策略模式，local-only 时禁止 codex/claude-code
    const currentMode = await getPolicyMode(projectDir);
    const oldRunner = await getDefaultRunner(projectDir); // 切换前保存
    // 类型收窄：requestedRunner 已经过上面的校验，确保是有效值
    const result = await setDefaultRunner(
      projectDir,
      requestedRunner as "lmstudio" | "mlx" | "codex" | "claude-code",
      currentMode
    );

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

  function describePolicyMode(mode: "local-only" | "egress-allowed"): { short: "limit" | "full"; label: string; raw: string } {
    if (mode === "egress-allowed") {
      return { short: "full", label: "外网已开", raw: mode };
    }
    return { short: "limit", label: "仅本地", raw: mode };
  }

  function normalizePolicyMode(input: string): "local-only" | "egress-allowed" | null {
    const v = input.trim().toLowerCase();
    if (["on", "full", "egress", "egress-allowed", "allow", "open"].includes(v)) {
      return "egress-allowed";
    }
    if (["off", "limit", "local", "local-only", "deny", "closed"].includes(v)) {
      return "local-only";
    }
    return null;
  }

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
    const current = describePolicyMode(currentMode);

    return {
      success: true,
      message: `策略模式\n` +
        `\n` +
        `当前: ${current.short}（${current.label}；raw=${current.raw}）\n` +
        `工作目录: ${label || projectDir}\n` +
        `\n` +
        `可用模式:\n` +
        `  full   外网已开（可使用 codex/claude-code；= egress-allowed）\n` +
        `  limit  仅本地（禁止外网访问；= local-only）\n` +
        `\n` +
        `用法:\n` +
        `  /policy full   开外网\n` +
        `  /policy limit  仅本地`,
    };
  }

  // 有参数：切换策略模式
  const requestedMode = normalizePolicyMode(args[0] ?? "");

  if (!requestedMode) {
    return {
      success: false,
      message: `无效的策略模式: ${args[0]}\n` +
        `\n` +
        `可用模式:\n` +
        `  on / egress-allowed   允许外网访问\n` +
        `  off / local-only      仅本地模式`,
    };
  }

  try {
    const oldMode = await getPolicyMode(projectDir);
    const oldDesc = describePolicyMode(oldMode);
    const newDesc = describePolicyMode(requestedMode);
    await setPolicyMode(projectDir, requestedMode);

    if (oldMode === requestedMode) {
      return {
        success: true,
        message: `策略模式未变更\n` +
          `\n` +
          `当前: ${newDesc.short}（${newDesc.label}；raw=${newDesc.raw}）`,
      };
    }

    return {
      success: true,
      message: `已切换策略模式\n` +
        `\n` +
        `旧模式: ${oldDesc.short}（${oldDesc.label}；raw=${oldDesc.raw}）\n` +
        `新模式: ${newDesc.short}（${newDesc.label}；raw=${newDesc.raw}）\n` +
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
    // 群聊 owner 收口
    case "owner":
      return handleOwnerCommand(options);
    case "ownerOnly":
      return handleOwnerOnlyCommand(options);
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
    // Tool Bus 统计与灰度
    case "toolstats":
      return handleToolstatsCommand(options);
    case "toolAllowList":
      return handleToolAllowListCommand(options);
    case "toolAllowAdd":
      return handleToolAllowAddCommand(options);
    case "toolAllowRemove":
      return handleToolAllowRemoveCommand(options);
    // v2.2: T6.2 Desktop commands
    case "desktop":
      return handleDesktopCommand(options);
    // Phase 4B: Steer/FollowUp commands
    case "steer":
      return handleSteerCommand(options);
    case "next":
      return handleNextCommand(options);
    default:
      return {
        success: false,
        message: `未知命令: /${command}\n` +
          `\n` +
          `可用命令: /bind, /where, /unbind, /info, /model, /policy, /owner, /owner-only, /chatlist, /mem, /cursor, /reset-cursor, /help, /persona, /schedule, /reload, /steer, /next`,
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
    trimmed.startsWith("/owner ") ||
    trimmed === "/owner" ||
    trimmed.startsWith("/owner-only ") ||
    trimmed === "/owner-only" ||
    trimmed === "/help" ||
    // v2.2: Persona commands
    trimmed === "/persona" ||
    trimmed.startsWith("/persona ") ||
    trimmed === "/schedule" ||
    trimmed.startsWith("/schedule ") ||
    // v2.2: Reload command
    trimmed === "/reload" ||
    // v2.2: Tool Bus commands
    trimmed === "/toolstats" ||
    trimmed.startsWith("/tool ") ||
    // v2.2: T6.2 Desktop commands
    // v1.0.1: 10 行版快捷语法
    trimmed === "/desktop" ||
    trimmed.startsWith("/desktop ") ||
    trimmed.startsWith("/desktop find ") ||
    trimmed.startsWith("/desktop click ") ||
    trimmed.startsWith("/desktop type ") ||
    trimmed.startsWith("/desktop hotkey ") ||
    trimmed.startsWith("/desktop wait ") ||
    // Phase 4B: Steer/FollowUp commands
    trimmed.startsWith("/steer ") ||
    trimmed === "/steer" ||
    trimmed.startsWith("/next ") ||
    trimmed === "/next"
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

  if (trimmed === "/owner") {
    return { command: "owner", args: [] };
  }

  if (trimmed.startsWith("/owner ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "owner", args: parts.slice(1) };
  }

  if (trimmed === "/owner-only") {
    return { command: "ownerOnly", args: [] };
  }

  if (trimmed.startsWith("/owner-only ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "ownerOnly", args: parts.slice(1) };
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

  // v2.2: Tool Bus commands
  if (trimmed === "/toolstats") {
    return { command: "toolstats", args: [] };
  }

  if (trimmed.startsWith("/tool ")) {
    const parts = trimmed.split(/\s+/);
    const subCommand = parts[1]; // allow
    if (subCommand === "allow") {
      const action = parts[2]; // list, add, remove
      if (action === "list") {
        return { command: "toolAllowList", args: [] };
      } else if (action === "add") {
        return { command: "toolAllowAdd", args: parts.slice(3) };
      } else if (action === "remove") {
        return { command: "toolAllowRemove", args: parts.slice(3) };
      }
    }
    // Invalid subcommand, default to list
    return { command: "toolAllowList", args: [] };
  }

  // v2.2: T6.2 Desktop commands + T8.4 RPC passthrough
  // v1.0.1: 10 行版快捷语法支持
  if (trimmed === "/desktop") {
    return { command: "desktop", args: ["doctor"] }; // 默认 doctor
  }

  if (trimmed.startsWith("/desktop ")) {
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[1];

    // ===== v1.0.1: 10 行版快捷语法 =====
    // /desktop observe
    // /desktop find {"byRole":"AXButton","titleContains":"...","limit":5}
    // /desktop click {"selector":{...},"confirm":{"token":"<token>"}}
    // /desktop type {"selector":{...},"text":"...","confirm":{"token":"<token>"}}
    // /desktop hotkey {"keys":["cmd","l"],"confirm":{"token":"<token>"}}
    // /desktop wait {"condition":{"selectorExists":{"selector":{...}}},"timeoutMs":30000}
    if (["observe", "find", "click", "type", "hotkey", "wait"].includes(subcommand)) {
      // 提取 JSON 参数部分（剩余所有部分）
      const jsonPart = trimmed.slice(trimmed.indexOf(subcommand) + subcommand.length).trim();
      return { command: "desktop", args: ["shortcut", subcommand, jsonPart] };
    }

    // T8.6.3: confirm 子命令需要特殊解析（method + 可选 timeout-ms + paramsJson）
    // 语法: /desktop confirm <method> [--timeout-ms <ms>] <paramsJson>
    // 例: /desktop confirm desktop.typeText {"text":"hello"}
    // 例: /desktop confirm desktop.typeText --timeout-ms 30000 {"text":"hello"}
    if (subcommand === "confirm") {
      const m = trimmed.match(/^\/desktop\s+confirm\s+(\S+)(?:\s+--timeout-ms\s+(\S+))?(?:\s+(.*))?$/);
      if (!m) return { command: "desktop", args: ["confirm"] };
      const method = m[1] ?? "";
      const timeoutMs = m[2] ?? "";
      const paramsJson = (m[3] ?? "").trim();
      return { command: "desktop", args: ["confirm", method, timeoutMs, paramsJson] };
    }

    // T8.4: rpc 子命令需要特殊解析（method + paramsJson）
    // T8.5: 支持 --timeout-ms <ms> 参数
    // T8.6.3: 支持 --confirm-token <token> 参数
    // 语法: /desktop rpc <method> [--timeout-ms <ms>] [--confirm-token <token>] <paramsJson>
    // 例: /desktop rpc desktop.find {"selector":{"byRole":"AXWindow"}}
    // 例: /desktop rpc desktop.waitUntil --timeout-ms 60000 {"condition":{...}}
    // 例: /desktop rpc desktop.typeText --confirm-token abc123 {"text":"hello"}
    if (subcommand === "rpc") {
      // 用正则一次性解析，提取 method、可选的 timeout-ms、可选的 confirm-token、paramsJson
      const m = trimmed.match(/^\/desktop\s+rpc\s+(\S+)(?:\s+--timeout-ms\s+(\S+))?(?:\s+--confirm-token\s+(\S+))?(?:\s+(.*))?$/);
      if (!m) return { command: "desktop", args: ["rpc"] };
      const method = m[1] ?? "";
      const timeoutMs = m[2] ?? "";
      const confirmToken = m[3] ?? "";
      const paramsJson = (m[4] ?? "").trim();
      return { command: "desktop", args: ["rpc", method, timeoutMs, confirmToken, paramsJson] };
    }

    if (["ping", "doctor"].includes(subcommand)) {
      return { command: "desktop", args: [subcommand] };
    }
    // 非法子命令，默认 doctor
    return { command: "desktop", args: ["doctor"] };
  }

  // Phase 4B: Steer command
  if (trimmed.startsWith("/steer ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "steer", args: parts.slice(1) };
  }

  if (trimmed === "/steer") {
    return { command: "steer", args: [] };
  }

  // Phase 4B: Next command
  if (trimmed.startsWith("/next ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "next", args: parts.slice(1) };
  }

  if (trimmed === "/next") {
    return { command: "next", args: [] };
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
      `  /policy [mode]       查看或切换策略模式（full/limit）\n` +
      `  /owner [id]          设置/查看群聊 owner（收口信任边界）\n` +
      `  /owner-only on|off   开关：群聊只允许 owner 触发执行\n` +
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
      `  /start               启动 tmux 会话（按 /model 选择执行臂）\n` +
      `  /stop                停止 tmux 会话\n` +
      `  /status              查看会话状态（秒回）\n` +
      `  /loglevel [level]    查看/设置日志级别（秒回；debug/info/warn/error/reset）\n` +
      `  /snapshot            获取终端输出快照\n` +
      `  /esc                 发送 ESC 中断\n` +
      `  /clear               清空会话上下文\n` +
      `\n` +
      `干预机制（Phase 4B）:\n` +
      `  /steer <msg>         紧急转向：当前工具执行后立即注入\n` +
      `  /next <msg>          轮后消息：当前轮完成后作为下一轮用户消息\n` +
      (isLmStudioBot
        ? `\n` +
          `语音（LM Studio Bot 专用）:\n` +
          `  /tts <text>          把文本生成语音附件并回发\n` +
          `  /voice <question>    先回答，再把回答转成语音附件回发\n` +
          `  /mode                查看语音回复模式\n` +
          `  /mode voice on|off|both|audio  设置语音模式\n` +
          `  /mode style <desc>   设置语气/情绪提示（用于 emoAuto；不走 IndexTTS emo_text）\n` +
          `  /mode style-reset    清空语气/情绪描述（恢复默认）\n` +
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
      `  /policy full            允许外网访问（= egress-allowed）\n` +
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

// ============================================
// Tool Bus 统计与灰度命令（P0）
// ============================================

/**
 * 处理 /toolstats 命令
 *
 * 显示工具执行统计（只读）
 */
export async function handleToolstatsCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { getToolStats } = await import("../tools/telemetry.js");

  // 默认窗口：最近 1 小时
  const windowMs = 3600000;
  const stats = getToolStats(windowMs);

  if (stats.totalCalls === 0) {
    return {
      success: true,
      message: `工具执行统计（最近 1 小时）\n` +
        `\n` +
        `暂无执行记录\n` +
        `\n` +
        `提示：执行 /tts 等工具命令后会产生统计数据`,
    };
  }

  const lines: string[] = [
    `工具执行统计（最近 1 小时）`,
    ``,
    `总调用: ${stats.totalCalls}`,
    `成功: ${stats.successCount} | 失败: ${stats.failureCount}`,
    `成功率: ${(stats.successRate * 100).toFixed(1)}%`,
    `平均耗时: ${stats.avgDurationMs.toFixed(0)}ms`,
    ``,
    `按工具:`,
  ];

  // 按工具分布
  for (const [tool, data] of Object.entries(stats.byTool)) {
    lines.push(`  ${tool}: ${data.calls} 次, ${(data.successRate * 100).toFixed(0)}% 成功, ${data.avgMs.toFixed(0)}ms 平均`);
  }

  // 调用源分布
  if (Object.keys(stats.bySource).length > 0) {
    lines.push(``);
    lines.push(`按调用源:`);
    for (const [source, count] of Object.entries(stats.bySource)) {
      lines.push(`  ${source}: ${count} 次`);
    }
  }

  // Top 错误码
  if (stats.topErrorCodes.length > 0) {
    lines.push(``);
    lines.push(`Top 错误码:`);
    for (const { code, count } of stats.topErrorCodes) {
      lines.push(`  ${code}: ${count} 次`);
    }
  }

  return {
    success: true,
    message: lines.join("\n"),
  };
}

/**
 * 处理 /tool allow list 命令
 *
 * 显示当前允许的工具列表
 */
export async function handleToolAllowListCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { getToolPolicy } = await import("../config/workspace.js");
  const policy = await getToolPolicy(entry.workspacePath);

  return {
    success: true,
    message: `工具灰度配置\n` +
      `\n` +
      `模式: ${policy.mode}\n` +
      `\n` +
      `允许的工具: ${policy.allow.join(", ") || "<无>"}\n` +
      `\n` +
      `需确认的工具: ${policy.requireConfirm.join(", ") || "<无>"}\n` +
      `\n` +
      `用法:\n` +
      `  /tool allow list      查看当前配置\n` +
      `  /tool allow add <t>   添加工具（需要 /reload 生效）\n` +
      `  /tool allow remove <t> 移除工具（需要 /reload 生效）\n` +
      `\n` +
      `可用工具: tts, asr, vision, mem, shell, browser, desktop`,
  };
}

/**
 * 处理 /tool allow add <tool> 命令
 *
 * 添加工具到允许列表
 */
export async function handleToolAllowAddCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const toolName = options.args[0];
  if (!toolName) {
    return {
      success: false,
      message: `用法: /tool allow add <tool>\n` +
        `\n` +
        `可用工具: tts, asr, vision, mem, shell, browser, desktop`,
    };
  }

  const validTools = ["tts", "asr", "vision", "mem", "shell", "browser", "desktop"];
  if (!validTools.includes(toolName)) {
    return {
      success: false,
      message: `无效工具: ${toolName}\n` +
        `\n` +
        `可用工具: ${validTools.join(", ")}`,
    };
  }

  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { getToolPolicy, setToolingAllow } = await import("../config/workspace.js");
  const policy = await getToolPolicy(entry.workspacePath);

  if (policy.allow.includes(toolName as any)) {
    return {
      success: true,
      message: `工具 ${toolName} 已在允许列表中\n` +
        `\n` +
        `当前允许: ${policy.allow.join(", ")}`,
    };
  }

  const newAllow = [...policy.allow, toolName];
  await setToolingAllow(entry.workspacePath, newAllow as any);

  return {
    success: true,
    message: `已添加工具到允许列表\n` +
      `\n` +
      `工具: ${toolName}\n` +
      `\n` +
      `执行 /reload 使配置生效`,
  };
}

/**
 * 处理 /tool allow remove <tool> 命令
 *
 * 从允许列表移除工具
 */
export async function handleToolAllowRemoveCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const toolName = options.args[0];
  if (!toolName) {
    return {
      success: false,
      message: `用法: /tool allow remove <tool>`,
    };
  }

  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { getToolPolicy, setToolingAllow } = await import("../config/workspace.js");
  const policy = await getToolPolicy(entry.workspacePath);

  if (!policy.allow.includes(toolName as any)) {
    return {
      success: true,
      message: `工具 ${toolName} 不在允许列表中\n` +
        `\n` +
        `当前允许: ${policy.allow.join(", ")}`,
    };
  }

  const newAllow = policy.allow.filter(t => t !== toolName);
  await setToolingAllow(entry.workspacePath, newAllow as any);

  return {
    success: true,
    message: `已从允许列表移除工具\n` +
      `\n` +
      `工具: ${toolName}\n` +
      `\n` +
      `执行 /reload 使配置生效`,
  };
}

// ============================================
// v2.2: T6.2 Desktop Commands
// ============================================

/**
 * 处理 /desktop 命令
 *
 * 用法（v1.0.1 10 行版）：
 * - /desktop observe              : 观察桌面
 * - /desktop find {...}            : 查找 UI 元素
 * - /desktop click {...}           : 点击元素（需 token）
 * - /desktop type {...}            : 输入文本（需 token）
 * - /desktop hotkey {...}           : 发送快捷键（需 token）
 * - /desktop wait {...}             : 等待条件
 * - /desktop confirm <method> {...}: 签发 token
 * - /desktop rpc <method> {...}     : RPC 透传
 * - /desktop ping /doctor           : 诊断
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleDesktopCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;

  // 检查是否已绑定 workspace
  const entry = getRouteByChatId(chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区\n` +
        `\n` +
        `请先使用 /bind <dir> 绑定工作空间`,
    };
  }

  // v1.0.1: 10 行版快捷语法处理
  if (args[0] === "shortcut") {
    const subcommand = args[1]; // find, click, type, hotkey, wait
    const jsonPart = args[2] || ""; // JSON 参数字符串

    // 解析 JSON 参数
    let params: Record<string, unknown>;
    try {
      params = jsonPart.trim() ? JSON.parse(jsonPart.trim()) : {};
    } catch {
      return {
        success: false,
        message: `无效的 JSON 参数: ${jsonPart}`,
      };
    }

    // 映射到 desktop tool subcommand
    const toolArgs: Record<string, unknown> = { subcommand };

    // 根据不同子命令映射参数
    if (subcommand === "find") {
      if (params.byRole) toolArgs.byRole = params.byRole;
      if (params.titleContains) toolArgs.titleContains = params.titleContains;
      if (params.valueContains) toolArgs.valueContains = params.valueContains;
      if (params.limit) toolArgs.limit = params.limit;
    } else if (subcommand === "click") {
      if (params.selector) toolArgs.selector = params.selector;
      if (params.byRole) toolArgs.byRole = params.byRole;
      if (params.titleContains) toolArgs.titleContains = params.titleContains;
      // v1.0.1: confirm token 支持
      const confirmObj = params.confirm;
      if (confirmObj && typeof confirmObj === "object" && "token" in confirmObj) {
        toolArgs.confirm = (confirmObj as { token: string }).token;
      } else {
        toolArgs.confirm = "CONFIRM"; // 默认需要确认
      }
    } else if (subcommand === "type") {
      if (params.text) toolArgs.text = params.text;
      if (params.selector) toolArgs.selector = params.selector;
      if (params.byRole) toolArgs.byRole = params.byRole;
      if (params.titleContains) toolArgs.titleContains = params.titleContains;
      // v1.0.1: confirm token 支持
      const confirmObj = params.confirm;
      if (confirmObj && typeof confirmObj === "object" && "token" in confirmObj) {
        toolArgs.confirm = (confirmObj as { token: string }).token;
      } else {
        toolArgs.confirm = "CONFIRM";
      }
    } else if (subcommand === "hotkey") {
      if (params.keys) {
        // keys 是数组，转换为 "cmd+l" 格式
        const keysArray = Array.isArray(params.keys) ? params.keys : [params.keys];
        toolArgs.keys = keysArray.join("+");
      }
      // v1.0.1: confirm token 支持
      const confirmObj = params.confirm;
      if (confirmObj && typeof confirmObj === "object" && "token" in confirmObj) {
        toolArgs.confirm = (confirmObj as { token: string }).token;
      } else {
        toolArgs.confirm = "CONFIRM";
      }
    } else if (subcommand === "wait") {
      if (params.condition) toolArgs.condition = params.condition;
      if (params.timeoutMs) toolArgs.timeoutMs = params.timeoutMs;
    }

    // 调用 desktop tool
    const { executeTool } = await import("../tools/bus.js");
    const { randomUUID } = await import("node:crypto");

    const requestId = randomUUID();
    const timeoutMs = subcommand === "wait" ? (params.timeoutMs ? Number(params.timeoutMs) : 30000) : 30000;

    const result = await executeTool("desktop", toolArgs, {
      workspacePath: entry.workspacePath,
      source: "slash-command",
      requestId,
      chatId: chatId,
      timeoutMs,
    });

    // 处理结果
    if (result.ok) {
      let message = result.data?.stdout || "执行成功（无输出）";
      // 尝试格式化 JSON
      try {
        const jsonObj = JSON.parse(message);
        if (jsonObj.result) {
          message = JSON.stringify(jsonObj, null, 2);
        }
      } catch {
        // 不是 JSON，直接回显
      }

      return {
        success: true,
        message,
      };
    } else {
      const error = result.error;
      const stderr = result.data?.stderr || "";
      const extraInfo = stderr ? `\n\nstderr:\n${stderr}` : "";

      return {
        success: false,
        message: `执行失败: ${error?.message || "未知错误"}${extraInfo}`,
      };
    }
  }

  // T8.6.3: confirm 子命令（签发 token）
  if (args[0] === "confirm") {
    const method = args[1]; // desktop.typeText
    const timeoutMsRaw = args[2]; // --timeout-ms 值或 undefined
    const paramsJsonRaw = args.slice(3).join(" "); // 剩余所有参数拼接成 JSON

    if (!method) {
      return {
        success: false,
        message: `用法: /desktop confirm <method> [--timeout-ms <ms>] <paramsJson>\n` +
          `\n` +
          `例: /desktop confirm desktop.typeText {"text":"hello"}\n` +
          `例: /desktop confirm desktop.typeText --timeout-ms 30000 {"text":"hello"}\n` +
          `\n` +
          `说明:\n` +
          `  签发一次性确认 token，用于后续 desktop 操作确认\n` +
          `  返回 token、expiresAt、以及可复制的下一步命令模板`,
      };
    }

    // 解析 paramsJson
    let intentParams: Record<string, unknown>;
    try {
      const paramsJson = paramsJsonRaw.trim();
      intentParams = paramsJson ? JSON.parse(paramsJson) : {};
    } catch {
      return {
        success: false,
        message: `无效的 JSON 参数: ${paramsJsonRaw}`,
      };
    }

    // 解析 timeoutMs
    let ttlMs = 60000; // 默认 60s
    if (timeoutMsRaw && timeoutMsRaw.startsWith("--timeout-ms")) {
      const msValue = timeoutMsRaw.split(/\s+/)[1] ?? "";
      if (!isNaN(Number(msValue))) {
        ttlMs = Number(msValue);
      }
    }

    // 调用 desktop.confirm.issue
    const { executeTool } = await import("../tools/bus.js");
    const { randomUUID } = await import("node:crypto");

    const requestId = randomUUID();
    const result = await executeTool("desktop", { method: "desktop.confirm.issue", params: {
      meta: {
        schemaVersion: 1,
        requestId,
        workspacePath: entry.workspacePath,
        timeoutMs: ttlMs,
      },
      intent: {
        method,
        params: intentParams,
      },
      ttlMs,
    } }, {
      workspacePath: entry.workspacePath,
      source: "slash-command",
      requestId,
      chatId: chatId,
      timeoutMs: ttlMs + 5000, // 给 issue 操作多一点缓冲时间
    });

    // 处理结果
    if (result.ok) {
      const dataAny = result.data as unknown as { stdout?: string } | undefined;
      let message = dataAny?.stdout || "";

      // 尝试解析 JSON
      try {
        const jsonObj = JSON.parse(message);
        if (jsonObj.result && jsonObj.result.token) {
          const token = jsonObj.result.token as string;
          const expiresAt = jsonObj.result.expiresAt as string;

          // 生成下一步命令模板（使用 --confirm-token 语法糖）
          const paramsJsonEscaped = JSON.stringify(intentParams);
          const templateCommand = `/desktop rpc ${method} --confirm-token ${token} ${paramsJsonEscaped}`;

          message = `Token 已签发\n` +
            `\n` +
            `token: ${token}\n` +
            `expiresAt: ${expiresAt}\n` +
            `\n` +
            `下一步命令（可直接复制）:\n` +
            `${templateCommand}\n` +
            `\n` +
            `说明:\n` +
            `  • Token 为一次性，使用后即失效\n` +
            `  • Token 绑定到当前 msgcode 进程的 XPC 连接\n` +
            `  • 请在 ${expiresAt} 前使用`;
        }
      } catch {
        // 不是 JSON，直接回显
      }

      return {
        success: true,
        message,
      };
    } else {
      const error = result.error;
      const dataAny = result.data as unknown as { stderr?: string } | undefined;
      const stderr = dataAny?.stderr || "";

      return {
        success: false,
        message: `Token 签发失败: ${error?.message || "未知错误"}\n\n${stderr}`,
      };
    }
  }

  // T8.4: rpc 子命令特殊处理
  // T8.5: 支持 --timeout-ms 参数（优先级高于 params.meta.timeoutMs）
  // T8.6.3: 支持 --confirm-token <token> 参数注入
  if (args[0] === "rpc") {
    const method = args[1]; // desktop.find
    const timeoutMsRaw = args[2] ?? ""; // --timeout-ms 参数值或空
    const confirmToken = args[3] ?? ""; // T8.6.3: --confirm-token 参数值或空
    const paramsJsonRaw = args[4] ?? ""; // {"selector":...}

    if (!method) {
      return {
        success: false,
        message: `用法: /desktop rpc <method> [--timeout-ms <ms>] [--confirm-token <token>] <paramsJson>\n` +
          `\n` +
          `例: /desktop rpc desktop.find {"selector":{"byRole":"AXWindow"}}\n` +
          `例: /desktop rpc desktop.waitUntil --timeout-ms 60000 {"condition":{"selectorExists":{"byRole":"AXButton"}}}\n` +
          `例: /desktop rpc desktop.typeText --confirm-token abc123 {"text":"hello"}`,
      };
    }

    // 解析 paramsJson
    let params: Record<string, unknown>;
    try {
      const paramsJson = paramsJsonRaw.trim();
      params = paramsJson ? JSON.parse(paramsJson) : {};
    } catch {
      return {
        success: false,
        message: `无效的 JSON 参数: ${paramsJsonRaw}`,
      };
    }

    // T8.6.3: 如果有 --confirm-token，自动注入 confirm.token
    if (confirmToken) {
      params.confirm = { token: confirmToken };
    }

    // T8.5: 解析 timeoutMs（优先级：命令行 > params.meta.timeoutMs > 默认 30s）
    let timeoutMs = 30000; // 默认 30s

    // 优先使用命令行的 --timeout-ms
    if (timeoutMsRaw && !isNaN(Number(timeoutMsRaw))) {
      timeoutMs = Number(timeoutMsRaw);
    }
    // 其次使用 params.meta.timeoutMs
    else if (params.meta && typeof params.meta === "object") {
      const metaTimeout = (params.meta as any).timeoutMs;
      if (typeof metaTimeout === "number") {
        timeoutMs = metaTimeout;
      }
    }

    // 调用 Tool Bus rpc 模式
    const { executeTool } = await import("../tools/bus.js");
    const { randomUUID } = await import("node:crypto");

    const requestId = randomUUID();
    const result = await executeTool("desktop", { method, params }, {
      workspacePath: entry.workspacePath,
      source: "slash-command",
      requestId,
      chatId: chatId,
      timeoutMs,
    });

    // 处理结果
    if (result.ok) {
      // desktop rpc 模式下 data 可能不是 {stdout,stderr}；优先回显 stdout，否则回显 JSON stringify(data)
      const dataAny = result.data as unknown as { stdout?: string } | undefined;
      let message = dataAny?.stdout || "";
      if (!message && result.data) {
        try {
          message = JSON.stringify(result.data, null, 2);
        } catch {
          message = String(result.data);
        }
      }
      if (!message) message = "执行成功（无输出）";

      // 尝试格式化 JSON
      try {
        const jsonObj = JSON.parse(message);
        if (jsonObj.result) {
          message = JSON.stringify(jsonObj, null, 2);
        }
      } catch {
        // 不是 JSON，直接回显
      }

      return {
        success: true,
        message,
      };
    } else {
      const error = result.error;
      const dataAny = result.data as unknown as { stderr?: string } | undefined;
      const stderr = dataAny?.stderr || "";
      const extraInfo = stderr ? `\n\nstderr:\n${stderr}` : "";

      return {
        success: false,
        message: `执行失败: ${error?.message || "未知错误"}${extraInfo}`,
      };
    }
  }

  // 原有子命令处理（ping/doctor/observe）
  const subcommand = args[0] || "doctor";
  const validSubcommands = ["ping", "doctor", "observe"];

  if (!validSubcommands.includes(subcommand)) {
    return {
      success: false,
      message: `无效的子命令: ${subcommand}\n` +
        `\n` +
        `用法:\n` +
        `  /desktop ping       检查 Desktop Bridge 状态\n` +
        `  /desktop doctor      诊断权限状态\n` +
        `  /desktop observe     观察桌面并落盘证据\n` +
        `  /desktop rpc <method> <paramsJson>  RPC 透传\n` +
        `\n` +
        `  /desktop             默认等价于 /desktop doctor`,
    };
  }

  // T6.2.1: observe 需要 60 秒超时（首跑权限/系统忙），ping/doctor 保持 30 秒
  const timeoutMs = subcommand === "observe" ? 60000 : 30000;

  // 调用 Tool Bus
  const { executeTool } = await import("../tools/bus.js");
  const { randomUUID } = await import("node:crypto");

  const result = await executeTool("desktop", { subcommand }, {
    workspacePath: entry.workspacePath,
    source: "slash-command",
    requestId: randomUUID(),
    chatId: chatId,
    timeoutMs,
  });

  // 处理结果
  if (result.ok) {
    // 成功：回显 stdout
    let message = result.data?.stdout || "执行成功（无输出）";

    // 如果是 JSON，尝试解析并格式化（轻量 pretty）
    try {
      const jsonObj = JSON.parse(message);
      if (jsonObj.result) {
        message = JSON.stringify(jsonObj, null, 2);
      }
    } catch {
      // 不是 JSON，直接回显
    }

    return {
      success: true,
      message,
    };
  } else {
    // 失败：回显 error.message + stderr
    const error = result.error;
    const stderr = result.data?.stderr || "";
    const extraInfo = stderr ? `\n\nstderr:\n${stderr}` : "";

    return {
      success: false,
      message: `执行失败: ${error?.message || "未知错误"}${extraInfo}`,
    };
  }
}

// ============================================
// Phase 4B: Steer/FollowUp Commands
// ============================================

/**
 * 处理 /steer <msg> 命令
 *
 * 紧急转向：当前工具执行后立即注入，跳过剩余工具
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleSteerCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const message = args.join(" ");

  if (!message) {
    return {
      success: false,
      message: `用法: /steer <message>\n` +
        `\n` +
        `紧急转向：当前工具执行完成后立即注入干预消息\n` +
        `跳过剩余的工具调用，直接进入总结阶段`,
    };
  }

  const { pushSteer } = await import("../steering-queue.js");
  const interventionId = pushSteer(chatId, message);

  return {
    success: true,
    message: `已添加紧急转向干预\n` +
      `\n` +
      `消息: ${message}\n` +
      `ID: ${interventionId.slice(0, 8)}\n` +
      `\n` +
      `干预将在当前工具执行后生效`,
  };
}

/**
 * 处理 /next <msg> 命令
 *
 * 轮后消息：当前轮完整结束后再处理
 *
 * @param options 命令选项
 * @returns 命令处理结果
 */
export async function handleNextCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const message = args.join(" ");

  if (!message) {
    return {
      success: false,
      message: `用法: /next <message>\n` +
        `\n` +
        `轮后消息：当前轮完成后自动作为下一轮用户消息`,
    };
  }

  const { pushFollowUp } = await import("../steering-queue.js");
  const interventionId = pushFollowUp(chatId, message);

  return {
    success: true,
    message: `已添加轮后消息\n` +
      `\n` +
      `消息: ${message}\n` +
      `ID: ${interventionId.slice(0, 8)}\n` +
      `\n` +
      `消息将在当前轮完成后自动处理`,
  };
}

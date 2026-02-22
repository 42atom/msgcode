/**
 * msgcode: 配置域命令（model/policy/pi）
 * P5.6.14-R4: /model 命令面兼容收口 - 基于 runtime.kind 二分
 */

import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { routeByChatId } from "../router.js";
import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";
import type { AgentProvider, ToolName } from "../config/workspace.js";

function getConfigDir(): string {
  return (process.env.MSGCODE_CONFIG_DIR || "").trim() || join(os.homedir(), ".config", "msgcode");
}

function getUserEnvPath(): string {
  return join(getConfigDir(), ".env");
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
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const content = lines.join("\n").replace(/\n+$/, "\n");
  const tmp = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function upsertEnvLine(lines: string[], key: string, value: string): string[] {
  const prefix = `${key}=`;
  let replaced = false;
  const next = lines.map((line) => {
    if (line.startsWith(prefix) && !replaced) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) next.push(`${key}=${value}`);
  return next;
}

export async function handleModelCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const {
    getPolicyMode,
    // P5.6.14-R4: 使用新配置 API
    getRuntimeKind,
    getTmuxClient,
    setTmuxClient,
    setRuntimeKind,
  } = await import("../config/workspace.js");

  function formatPolicyMode(mode: "local-only" | "egress-allowed"): string {
    if (mode === "egress-allowed") return `full（外网已开；raw=${mode}）`;
    return `limit（仅本地；raw=${mode}）`;
  }

  function normalizeRequestedProvider(input: string): AgentProvider | null {
    const v = input.trim().toLowerCase();
    if (!v) return null;
    if (v === "lmstudio" || v === "agent-backend" || v === "agent" || v === "local-openai") {
      return "agent-backend";
    }
    if (v === "openai") return "openai";
    if (v === "minimax") return "minimax";
    if (v === "llama") return "llama";
    if (v === "claude") return "claude";
    return null;
  }

  function formatProviderLabel(provider: AgentProvider | "none"): string {
    if (provider === "agent-backend" || provider === "lmstudio") {
      return "agent-backend(local-openai/lmstudio)";
    }
    return provider;
  }

  function getGlobalAgentProvider(): AgentProvider {
    const normalized = normalizeRequestedProvider(process.env.AGENT_BACKEND || "");
    if (
      normalized === "agent-backend" ||
      normalized === "openai" ||
      normalized === "minimax"
    ) {
      return normalized;
    }
    return "agent-backend";
  }

  function setGlobalAgentProvider(provider: AgentProvider): void {
    const envPath = getUserEnvPath();
    let lines = readEnvLines(envPath);
    lines = upsertEnvLine(lines, "AGENT_BACKEND", provider);
    writeEnvLines(envPath, lines);
    // 立即生效，无需重启
    process.env.AGENT_BACKEND = provider;
  }

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

  // P5.6.14-R4: 基于 runtime.kind 二分展示
  if (args.length === 0) {
    const currentMode = await getPolicyMode(projectDir);
    const kind = await getRuntimeKind(projectDir);
    const provider = getGlobalAgentProvider();
    const client = await getTmuxClient(projectDir);

    if (kind === "tmux") {
      // tmux 模式：显示 client 信息
      return {
        success: true,
        message: `执行臂配置（tmux 透传模式）\n` +
          `\n` +
          `运行形态：tmux（透传执行臂）\n` +
          `Tmux Client: ${client}\n` +
          `策略模式：${formatPolicyMode(currentMode)}\n` +
          `工作目录：${label || projectDir}\n` +
          `\n` +
          `说明：tmux 模式下 provider 不参与执行，仅透传到 tmux client\n` +
          `\n` +
          `可用 Tmux Client:\n` +
          `  codex       Codex CLI（默认）\n` +
          `  claude-code Claude Code CLI\n` +
          `\n` +
          `使用 /model <client> 切换 Tmux Client\n` +
          `使用 /policy <mode> 切换策略模式`,
      };
    } else {
      // agent 模式：显示 provider 信息
      return {
        success: true,
        message: `执行臂配置（agent 编排模式）\n` +
          `\n` +
          `运行形态：agent（智能体编排）\n` +
          `Agent Backend: ${formatProviderLabel(provider)}\n` +
          `配置源：${getUserEnvPath()}\n` +
          `策略模式：${formatPolicyMode(currentMode)}\n` +
          `工作目录：${label || projectDir}\n` +
          `\n` +
          `可用 Agent Backend:\n` +
          `  agent-backend  本地兼容后端（LM Studio/OpenAI-compatible，本地默认）\n` +
          `  minimax        MiniMax（OpenAI-compatible）\n` +
          `  openai         OpenAI API\n` +
          `\n` +
          `兼容别名（legacy）:\n` +
          `  lmstudio    -> agent-backend\n` +
          `  local-openai -> agent-backend\n` +
          `\n` +
          `计划中（planned）:\n` +
          `  llama       llama-server / llama.cpp\n` +
          `  claude      Anthropic Claude API\n` +
          `\n` +
          `使用 /model <backend> 切换 Agent Backend\n` +
          `使用 /model codex|claude-code 切换到 tmux 模式\n` +
          `使用 /policy <mode> 切换策略模式`,
      };
    }
  }

  // P5.6.14-R4: 处理设置命令
  const requestedRunner = args[0];

  // 兼容旧输入：codex/claude-code -> tmux 模式
  if (requestedRunner === "codex" || requestedRunner === "claude-code") {
    const currentMode = await getPolicyMode(projectDir);
    if (currentMode === "local-only") {
      return {
        success: false,
        message: `当前策略模式为 local-only，不允许使用 ${requestedRunner}（需要外网访问）。\n\n` +
          `请先执行以下命令之一：\n` +
          `1. /policy on             （允许外网访问；等同 /policy egress-allowed）\n` +
          `2. /model agent-backend   （使用本地模型）`,
      };
    }

    // P5.6.14-R4: 映射到 runtime.kind=tmux + tmux.client
    await setRuntimeKind(projectDir, "tmux");
    await setTmuxClient(projectDir, requestedRunner);

    const oldClient = await getTmuxClient(projectDir);
    return {
      success: true,
      message: `已切换到 tmux 模式\n` +
        `\n` +
        `运行形态：tmux（透传执行臂）\n` +
        `Tmux Client: ${requestedRunner}\n` +
        `\n` +
        `下次提问时将使用 ${requestedRunner}（tmux 透传）`,
    };
  }

  // agent backend 设置
  const normalizedProvider = normalizeRequestedProvider(requestedRunner);
  const plannedProviders: AgentProvider[] = ["llama", "claude"];

  if (normalizedProvider && plannedProviders.includes(normalizedProvider)) {
    return {
      success: false,
      message: `"${requestedRunner}" Backend 尚未实现。\n` +
        `\n` +
        `计划中的 Backend:\n` +
        `  llama       llama-server / llama.cpp\n` +
        `  claude      Anthropic Claude API\n` +
        `\n` +
        `目前可用的 Backend:\n` +
        `  agent-backend  本地兼容后端（默认）\n` +
        `  minimax        MiniMax（OpenAI-compatible）\n` +
        `  openai      OpenAI API`,
    };
  }

  if (!normalizedProvider) {
    return {
      success: false,
      message: `无效的 Backend: ${requestedRunner}\n` +
        `\n` +
        `可用的 Agent Backend:\n` +
        `  agent-backend  本地兼容后端（LM Studio）\n` +
        `  minimax        MiniMax（OpenAI-compatible）\n` +
        `  openai      OpenAI API\n` +
        `\n` +
        `兼容别名:\n` +
        `  lmstudio\n` +
        `  local-openai\n` +
        `\n` +
        `切换到 tmux 模式:\n` +
        `  /model codex       Codex CLI\n` +
        `  /model claude-code Claude Code CLI`,
    };
  }

  try {
    // 单源化：runtime.kind 仍按 workspace 管理，但 backend 只写全局 AGENT_BACKEND
    await setRuntimeKind(projectDir, "agent");
    setGlobalAgentProvider(normalizedProvider);

    const effectiveProvider = getGlobalAgentProvider();
    const effectiveLabel = formatProviderLabel(effectiveProvider);
    const aliasHint = normalizedProvider === "agent-backend" && requestedRunner !== "agent-backend"
      ? `（已按兼容别名映射为本地 backend）`
      : "";
    return {
      success: true,
      message: `已切换 Agent Backend${aliasHint}\n` +
        `\n` +
        `运行形态：agent（智能体编排）\n` +
        `Agent Backend: ${effectiveLabel}\n` +
        `作用域：global（${getUserEnvPath()}）\n` +
        `\n` +
        `下次提问时将使用 ${effectiveLabel}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `切换失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

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

  if (args.length === 0) {
    const currentMode = await getPolicyMode(projectDir);
    const current = describePolicyMode(currentMode);

    return {
      success: true,
      message: `策略模式\n` +
        `\n` +
        `当前：${current.short}（${current.label}；raw=${current.raw}）\n` +
        `工作目录：${label || projectDir}\n` +
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

  const requestedMode = normalizePolicyMode(args[0] ?? "");

  if (!requestedMode) {
    return {
      success: false,
      message: `无效的策略模式：${args[0]}\n` +
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
          `当前：${newDesc.short}（${newDesc.label}；raw=${newDesc.raw}）`,
      };
    }

    return {
      success: true,
      message: `已切换策略模式\n` +
        `\n` +
        `旧模式：${oldDesc.short}（${oldDesc.label}；raw=${oldDesc.raw}）\n` +
        `新模式：${newDesc.short}（${newDesc.label}；raw=${newDesc.raw}）\n` +
        `\n` +
        `${requestedMode === "egress-allowed"
          ? "现在可以使用 codex/claude-code 执行臂了"
          : "已禁止使用外网执行臂，只能使用本地模型"}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `切换失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function handlePiCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const { loadWorkspaceConfig, saveWorkspaceConfig, getRuntimeKind } = await import("../config/workspace.js");

  const entry = getRouteByChatId(chatId);
  const fallback = !entry ? routeByChatId(chatId) : null;
  const projectDir = entry?.workspacePath || fallback?.projectDir;

  if (!projectDir) {
    return {
      success: false,
      message: `未绑定工作目录，请先使用 /bind <dir> 绑定工作空间`,
    };
  }

  // P5.6.14-R4: 改用 runtime.kind 判断
  const kind = await getRuntimeKind(projectDir);
  const config = await loadWorkspaceConfig(projectDir);
  const enabled = config["pi.enabled"] ?? false;
  const action = (args[0] ?? "status").trim().toLowerCase();

  if (action === "status") {
    return {
      success: true,
      message: `PI: ${enabled ? "已启用" : "已禁用"}\n` +
        `运行形态：${kind}`,
    };
  }

  if (action === "on") {
    // P5.6.14-R4: tmux 模式不支持 PI
    if (kind === "tmux") {
      return {
        success: false,
        message: "PI 仅支持 agent 模式（需要上下文编排），当前为 tmux 透传模式",
      };
    }

    // P5.6.8-R4g: 自动添加 PI 四工具到 allow 列表
    const { getToolPolicy, setToolingAllow } = await import("../config/workspace.js");
    const policy = await getToolPolicy(projectDir);
    const piTools = ["read_file", "write_file", "edit_file", "bash"] as const;

    // 确保 PI 四工具在 allow 列表中
    const missingTools = piTools.filter(t => !policy.allow.includes(t));
    if (missingTools.length > 0) {
      const newAllow: ToolName[] = [...new Set([...policy.allow, ...piTools])];
      await setToolingAllow(projectDir, newAllow);
    }

    await saveWorkspaceConfig(projectDir, { "pi.enabled": true });
    return {
      success: true,
      message: "PI 已启用" + (missingTools.length > 0 ? `\n\n已自动添加工具：${missingTools.join(", ")}` : ""),
    };
  }

  if (action === "off") {
    await saveWorkspaceConfig(projectDir, { "pi.enabled": false });
    return {
      success: true,
      message: "PI 已禁用",
    };
  }

  return {
    success: false,
    message: `未知操作：${action}\n` +
      `用法：/pi | /pi on | /pi off`,
  };
}

/**
 * msgcode: 配置域命令（model/policy/pi）
 * P5.6.14-R4: /model 命令面兼容收口 - 基于 runtime.kind 二分
 */

import { routeByChatId } from "../router.js";
import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

export async function handleModelCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const {
    getPolicyMode,
    getDefaultRunner,
    setDefaultRunner,
    // P5.6.14-R4: 使用新配置 API
    getRuntimeKind,
    getAgentProvider,
    getTmuxClient,
    setAgentProvider,
    setTmuxClient,
    setRuntimeKind,
  } = await import("../config/workspace.js");

  function formatPolicyMode(mode: "local-only" | "egress-allowed"): string {
    if (mode === "egress-allowed") return `full（外网已开；raw=${mode}）`;
    return `limit（仅本地；raw=${mode}）`;
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
    const provider = await getAgentProvider(projectDir);
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
          `Agent Provider: ${provider}\n` +
          `策略模式：${formatPolicyMode(currentMode)}\n` +
          `工作目录：${label || projectDir}\n` +
          `\n` +
          `可用 Agent Provider:\n` +
          `  lmstudio    本地模型（默认）\n` +
          `  openai      OpenAI API\n` +
          `\n` +
          `计划中（planned）:\n` +
          `  minimax     MiniMax 模型\n` +
          `  llama       llama-server / llama.cpp\n` +
          `  claude      Anthropic Claude API\n` +
          `\n` +
          `使用 /model <provider> 切换 Agent Provider\n` +
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
          `2. /model lmstudio        （使用本地模型）`,
      };
    }

    // P5.6.14-R4: 映射到 tmux + client
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

  // agent provider 设置
  const validProviders = ["lmstudio", "openai"];
  const plannedProviders = ["minimax", "llama", "claude"];

  if (plannedProviders.includes(requestedRunner)) {
    return {
      success: false,
      message: `"${requestedRunner}" Provider 尚未实现。\n` +
        `\n` +
        `计划中的 Provider:\n` +
        `  minimax     MiniMax 模型\n` +
        `  llama       llama-server / llama.cpp\n` +
        `  claude      Anthropic Claude API\n` +
        `\n` +
        `目前可用的 Provider:\n` +
        `  lmstudio    本地模型（默认）\n` +
        `  openai      OpenAI API`,
    };
  }

  if (!validProviders.includes(requestedRunner)) {
    return {
      success: false,
      message: `无效的 Provider: ${requestedRunner}\n` +
        `\n` +
        `可用的 Agent Provider:\n` +
        `  lmstudio    本地模型\n` +
        `  openai      OpenAI API\n` +
        `\n` +
        `切换到 tmux 模式:\n` +
        `  /model codex       Codex CLI\n` +
        `  /model claude-code Claude Code CLI`,
    };
  }

  try {
    // P5.6.14-R4: 确保 runtime.kind=agent 后设置 provider
    await setRuntimeKind(projectDir, "agent");
    await setAgentProvider(projectDir, requestedRunner as any);

    const oldProvider = await getAgentProvider(projectDir);
    return {
      success: true,
      message: `已切换 Agent Provider\n` +
        `\n` +
        `运行形态：agent（智能体编排）\n` +
        `Agent Provider: ${requestedRunner}\n` +
        `\n` +
        `下次提问时将使用 ${requestedRunner}`,
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
    const missingTools = piTools.filter(t => !policy.allow.includes(t as any));
    if (missingTools.length > 0) {
      const newAllow = [...new Set([...policy.allow, ...piTools])] as any[];
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

/**
 * msgcode: 配置域命令（model/policy/pi）
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

  const requestedRunner = args[0];
  const plannedRunners = ["llama", "claude", "openai"];
  const validRunners = ["lmstudio", "codex", "claude-code"];

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
        `  codex       Codex CLI\n` +
        `  claude-code Claude Code CLI`,
    };
  }

  try {
    const currentMode = await getPolicyMode(projectDir);
    const oldRunner = await getDefaultRunner(projectDir);
    const result = await setDefaultRunner(
      projectDir,
      requestedRunner as "lmstudio" | "codex" | "claude-code",
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

export async function handlePiCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const { loadWorkspaceConfig, saveWorkspaceConfig, getDefaultRunner } = await import("../config/workspace.js");

  const entry = getRouteByChatId(chatId);
  const fallback = !entry ? routeByChatId(chatId) : null;
  const projectDir = entry?.workspacePath || fallback?.projectDir;

  if (!projectDir) {
    return {
      success: false,
      message: `未绑定工作目录，请先使用 /bind <dir> 绑定工作空间`,
    };
  }

  const runner = await getDefaultRunner(projectDir);
  const config = await loadWorkspaceConfig(projectDir);
  const enabled = config["pi.enabled"] ?? false;
  const action = (args[0] ?? "status").trim().toLowerCase();

  if (action === "status") {
    return {
      success: true,
      message: `PI: ${enabled ? "已启用" : "已禁用"}\n` +
        `执行臂: ${runner}`,
    };
  }

  if (action === "on") {
    if (runner === "codex" || runner === "claude-code") {
      return {
        success: false,
        message: "PI 仅支持本地执行臂（lmstudio）",
      };
    }

    await saveWorkspaceConfig(projectDir, { "pi.enabled": true });
    return {
      success: true,
      message: "PI 已启用",
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
    message: `未知操作: ${action}\n` +
      `用法: /pi | /pi on | /pi off`,
  };
}

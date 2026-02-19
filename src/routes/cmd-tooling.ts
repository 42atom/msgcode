/**
 * msgcode: 工具域命令（toolstats/tool allow）
 */

import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

export async function handleToolstatsCommand(_options: CommandHandlerOptions): Promise<CommandResult> {
  const { getToolStats } = await import("../tools/telemetry.js");
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

  for (const [tool, data] of Object.entries(stats.byTool)) {
    lines.push(`  ${tool}: ${data.calls} 次, ${(data.successRate * 100).toFixed(0)}% 成功, ${data.avgMs.toFixed(0)}ms 平均`);
  }

  if (Object.keys(stats.bySource).length > 0) {
    lines.push(``);
    lines.push(`按调用源:`);
    for (const [source, count] of Object.entries(stats.bySource)) {
      lines.push(`  ${source}: ${count} 次`);
    }
  }

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

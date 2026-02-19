/**
 * msgcode: SOUL 命令域（soul）
 */

import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

export async function handleSoulListCommand(_options: CommandHandlerOptions): Promise<CommandResult> {
  return {
    success: true,
    message: `Soul 命令已启用\n` +
      `\n` +
      `当前实现：最小收口（P5.4-R2-SOUL-Lock）\n` +
      `配置路径：~/.config/msgcode/souls/\n` +
      `\n` +
      `使用 /soul use <id> 切换 soul\n` +
      `使用 /soul current 查看当前 soul`,
  };
}

export async function handleSoulUseCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const soulId = options.args[0];

  if (!soulId) {
    return {
      success: false,
      message: `用法: /soul use <soulId>\n` +
        `\n` +
        `使用 /soul list 查看可用的 souls`,
    };
  }

  return {
    success: true,
    message: `Soul 切换功能开发中\n` +
      `\n` +
      `当前实现：最小收口（P5.4-R2-SOUL-Lock）\n` +
      `请求的 soul: ${soulId}\n` +
      `\n` +
      `配置路径：~/.config/msgcode/souls/`,
  };
}

export async function handleSoulCurrentCommand(_options: CommandHandlerOptions): Promise<CommandResult> {
  return {
    success: true,
    message: `当前 soul: default\n` +
      `\n` +
      `默认 Soul\n` +
      `\n` +
      `当前实现：最小收口（P5.4-R2-SOUL-Lock）\n` +
      `\n` +
      `使用 /soul list 查看所有可用的 souls\n` +
      `使用 /soul use <id> 切换 soul`,
  };
}

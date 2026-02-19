/**
 * msgcode: 干预域命令（steer/next）
 */

import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

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

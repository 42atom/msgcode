/**
 * msgcode: 桌面域命令（desktop）
 *
 * 只保留显式 RPC 主链，避免 slash 路由继续翻译桌面意图。
 */

import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";
import { resolveCommandRoute } from "./workspace-resolver.js";

export async function handleDesktopCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const subcommand = args[0];

  if (subcommand !== "rpc") {
    const extra = subcommand ? `\n\n已移除旧 desktop 子命令: ${subcommand}` : "";
    return {
      success: false,
      message: `用法: /desktop rpc <method> [--timeout-ms <ms>] [--confirm-token <token>] <paramsJson>` +
        `${extra}\n` +
        `\n` +
        `例: /desktop rpc desktop.health {}\n` +
        `例: /desktop rpc desktop.observe {"options":{"includeScreenshot":true}}\n` +
        `例: /desktop rpc desktop.click --confirm-token <token> {"selector":{"byRole":"AXButton"}}`,
    };
  }

  const entry = resolveCommandRoute(chatId)?.route;
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区\n` +
        `\n` +
        `请先使用 /bind <dir> 绑定工作空间`,
    };
  }

  const { handleDesktopRpc } = await import("./cmd-desktop-rpc.js");
  return handleDesktopRpc(options, entry);
}

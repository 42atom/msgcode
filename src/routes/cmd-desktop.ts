/**
 * msgcode: 桌面域命令（desktop）
 *
 * P5.6.5-R2d: 薄壳化重构
 * - 仅保留参数归一化 + 分发
 * - 业务实现拆分到 cmd-desktop-*.ts
 */

import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

export async function handleDesktopCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const entry = getRouteByChatId(chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区\n` +
        `\n` +
        `请先使用 /bind <dir> 绑定工作空间`,
    };
  }

  // R2d: 分发到子模块
  if (args[0] === "shortcut") {
    const { handleDesktopShortcut } = await import("./cmd-desktop-shortcut.js");
    return handleDesktopShortcut(options, entry);
  }

  if (args[0] === "confirm") {
    const { handleDesktopConfirm } = await import("./cmd-desktop-confirm.js");
    return handleDesktopConfirm(options, entry);
  }

  if (args[0] === "rpc") {
    const { handleDesktopRpc } = await import("./cmd-desktop-rpc.js");
    return handleDesktopRpc(options, entry);
  }

  // 其他子命令（ping, doctor, observe）
  const subcommand = args[0] || "doctor";
  const validSubcommands = ["ping", "doctor", "observe"];

  if (!validSubcommands.includes(subcommand)) {
    return {
      success: false,
      message: `无效的子命令: ${subcommand}\n` +
        `\n` +
        `可用子命令:\n` +
        `  shortcut  执行桌面操作（find/click/type/hotkey/wait）\n` +
        `  confirm   签发确认令牌\n` +
        `  rpc       直接调用桌面 RPC\n` +
        `  ping      测试桌面服务连接\n` +
        `  doctor    诊断桌面环境\n` +
        `  observe   观察桌面状态`,
    };
  }

  const { executeTool } = await import("../tools/bus.js");
  const { randomUUID } = await import("node:crypto");

  const requestId = randomUUID();
  const result = await executeTool("desktop", { method: `desktop.${subcommand}`, params: {} }, {
    workspacePath: entry.workspacePath,
    source: "slash-command",
    requestId,
    chatId: chatId,
    timeoutMs: 30000,
  });

  if (result.ok) {
    const data = result.data as { stdout?: string } | undefined;
    let message = data?.stdout || "执行成功（无输出）";
    try {
      const jsonObj = JSON.parse(message);
      if (jsonObj.result) {
        message = JSON.stringify(jsonObj, null, 2);
      }
    } catch {
    }

    return {
      success: true,
      message,
    };
  }

  const error = result.error;
  return {
    success: false,
    message: `执行失败: ${error?.message || "未知错误"}`,
  };
}

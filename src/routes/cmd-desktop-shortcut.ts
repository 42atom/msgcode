/**
 * msgcode: Desktop 域 - shortcut 子命令
 *
 * 处理 /desktop shortcut <subcommand> [json] 命令
 */

import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

/**
 * 处理 /desktop shortcut 子命令
 */
export async function handleDesktopShortcut(
  options: CommandHandlerOptions,
  entry: NonNullable<ReturnType<typeof getRouteByChatId>>
): Promise<CommandResult> {
  const { chatId, args } = options;
  const subcommand = args[1];
  const jsonPart = args[2] || "";

  let params: Record<string, unknown>;
  try {
    params = jsonPart.trim() ? JSON.parse(jsonPart.trim()) : {};
  } catch {
    return {
      success: false,
      message: `无效的 JSON 参数: ${jsonPart}`,
    };
  }

  const toolArgs: Record<string, unknown> = { subcommand };

  if (subcommand === "find") {
    if (params.byRole) toolArgs.byRole = params.byRole;
    if (params.titleContains) toolArgs.titleContains = params.titleContains;
    if (params.valueContains) toolArgs.valueContains = params.valueContains;
    if (params.limit) toolArgs.limit = params.limit;
  } else if (subcommand === "click") {
    if (!params.confirm || typeof params.confirm !== "object" || !("token" in params.confirm)) {
      return {
        success: false,
        message: `DESKTOP_CONFIRM_REQUIRED: /desktop click 必须提供 confirm.token\n` +
          `\n` +
          `用法: /desktop click {"selector":{...},"confirm":{"token":"<token>"}}\n` +
          `\n` +
          `获取 token: /desktop confirm desktop.click {"selector":{...}}`,
      };
    }
    if (params.selector) toolArgs.selector = params.selector;
    if (params.byRole) toolArgs.byRole = params.byRole;
    if (params.titleContains) toolArgs.titleContains = params.titleContains;
    toolArgs.confirm = (params.confirm as { token: string }).token;
  } else if (subcommand === "type") {
    if (!params.confirm || typeof params.confirm !== "object" || !("token" in params.confirm)) {
      return {
        success: false,
        message: `DESKTOP_CONFIRM_REQUIRED: /desktop type 必须提供 confirm.token\n` +
          `\n` +
          `用法: /desktop type {"selector":{...},"text":"...","confirm":{"token":"<token>"}}\n` +
          `\n` +
          `获取 token: /desktop confirm desktop.typeText {"selector":{...},"text":"..."}`,
      };
    }
    if (params.text) toolArgs.text = params.text;
    if (params.selector) toolArgs.selector = params.selector;
    if (params.byRole) toolArgs.byRole = params.byRole;
    if (params.titleContains) toolArgs.titleContains = params.titleContains;
    toolArgs.confirm = (params.confirm as { token: string }).token;
  } else if (subcommand === "hotkey") {
    if (!params.confirm || typeof params.confirm !== "object" || !("token" in params.confirm)) {
      return {
        success: false,
        message: `DESKTOP_CONFIRM_REQUIRED: /desktop hotkey 必须提供 confirm.token\n` +
          `\n` +
          `用法: /desktop hotkey {"keys":["cmd","l"],"confirm":{"token":"<token>"}}\n` +
          `\n` +
          `获取 token: /desktop confirm desktop.hotkey {"keys":["cmd","l"]}`,
      };
    }
    if (params.keys) {
      const keysArray = Array.isArray(params.keys) ? params.keys : [params.keys];
      toolArgs.keys = keysArray.join("+");
    }
    toolArgs.confirm = (params.confirm as { token: string }).token;
  } else if (subcommand === "wait") {
    if (params.condition) toolArgs.condition = params.condition;
    if (params.timeoutMs) toolArgs.timeoutMs = params.timeoutMs;
  }

  const { executeTool } = await import("../tools/bus.js");
  const { randomUUID } = await import("node:crypto");

  const requestId = randomUUID();
  const messageRequestId = randomUUID();
  const timeoutMs = subcommand === "wait" ? (params.timeoutMs ? Number(params.timeoutMs) : 30000) : 30000;

  const result = await executeTool("desktop", toolArgs, {
    workspacePath: entry.workspacePath,
    source: "slash-command",
    requestId,
    chatId: chatId,
    timeoutMs,
  });

  if (result.ok && result.artifacts && result.artifacts.length > 0) {
    const { recordDesktopSession } = await import("../runtime/desktop-session.js");
    const evidenceDir = result.artifacts[0]?.path || "";
    if (evidenceDir) {
      await recordDesktopSession({
        messageRequestId,
        method: subcommand,
        executionId: requestId,
        evidenceDir,
        workspacePath: entry.workspacePath,
        chatId: chatId,
      }).catch(err => {
        console.error(`[DesktopSession] 记录失败: ${err}`);
      });
    }
  }

  if (result.ok) {
    let message = result.data?.stdout || "执行成功（无输出）";
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
  const stderr = result.data?.stderr || "";
  const extraInfo = stderr ? `\n\nstderr:\n${stderr}` : "";
  return {
    success: false,
    message: `执行失败: ${error?.message || "未知错误"}${extraInfo}`,
  };
}

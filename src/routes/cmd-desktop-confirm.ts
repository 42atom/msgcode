/**
 * msgcode: Desktop 域 - confirm 子命令
 *
 * 处理 /desktop confirm <method> [--timeout-ms <ms>] <paramsJson> 命令
 */

import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

/**
 * 处理 /desktop confirm 子命令
 */
export async function handleDesktopConfirm(
  options: CommandHandlerOptions,
  entry: NonNullable<ReturnType<typeof getRouteByChatId>>
): Promise<CommandResult> {
  const { chatId, args } = options;
  const method = args[1];
  const timeoutMsRaw = args[2];
  const paramsJsonRaw = args.slice(3).join(" ");

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

  let ttlMs = 60000;
  if (timeoutMsRaw && timeoutMsRaw.startsWith("--timeout-ms")) {
    const msValue = timeoutMsRaw.split(/\s+/)[1] ?? "";
    if (!isNaN(Number(msValue))) {
      ttlMs = Number(msValue);
    }
  }

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
  } }, {
    workspacePath: entry.workspacePath,
    source: "slash-command",
    requestId,
    chatId: chatId,
    timeoutMs: 30000,
  });

  if (result.ok) {
    const data = result.data as { stdout?: string } | undefined;
    const stdout = data?.stdout || "";
    try {
      const resp = JSON.parse(stdout);
      const token = resp?.token || "";
      const expiresAt = resp?.expiresAt || "";
      const copyTemplate = (method: string, token: string) => {
        const templates: Record<string, string> = {
          "desktop.click": `/desktop shortcut click {"selector":{},"confirm":{"token":"${token}"}}`,
          "desktop.typeText": `/desktop shortcut type {"selector":{},"text":"","confirm":{"token":"${token}"}}`,
          "desktop.hotkey": `/desktop shortcut hotkey {"keys":[],"confirm":{"token":"${token}"}}`,
        };
        return templates[method] || `确认令牌已签发。在目标命令中添加 "confirm":{"token":"${token}"}`;
      };

      return {
        success: true,
        message: `确认令牌已签发\n` +
          `\n` +
          `token: ${token}\n` +
          `expiresAt: ${expiresAt}\n` +
          `\n` +
          `下一步命令:\n` +
          copyTemplate(method, token),
      };
    } catch {
      return {
        success: true,
        message: stdout || "令牌签发成功",
      };
    }
  }

  const error = result.error;
  return {
    success: false,
    message: `签发失败: ${error?.message || "未知错误"}`,
  };
}

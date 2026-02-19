/**
 * msgcode: Desktop 域 - rpc 子命令
 *
 * 处理 /desktop rpc <method> [--timeout-ms <ms>] [--confirm-token <token>] <paramsJson> 命令
 */

import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

/**
 * 处理 /desktop rpc 子命令
 */
export async function handleDesktopRpc(
  options: CommandHandlerOptions,
  entry: NonNullable<ReturnType<typeof getRouteByChatId>>
): Promise<CommandResult> {
  const { chatId, args } = options;
  const method = args[1];
  const timeoutMsRaw = args[2] ?? "";
  const confirmToken = args[3] ?? "";
  const paramsJsonRaw = args[4] ?? "";

  if (!method) {
    return {
      success: false,
      message: `用法: /desktop rpc <method> [--timeout-ms <ms>] [--confirm-token <token>] <paramsJson>\n` +
        `\n` +
        `例: /desktop rpc desktop.find {"selector":{"byRole":"AXWindow"}}\n` +
        `例: /desktop rpc desktop.waitUntil --timeout-ms 60000 {"condition":{"selectorExists":{"byRole":"AXButton"}}}\n` +
        `例: /desktop rpc desktop.typeText --confirm-token abc123 {"text":"hello"}`,
    };
  }

  let params: Record<string, unknown>;
  try {
    const paramsJson = paramsJsonRaw.trim();
    params = paramsJson ? JSON.parse(paramsJson) : {};
  } catch {
    return {
      success: false,
      message: `无效的 JSON 参数: ${paramsJsonRaw}`,
    };
  }

  if (confirmToken) {
    params.confirm = { token: confirmToken };
  }

  let timeoutMs = 30000;
  if (timeoutMsRaw && !isNaN(Number(timeoutMsRaw))) {
    timeoutMs = Number(timeoutMsRaw);
  } else if (params.meta && typeof params.meta === "object") {
    const metaTimeout = (params.meta as Record<string, unknown>).timeoutMs;
    if (typeof metaTimeout === "number") {
      timeoutMs = metaTimeout;
    }
  }

  const { executeTool } = await import("../tools/bus.js");
  const { randomUUID } = await import("node:crypto");

  const requestId = randomUUID();
  const result = await executeTool("desktop", { method, params }, {
    workspacePath: entry.workspacePath,
    source: "slash-command",
    requestId,
    chatId: chatId,
    timeoutMs,
  });

  if (result.ok) {
    const dataAny = result.data as unknown as { stdout?: string } | undefined;
    let message = dataAny?.stdout || "";
    if (!message && result.data) {
      try {
        message = JSON.stringify(result.data, null, 2);
      } catch {
        message = String(result.data);
      }
    }
    if (!message) message = "执行成功（无输出）";

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
  const dataAny = result.data as unknown as { stderr?: string } | undefined;
  const stderr = dataAny?.stderr || "";
  const extraInfo = stderr ? `\n\nstderr:\n${stderr}` : "";

  return {
    success: false,
    message: `执行失败: ${error?.message || "未知错误"}${extraInfo}`,
  };
}

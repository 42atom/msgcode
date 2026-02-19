/**
 * msgcode: 路由命令薄壳
 *
 * 职责：
 * - isRouteCommand: 命令识别
 * - parseRouteCommand: 命令解析
 * - handleRouteCommand: 命令分发
 */

import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";
import {
  handleBindCommand as handleBindCommandImpl,
  handleWhereCommand as handleWhereCommandImpl,
  handleUnbindCommand as handleUnbindCommandImpl,
} from "./cmd-bind.js";
import {
  handleInfoCommand as handleInfoCommandImpl,
  handleChatlistCommand as handleChatlistCommandImpl,
  handleHelpCommand as handleHelpCommandImpl,
} from "./cmd-info.js";
import {
  handleModelCommand as handleModelCommandImpl,
  handlePolicyCommand as handlePolicyCommandImpl,
  handlePiCommand as handlePiCommandImpl,
} from "./cmd-model.js";
import {
  handleOwnerCommand as handleOwnerCommandImpl,
  handleOwnerOnlyCommand as handleOwnerOnlyCommandImpl,
} from "./cmd-owner.js";
import {
  handleCursorCommand as handleCursorCommandImpl,
  handleResetCursorCommand as handleResetCursorCommandImpl,
  handleMemCommand as handleMemCommandImpl,
} from "./cmd-memory.js";
import {
  handleSoulListCommand as handleSoulListCommandImpl,
  handleSoulUseCommand as handleSoulUseCommandImpl,
  handleSoulCurrentCommand as handleSoulCurrentCommandImpl,
} from "./cmd-soul.js";
import {
  handleScheduleListCommand as handleScheduleListCommandImpl,
  handleScheduleValidateCommand as handleScheduleValidateCommandImpl,
  handleScheduleEnableCommand as handleScheduleEnableCommandImpl,
  handleScheduleDisableCommand as handleScheduleDisableCommandImpl,
  handleReloadCommand as handleReloadCommandImpl,
} from "./cmd-schedule.js";
import {
  handleToolstatsCommand as handleToolstatsCommandImpl,
  handleToolAllowListCommand as handleToolAllowListCommandImpl,
  handleToolAllowAddCommand as handleToolAllowAddCommandImpl,
  handleToolAllowRemoveCommand as handleToolAllowRemoveCommandImpl,
} from "./cmd-tooling.js";
import { handleDesktopCommand as handleDesktopCommandImpl } from "./cmd-desktop.js";
import {
  handleSteerCommand as handleSteerCommandImpl,
  handleNextCommand as handleNextCommandImpl,
} from "./cmd-steer.js";

export type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

export const handleBindCommand = handleBindCommandImpl;
export const handleWhereCommand = handleWhereCommandImpl;
export const handleUnbindCommand = handleUnbindCommandImpl;
export const handleInfoCommand = handleInfoCommandImpl;
export const handleModelCommand = handleModelCommandImpl;
export const handleChatlistCommand = handleChatlistCommandImpl;
export const handleCursorCommand = handleCursorCommandImpl;
export const handleResetCursorCommand = handleResetCursorCommandImpl;
export const handleHelpCommand = handleHelpCommandImpl;
export const handleMemCommand = handleMemCommandImpl;
export const handlePolicyCommand = handlePolicyCommandImpl;
export const handlePiCommand = handlePiCommandImpl;
export const handleOwnerCommand = handleOwnerCommandImpl;
export const handleOwnerOnlyCommand = handleOwnerOnlyCommandImpl;
export const handleSoulListCommand = handleSoulListCommandImpl;
export const handleSoulUseCommand = handleSoulUseCommandImpl;
export const handleSoulCurrentCommand = handleSoulCurrentCommandImpl;
export const handleScheduleListCommand = handleScheduleListCommandImpl;
export const handleScheduleValidateCommand = handleScheduleValidateCommandImpl;
export const handleScheduleEnableCommand = handleScheduleEnableCommandImpl;
export const handleScheduleDisableCommand = handleScheduleDisableCommandImpl;
export const handleReloadCommand = handleReloadCommandImpl;
export const handleToolstatsCommand = handleToolstatsCommandImpl;
export const handleToolAllowListCommand = handleToolAllowListCommandImpl;
export const handleToolAllowAddCommand = handleToolAllowAddCommandImpl;
export const handleToolAllowRemoveCommand = handleToolAllowRemoveCommandImpl;
export const handleDesktopCommand = handleDesktopCommandImpl;
export const handleSteerCommand = handleSteerCommandImpl;
export const handleNextCommand = handleNextCommandImpl;

export async function handleRouteCommand(
  command: string,
  options: CommandHandlerOptions
): Promise<CommandResult> {
  switch (command) {
    case "bind":
      return handleBindCommand(options);
    case "where":
      return handleWhereCommand(options);
    case "unbind":
      return handleUnbindCommand(options);
    case "info":
      return handleInfoCommand(options);
    case "model":
      return handleModelCommand(options);
    case "chatlist":
      return handleChatlistCommand(options);
    case "cursor":
      return handleCursorCommand(options);
    case "resetCursor":
      return handleResetCursorCommand(options);
    case "help":
      return handleHelpCommand(options);
    case "mem":
      return handleMemCommand(options);
    case "policy":
      return handlePolicyCommand(options);
    case "pi":
      return handlePiCommand(options);
    case "owner":
      return handleOwnerCommand(options);
    case "ownerOnly":
      return handleOwnerOnlyCommand(options);
    case "soulList":
      return handleSoulListCommand(options);
    case "soulUse":
      return handleSoulUseCommand(options);
    case "soulCurrent":
      return handleSoulCurrentCommand(options);
    case "scheduleList":
      return handleScheduleListCommand(options);
    case "scheduleValidate":
      return handleScheduleValidateCommand(options);
    case "scheduleEnable":
      return handleScheduleEnableCommand(options);
    case "scheduleDisable":
      return handleScheduleDisableCommand(options);
    case "reload":
      return handleReloadCommand(options);
    case "toolstats":
      return handleToolstatsCommand(options);
    case "toolAllowList":
      return handleToolAllowListCommand(options);
    case "toolAllowAdd":
      return handleToolAllowAddCommand(options);
    case "toolAllowRemove":
      return handleToolAllowRemoveCommand(options);
    case "desktop":
      return handleDesktopCommand(options);
    case "steer":
      return handleSteerCommand(options);
    case "next":
      return handleNextCommand(options);
    default:
      return {
        success: false,
        message: `未知命令: /${command}\n` +
          `\n` +
          `可用命令: /bind, /where, /unbind, /info, /model, /policy, /owner, /owner-only, /chatlist, /mem, /cursor, /reset-cursor, /help, /soul, /schedule, /reload, /steer, /next`,
      };
  }
}

export function isRouteCommand(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("/bind ") ||
    trimmed === "/bind" ||
    trimmed === "/where" ||
    trimmed === "/unbind" ||
    trimmed === "/info" ||
    trimmed.startsWith("/model ") ||
    trimmed === "/model" ||
    trimmed === "/chatlist" ||
    trimmed === "/cursor" ||
    trimmed === "/reset-cursor" ||
    trimmed.startsWith("/reset-cursor") ||
    trimmed.startsWith("/mem ") ||
    trimmed === "/mem" ||
    trimmed.startsWith("/policy ") ||
    trimmed === "/policy" ||
    trimmed.startsWith("/pi ") ||
    trimmed === "/pi" ||
    trimmed.startsWith("/owner ") ||
    trimmed === "/owner" ||
    trimmed.startsWith("/owner-only ") ||
    trimmed === "/owner-only" ||
    trimmed === "/help" ||
    trimmed === "/soul" ||
    trimmed.startsWith("/soul ") ||
    trimmed === "/schedule" ||
    trimmed.startsWith("/schedule ") ||
    trimmed === "/reload" ||
    trimmed === "/toolstats" ||
    trimmed.startsWith("/tool ") ||
    trimmed === "/desktop" ||
    trimmed.startsWith("/desktop ") ||
    trimmed.startsWith("/desktop find ") ||
    trimmed.startsWith("/desktop click ") ||
    trimmed.startsWith("/desktop type ") ||
    trimmed.startsWith("/desktop hotkey ") ||
    trimmed.startsWith("/desktop wait ") ||
    trimmed.startsWith("/steer ") ||
    trimmed === "/steer" ||
    trimmed.startsWith("/next ") ||
    trimmed === "/next"
  );
}

export function parseRouteCommand(text: string): { command: string; args: string[] } | null {
  const trimmed = text.trim();

  if (trimmed.startsWith("/bind ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "bind", args: parts.slice(1) };
  }
  if (trimmed === "/bind") {
    return { command: "bind", args: [] };
  }
  if (trimmed === "/where") {
    return { command: "where", args: [] };
  }
  if (trimmed === "/unbind") {
    return { command: "unbind", args: [] };
  }
  if (trimmed === "/info") {
    return { command: "info", args: [] };
  }
  if (trimmed.startsWith("/model ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "model", args: parts.slice(1) };
  }
  if (trimmed === "/model") {
    return { command: "model", args: [] };
  }
  if (trimmed === "/chatlist") {
    return { command: "chatlist", args: [] };
  }
  if (trimmed === "/cursor") {
    return { command: "cursor", args: [] };
  }
  if (trimmed.startsWith("/reset-cursor")) {
    return { command: "resetCursor", args: [] };
  }
  if (trimmed === "/help") {
    return { command: "help", args: [] };
  }
  if (trimmed.startsWith("/mem ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "mem", args: parts.slice(1) };
  }
  if (trimmed === "/mem") {
    return { command: "mem", args: [] };
  }
  if (trimmed.startsWith("/policy ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "policy", args: parts.slice(1) };
  }
  if (trimmed === "/policy") {
    return { command: "policy", args: [] };
  }
  if (trimmed.startsWith("/pi ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "pi", args: parts.slice(1) };
  }
  if (trimmed === "/pi") {
    return { command: "pi", args: [] };
  }
  if (trimmed === "/owner") {
    return { command: "owner", args: [] };
  }
  if (trimmed.startsWith("/owner ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "owner", args: parts.slice(1) };
  }
  if (trimmed === "/owner-only") {
    return { command: "ownerOnly", args: [] };
  }
  if (trimmed.startsWith("/owner-only ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "ownerOnly", args: parts.slice(1) };
  }
  if (trimmed === "/soul") {
    return { command: "soulList", args: [] };
  }
  if (trimmed.startsWith("/soul ")) {
    const parts = trimmed.split(/\s+/);
    const subCommand = parts[1];
    if (subCommand === "list") {
      return { command: "soulList", args: [] };
    } else if (subCommand === "use") {
      return { command: "soulUse", args: parts.slice(2) };
    } else if (subCommand === "current") {
      return { command: "soulCurrent", args: [] };
    }
    return { command: "soulList", args: [] };
  }
  if (trimmed === "/schedule") {
    return { command: "scheduleList", args: [] };
  }
  if (trimmed.startsWith("/schedule ")) {
    const parts = trimmed.split(/\s+/);
    const subCommand = parts[1];
    if (subCommand === "list") {
      return { command: "scheduleList", args: [] };
    } else if (subCommand === "validate") {
      return { command: "scheduleValidate", args: [] };
    } else if (subCommand === "enable") {
      return { command: "scheduleEnable", args: parts.slice(2) };
    } else if (subCommand === "disable") {
      return { command: "scheduleDisable", args: parts.slice(2) };
    }
    return { command: "scheduleList", args: [] };
  }
  if (trimmed === "/reload") {
    return { command: "reload", args: [] };
  }
  if (trimmed === "/toolstats") {
    return { command: "toolstats", args: [] };
  }
  if (trimmed.startsWith("/tool ")) {
    const parts = trimmed.split(/\s+/);
    const subCommand = parts[1];
    if (subCommand === "allow") {
      const action = parts[2];
      if (action === "list") {
        return { command: "toolAllowList", args: [] };
      } else if (action === "add") {
        return { command: "toolAllowAdd", args: parts.slice(3) };
      } else if (action === "remove") {
        return { command: "toolAllowRemove", args: parts.slice(3) };
      }
    }
    return { command: "toolAllowList", args: [] };
  }
  if (trimmed === "/desktop") {
    return { command: "desktop", args: ["doctor"] };
  }
  if (trimmed.startsWith("/desktop ")) {
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[1];

    if (["observe", "find", "click", "type", "hotkey", "wait"].includes(subcommand)) {
      const jsonPart = trimmed.slice(trimmed.indexOf(subcommand) + subcommand.length).trim();
      return { command: "desktop", args: ["shortcut", subcommand, jsonPart] };
    }

    if (subcommand === "confirm") {
      const m = trimmed.match(/^\/desktop\s+confirm\s+(\S+)(?:\s+--timeout-ms\s+(\S+))?(?:\s+(.*))?$/);
      if (!m) return { command: "desktop", args: ["confirm"] };
      const method = m[1] ?? "";
      const timeoutMs = m[2] ?? "";
      const paramsJson = (m[3] ?? "").trim();
      return { command: "desktop", args: ["confirm", method, timeoutMs, paramsJson] };
    }

    if (subcommand === "rpc") {
      const m = trimmed.match(/^\/desktop\s+rpc\s+(\S+)(?:\s+--timeout-ms\s+(\S+))?(?:\s+--confirm-token\s+(\S+))?(?:\s+(.*))?$/);
      if (!m) return { command: "desktop", args: ["rpc"] };
      const method = m[1] ?? "";
      const timeoutMs = m[2] ?? "";
      const confirmToken = m[3] ?? "";
      const paramsJson = (m[4] ?? "").trim();
      return { command: "desktop", args: ["rpc", method, timeoutMs, confirmToken, paramsJson] };
    }

    if (["ping", "doctor"].includes(subcommand)) {
      return { command: "desktop", args: [subcommand] };
    }

    return { command: "desktop", args: ["doctor"] };
  }
  if (trimmed.startsWith("/steer ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "steer", args: parts.slice(1) };
  }
  if (trimmed === "/steer") {
    return { command: "steer", args: [] };
  }
  if (trimmed.startsWith("/next ")) {
    const parts = trimmed.split(/\s+/);
    return { command: "next", args: parts.slice(1) };
  }
  if (trimmed === "/next") {
    return { command: "next", args: [] };
  }

  return null;
}

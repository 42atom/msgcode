import type { SideEffectLevel, ToolName } from "./types.js";
import {
  GHOST_TOOL_NAMES,
  getGhostToolSideEffect,
} from "../runners/ghost-mcp-contract.js";
import { normalizeEditFileEditsInput } from "../runners/file-tools.js";

const GHOST_TOOL_META = Object.fromEntries(
  GHOST_TOOL_NAMES.map((toolName) => [
    toolName,
    { sideEffect: getGhostToolSideEffect(toolName) as SideEffectLevel },
  ])
) as Record<typeof GHOST_TOOL_NAMES[number], { sideEffect: SideEffectLevel }>;

export const TOOL_META: Record<ToolName, { sideEffect: SideEffectLevel }> = {
  tts: { sideEffect: "message-send" },
  asr: { sideEffect: "local-write" },
  vision: { sideEffect: "local-write" },
  mem: { sideEffect: "local-write" },
  bash: { sideEffect: "process-control" },
  browser: { sideEffect: "process-control" },
  read_file: { sideEffect: "read-only" },
  help_docs: { sideEffect: "read-only" },
  write_file: { sideEffect: "local-write" },
  edit_file: { sideEffect: "local-write" },
  feishu_send_file: { sideEffect: "message-send" },
  feishu_list_members: { sideEffect: "read-only" },
  feishu_list_recent_messages: { sideEffect: "read-only" },
  feishu_reply_message: { sideEffect: "message-send" },
  feishu_react_message: { sideEffect: "message-send" },
  ...GHOST_TOOL_META,
};

export interface ValidationError {
  code: "TOOL_BAD_ARGS";
  message: string;
}

export function validateToolArgs(
  tool: ToolName,
  args: Record<string, unknown>
): ValidationError | null {
  switch (tool) {
    case "read_file": {
      if (!args.path || typeof args.path !== "string" || !args.path.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "read_file: 'path' must be a non-empty string" };
      }
      break;
    }
    case "write_file": {
      if (!args.path || typeof args.path !== "string" || !args.path.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "write_file: 'path' must be a non-empty string" };
      }
      if (args.content === undefined || args.content === null) {
        return { code: "TOOL_BAD_ARGS", message: "write_file: 'content' is required" };
      }
      break;
    }
    case "help_docs": {
      if (args.query !== undefined && typeof args.query !== "string") {
        return { code: "TOOL_BAD_ARGS", message: "help_docs: 'query' must be a string when provided" };
      }
      if (args.limit !== undefined) {
        const limit = Number(args.limit);
        if (!Number.isFinite(limit) || limit <= 0) {
          return { code: "TOOL_BAD_ARGS", message: "help_docs: 'limit' must be a positive number when provided" };
        }
      }
      break;
    }
    case "edit_file": {
      if (!args.path || typeof args.path !== "string" || !args.path.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "edit_file: 'path' must be a non-empty string" };
      }
      const edits = normalizeEditFileEditsInput(args);
      if (!edits || edits.length === 0) {
        return {
          code: "TOOL_BAD_ARGS",
          message: "edit_file: provide either 'edits' or the shorthand pair 'oldText' + 'newText'",
        };
      }
      args.edits = edits;
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        if (typeof edit.oldText !== "string") {
          return { code: "TOOL_BAD_ARGS", message: `edit_file: edits[${i}].oldText must be a string` };
        }
        if (typeof edit.newText !== "string") {
          return { code: "TOOL_BAD_ARGS", message: `edit_file: edits[${i}].newText must be a string` };
        }
      }
      break;
    }
    case "bash": {
      if (!args.command || typeof args.command !== "string" || !args.command.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "bash: 'command' must be a non-empty string" };
      }
      break;
    }
    case "browser": {
      if (!args.operation || typeof args.operation !== "string" || !args.operation.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "browser: 'operation' must be a non-empty string" };
      }
      break;
    }
    case "feishu_send_file": {
      if (!args.filePath || typeof args.filePath !== "string" || !args.filePath.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "feishu_send_file: 'filePath' must be a non-empty string" };
      }
      break;
    }
    case "feishu_reply_message": {
      if (!args.text || typeof args.text !== "string" || !args.text.trim()) {
        return { code: "TOOL_BAD_ARGS", message: "feishu_reply_message: 'text' must be a non-empty string" };
      }
      if (
        args.messageId !== undefined
        && (typeof args.messageId !== "string" || !args.messageId.trim())
      ) {
        return { code: "TOOL_BAD_ARGS", message: "feishu_reply_message: 'messageId' must be a non-empty string when provided" };
      }
      break;
    }
    case "feishu_react_message": {
      if (
        args.messageId !== undefined
        && (typeof args.messageId !== "string" || !args.messageId.trim())
      ) {
        return { code: "TOOL_BAD_ARGS", message: "feishu_react_message: 'messageId' must be a non-empty string when provided" };
      }
      if (args.emoji !== undefined && typeof args.emoji !== "string") {
        return { code: "TOOL_BAD_ARGS", message: "feishu_react_message: 'emoji' must be a string when provided" };
      }
      break;
    }
  }

  return null;
}

import type { ToolContext, ToolName, ToolResult } from "./types.js";
import { randomUUID } from "node:crypto";
import { mkdir as mkdirFs, writeFile as writeFileFs } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { getHelpDocsData } from "../cli/help.js";
import {
  runReadFileTool,
  runWriteFileTool,
  runEditFileTool,
} from "../runners/file-tools.js";
import {
  executeBrowserOperation,
  BrowserCommandError,
  BROWSER_ERROR_CODES,
  type BrowserOperation,
} from "../runners/browser-patchright.js";
import {
  runFeishuSendFileTool,
  runFeishuListMembersTool,
  runFeishuListRecentMessagesTool,
  runFeishuReplyMessageTool,
  runFeishuReactMessageTool,
} from "../runners/feishu.js";
import {
  buildEditFilePreviewText,
  buildFeishuListMembersPreviewText,
  buildFeishuReactPreviewText,
  buildFeishuRecentMessagesPreviewText,
  buildFeishuReplyPreviewText,
  buildFeishuSendFilePreviewText,
  buildHelpDocsPreviewText,
  buildReadFilePreviewText,
  buildToolErrorPreviewText,
  buildWriteFilePreviewText,
} from "./previews.js";

const BROWSER_TEXT_PREVIEW_CHARS = 1200;

async function withTimeout<T>(p: Promise<T>, ms = 120000): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("TOOL_TIMEOUT")), ms)),
  ]);
}

function clipPreviewText(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3)}...`;
}

function buildBrowserPreviewText(params: {
  operation: string;
  data: Record<string, unknown>;
  textPath?: string;
  textBytes?: number;
  textPreview?: string;
  textTruncated?: boolean;
}): string {
  const lines = [`[browser] operation=${params.operation}`];
  if (typeof params.data.title === "string" && params.data.title.trim()) {
    lines.push(`[title] ${params.data.title.trim()}`);
  }
  if (typeof params.data.url === "string" && params.data.url.trim()) {
    lines.push(`[url] ${params.data.url.trim()}`);
  }
  if (typeof params.data.instanceId === "string" && params.data.instanceId.trim()) {
    lines.push(`[instanceId] ${params.data.instanceId.trim()}`);
  }
  if (typeof params.data.tabId === "string" && params.data.tabId.trim()) {
    lines.push(`[tabId] ${params.data.tabId.trim()}`);
  }
  if (params.textPath) {
    lines.push(`[textPath] ${params.textPath}`);
  }
  if (typeof params.textBytes === "number" && Number.isFinite(params.textBytes)) {
    lines.push(`[textBytes] ${params.textBytes}`);
  }
  if (params.textPreview) {
    lines.push(params.textTruncated ? "[status] truncated-text-preview" : "[status] inline-text-preview");
    lines.push("[textPreview]");
    lines.push(params.textPreview);
  }
  if (lines.length === 1) {
    const keys = Object.keys(params.data).slice(0, 6);
    lines.push(keys.length > 0 ? `[keys] ${keys.join(", ")}` : "[status] ok");
  }
  return clipPreviewText(lines.join("\n"));
}

function buildBrowserTextSnippet(text: string): {
  preview: string;
  truncated: boolean;
  textBytes: number;
} {
  const normalized = text.trim();
  const textBytes = Buffer.byteLength(normalized, "utf-8");
  if (normalized.length <= BROWSER_TEXT_PREVIEW_CHARS) {
    return {
      preview: normalized,
      truncated: false,
      textBytes,
    };
  }
  return {
    preview: `${normalized.slice(0, BROWSER_TEXT_PREVIEW_CHARS)}...`,
    truncated: true,
    textBytes,
  };
}

async function persistBrowserTextArtifact(params: {
  workspacePath: string;
  text: string;
}): Promise<{
  textPath: string;
  textBytes: number;
  textPreview: string;
  textTruncated: boolean;
}> {
  const browserDir = joinPath(params.workspacePath, "artifacts", "browser");
  await mkdirFs(browserDir, { recursive: true });
  const textPath = joinPath(browserDir, `tabs-text-${randomUUID()}.txt`);
  await writeFileFs(textPath, params.text, "utf-8");
  const snippet = buildBrowserTextSnippet(params.text);
  return {
    textPath,
    textBytes: snippet.textBytes,
    textPreview: snippet.preview,
    textTruncated: snippet.truncated,
  };
}

export async function executeFileLikeTool(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
  started: number
): Promise<ToolResult | null> {
  switch (tool) {
    case "read_file": {
      const out = await runReadFileTool(
        {
          path: String(args.path || ""),
          offset: args.offset,
          limit: args.limit,
        },
        {
          workspacePath: ctx.workspacePath,
          timeoutMs: ctx.timeoutMs ?? 30000,
        }
      );

      if (!out.ok) {
        return {
          ok: false,
          tool,
          error: {
            code: out.code,
            message: out.message,
          },
          previewText: out.previewText ?? buildToolErrorPreviewText(tool, out.message),
          durationMs: Date.now() - started,
        };
      }

      return {
        ok: true,
        tool,
        data: {
          path: out.filePath,
          kind: out.kind,
          content: out.content,
          truncated: out.truncated,
          byteLength: out.byteLength,
          totalBytes: out.totalBytes,
          offset: out.offset,
          limit: out.limit,
          hasMore: out.hasMore,
          nextOffset: out.nextOffset,
          totalLines: out.totalLines,
          binaryKind: out.binaryKind,
          handle: out.handle,
          blob: out.blob,
        },
        previewText: buildReadFilePreviewText({
          filePath: out.filePath,
          kind: out.kind,
          content: out.content,
          byteLength: out.byteLength,
          totalBytes: out.totalBytes,
          offset: out.offset,
          limit: out.limit,
          hasMore: out.hasMore,
          nextOffset: out.nextOffset,
          totalLines: out.totalLines,
          binaryKind: out.binaryKind,
          handle: out.handle,
          blob: out.blob,
          truncated: Boolean(out.truncated),
        }),
        durationMs: Date.now() - started,
      };
    }
    case "help_docs": {
      const query = typeof args.query === "string" ? args.query.trim() : undefined;
      const limit = typeof args.limit === "number"
        ? args.limit
        : (typeof args.limit === "string" ? Number(args.limit) : undefined);
      const docs = await getHelpDocsData({
        query,
        limit: typeof limit === "number" && Number.isFinite(limit)
          ? Math.max(1, Math.trunc(limit))
          : undefined,
      });
      const commands = Array.isArray(docs.commands) ? docs.commands : [];

      return {
        ok: true,
        tool,
        data: {
          version: docs.version,
          totalCommands: docs.totalCommands,
          matchedCommands: commands.length,
          query,
          commands,
        },
        previewText: buildHelpDocsPreviewText({
          version: docs.version,
          query,
          matchedCommands: commands.length,
          totalCommands: docs.totalCommands,
          commandNames: commands
            .map((cmd) => (typeof cmd.name === "string" ? cmd.name : ""))
            .filter(Boolean),
        }),
        durationMs: Date.now() - started,
      };
    }
    case "write_file": {
      const out = await runWriteFileTool(
        {
          path: String(args.path || ""),
          content: String(args.content ?? ""),
        },
        {
          workspacePath: ctx.workspacePath,
          timeoutMs: ctx.timeoutMs ?? 30000,
        }
      );

      if (!out.ok) {
        return {
          ok: false,
          tool,
          error: {
            code: out.code,
            message: out.message,
          },
          previewText: out.previewText ?? buildToolErrorPreviewText(tool, out.message),
          durationMs: Date.now() - started,
        };
      }

      return {
        ok: true,
        tool,
        data: {
          path: out.displayPath,
          bytesWritten: out.bytesWritten,
        },
        previewText: buildWriteFilePreviewText({
          filePath: out.filePath,
          bytesWritten: out.bytesWritten,
        }),
        durationMs: Date.now() - started,
      };
    }
    case "edit_file": {
      const edits = Array.isArray(args.edits) ? args.edits : [];
      const out = await runEditFileTool(
        {
          path: String(args.path || ""),
          edits,
        },
        {
          workspacePath: ctx.workspacePath,
          timeoutMs: ctx.timeoutMs ?? 30000,
        }
      );

      if (!out.ok) {
        return {
          ok: false,
          tool,
          error: {
            code: out.code,
            message: out.message,
          },
          previewText: out.previewText ?? buildToolErrorPreviewText(tool, out.message),
          durationMs: Date.now() - started,
        };
      }

      return {
        ok: true,
        tool,
        data: { path: out.displayPath, editsApplied: out.editsApplied },
        previewText: buildEditFilePreviewText({
          filePath: out.filePath,
          editsApplied: out.editsApplied,
        }),
        durationMs: Date.now() - started,
      };
    }
    default:
      return null;
  }
}

export async function executeFeishuTool(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
  started: number
): Promise<ToolResult | null> {
  switch (tool) {
    case "feishu_send_file": {
      const out = await withTimeout(
        runFeishuSendFileTool(
          {
            filePath: String(args.filePath ?? "").trim(),
            chatId: args.chatId ? String(args.chatId).trim() : undefined,
            message: args.message ? String(args.message).trim() : undefined,
          },
          {
            workspacePath: ctx.workspacePath,
            chatId: ctx.chatId,
            currentMessageId: ctx.currentMessageId,
            defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
          }
        ),
        ctx.timeoutMs ?? 60000
      );

      return {
        ok: out.ok,
        tool,
        data: out.ok ? {
          chatId: out.chatId,
          ...(out.attachmentType ? { attachmentType: out.attachmentType } : {}),
          ...(out.attachmentKey ? { attachmentKey: out.attachmentKey } : {}),
          ...(out.receipt ? { receipt: out.receipt } : {}),
        } : undefined,
        error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "发送失败" },
        previewText: out.ok
          ? buildFeishuSendFilePreviewText({
            chatId: out.chatId,
            attachmentType: out.attachmentType,
            attachmentKey: out.attachmentKey,
            receipt: out.receipt,
          })
          : buildToolErrorPreviewText(tool, out.error || "发送失败"),
        durationMs: Date.now() - started,
      };
    }
    case "feishu_list_members": {
      const out = await withTimeout(
        runFeishuListMembersTool(
          {
            chatId: args.chatId ? String(args.chatId).trim() : undefined,
            memberIdType: String(args.memberIdType ?? "open_id").trim(),
          },
          {
            workspacePath: ctx.workspacePath,
            chatId: ctx.chatId,
            currentMessageId: ctx.currentMessageId,
            defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
          }
        ),
        ctx.timeoutMs ?? 30000
      );

      return {
        ok: out.ok,
        tool,
        data: out.ok
          ? {
            chatId: out.chatId,
            memberIdType: out.memberIdType,
            memberTotal: out.memberTotal ?? out.members?.length ?? 0,
            members: out.members ?? [],
          }
          : undefined,
        error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "获取群成员失败" },
        previewText: out.ok
          ? buildFeishuListMembersPreviewText({
            chatId: out.chatId,
            memberTotal: out.memberTotal ?? out.members?.length ?? 0,
            members: out.members ?? [],
          })
          : buildToolErrorPreviewText(tool, out.error || "获取群成员失败"),
        durationMs: Date.now() - started,
      };
    }
    case "feishu_list_recent_messages": {
      const out = await withTimeout(
        runFeishuListRecentMessagesTool(
          {
            chatId: args.chatId ? String(args.chatId).trim() : undefined,
            limit: args.limit,
          },
          {
            workspacePath: ctx.workspacePath,
            chatId: ctx.chatId,
            currentMessageId: ctx.currentMessageId,
            defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
          }
        ),
        ctx.timeoutMs ?? 30000
      );

      return {
        ok: out.ok,
        tool,
        data: out.ok
          ? {
            chatId: out.chatId,
            count: out.count ?? out.messages?.length ?? 0,
            messages: out.messages ?? [],
          }
          : undefined,
        error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "获取最近消息失败" },
        previewText: out.ok
          ? buildFeishuRecentMessagesPreviewText({
            chatId: out.chatId,
            count: out.count ?? out.messages?.length ?? 0,
            messages: out.messages ?? [],
          })
          : buildToolErrorPreviewText(tool, out.error || "获取最近消息失败"),
        durationMs: Date.now() - started,
      };
    }
    case "feishu_reply_message": {
      const replyInThread = Boolean(args.replyInThread);
      const out = await withTimeout(
        runFeishuReplyMessageTool(
          {
            messageId: args.messageId ? String(args.messageId).trim() : undefined,
            text: String(args.text ?? "").trim(),
            replyInThread,
          },
          {
            workspacePath: ctx.workspacePath,
            chatId: ctx.chatId,
            currentMessageId: ctx.currentMessageId,
            defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
          }
        ),
        ctx.timeoutMs ?? 30000
      );

      return {
        ok: out.ok,
        tool,
        data: out.ok
          ? {
            chatId: out.chatId,
            repliedToMessageId: out.repliedToMessageId,
            messageId: out.messageId ?? "",
            replyInThread: out.replyInThread ?? replyInThread,
          }
          : undefined,
        error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "回复消息失败" },
        previewText: out.ok
          ? buildFeishuReplyPreviewText({
            repliedToMessageId: out.repliedToMessageId,
            messageId: out.messageId ?? "",
            replyInThread: out.replyInThread ?? replyInThread,
          })
          : buildToolErrorPreviewText(tool, out.error || "回复消息失败"),
        durationMs: Date.now() - started,
      };
    }
    case "feishu_react_message": {
      const out = await withTimeout(
        runFeishuReactMessageTool(
          {
            messageId: args.messageId ? String(args.messageId).trim() : undefined,
            emoji: args.emoji ? String(args.emoji).trim() : undefined,
          },
          {
            workspacePath: ctx.workspacePath,
            chatId: ctx.chatId,
            currentMessageId: ctx.currentMessageId,
            defaultActionTargetMessageId: ctx.defaultActionTargetMessageId,
          }
        ),
        ctx.timeoutMs ?? 30000
      );

      return {
        ok: out.ok,
        tool,
        data: out.ok
          ? {
            messageId: out.messageId,
            reactionId: out.reactionId,
            emojiType: out.emojiType ?? "THUMBSUP",
          }
          : undefined,
        error: out.ok ? undefined : { code: "TOOL_EXEC_FAILED", message: out.error || "消息表情回复失败" },
        previewText: out.ok
          ? buildFeishuReactPreviewText({
            messageId: out.messageId,
            reactionId: out.reactionId,
            emojiType: out.emojiType ?? "THUMBSUP",
          })
          : buildToolErrorPreviewText(tool, out.error || "消息表情回复失败"),
        durationMs: Date.now() - started,
      };
    }
    default:
      return null;
  }
}

export async function executeBrowserTool(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
  started: number
): Promise<ToolResult | null> {
  if (tool !== "browser") {
    return null;
  }

  try {
    const browser = await withTimeout(
      executeBrowserOperation({
        operation: String(args.operation) as BrowserOperation,
        mode: typeof args.mode === "string" ? args.mode as "headed" | "headless" : undefined,
        rootName: typeof args.rootName === "string" ? args.rootName : undefined,
        profileId: typeof args.profileId === "string" ? args.profileId : undefined,
        instanceId: typeof args.instanceId === "string" ? args.instanceId : undefined,
        tabId: typeof args.tabId === "string" ? args.tabId : undefined,
        url: typeof args.url === "string" ? args.url : undefined,
        kind: typeof args.kind === "string" ? args.kind : undefined,
        ref: typeof args.ref === "string" ? args.ref : undefined,
        text: typeof args.text === "string" ? args.text : undefined,
        key: typeof args.key === "string" ? args.key : undefined,
        expression: typeof args.expression === "string" ? args.expression : undefined,
        interactive: args.interactive === true,
        compact: args.compact === true,
        port: typeof args.port === "string" || typeof args.port === "number" ? args.port : undefined,
        timeoutMs: ctx.timeoutMs,
      }),
      ctx.timeoutMs ?? 120000
    );

    const browserData = {
      ...browser.data,
    } as Record<string, unknown>;
    let browserTextArtifact: Awaited<ReturnType<typeof persistBrowserTextArtifact>> | undefined;

    if (
      browser.operation === "tabs.text"
      && typeof browserData.text === "string"
      && browserData.text.trim()
    ) {
      browserTextArtifact = await persistBrowserTextArtifact({
        workspacePath: ctx.workspacePath,
        text: browserData.text,
      });
      delete browserData.text;
      browserData.textPath = browserTextArtifact.textPath;
      browserData.textBytes = browserTextArtifact.textBytes;
      browserData.textTruncated = browserTextArtifact.textTruncated;
    }

    return {
      ok: true,
      tool,
      data: {
        operation: browser.operation,
        result: browserData,
        textPath: browserTextArtifact?.textPath,
        textBytes: browserTextArtifact?.textBytes,
        textTruncated: browserTextArtifact?.textTruncated,
      },
      artifacts: browserTextArtifact
        ? [{ kind: "browser", path: browserTextArtifact.textPath }]
        : undefined,
      previewText: buildBrowserPreviewText({
        operation: browser.operation,
        data: browserData,
        textPath: browserTextArtifact?.textPath,
        textBytes: browserTextArtifact?.textBytes,
        textPreview: browserTextArtifact?.textPreview,
        textTruncated: browserTextArtifact?.textTruncated,
      }),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof BrowserCommandError
      ? `${error.code}: ${error.message}`
      : (error instanceof Error ? error.message : String(error));
    const code = (
      (error instanceof BrowserCommandError && error.code === BROWSER_ERROR_CODES.TIMEOUT)
      || message === "TOOL_TIMEOUT"
    )
      ? "TOOL_TIMEOUT"
      : "TOOL_EXEC_FAILED";

    return {
      ok: false,
      tool,
      error: {
        code,
        message,
      },
      previewText: buildToolErrorPreviewText(tool, message),
      durationMs: Date.now() - started,
    };
  }
}

export async function executeRoutedTool(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
  started: number
): Promise<ToolResult | null> {
  return (
    await executeFileLikeTool(tool, args, ctx, started)
    ?? await executeFeishuTool(tool, args, ctx, started)
    ?? await executeBrowserTool(tool, args, ctx, started)
  );
}

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Command } from "commander";
import type { Diagnostic } from "../memory/types.js";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import { createInboxRequest } from "../runtime/inbox-store.js";

const INBOX_ERROR_CODES = {
  WORKSPACE_MISSING: "INBOX_WORKSPACE_MISSING",
  CHAT_ID_MISSING: "INBOX_CHAT_ID_MISSING",
  TEXT_MISSING: "INBOX_TEXT_MISSING",
  TRANSPORT_INVALID: "INBOX_TRANSPORT_INVALID",
  ADD_FAILED: "INBOX_ADD_FAILED",
} as const;

type InboxErrorCode = typeof INBOX_ERROR_CODES[keyof typeof INBOX_ERROR_CODES];

function createInboxDiagnostic(
  code: InboxErrorCode,
  message: string,
  hint?: string,
  details?: Record<string, unknown>
): Diagnostic {
  return { code, message, hint, details };
}

function normalizeNonEmpty(value: string): string {
  return String(value || "").trim();
}

function normalizeTransport(value: string): string {
  const normalized = normalizeNonEmpty(value || "web").toLowerCase();
  if (!normalized) {
    return "web";
  }
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    throw new Error("transport 只允许小写字母、数字和连字符");
  }
  return normalized;
}

export function createInboxAddCommand(): Command {
  const cmd = new Command("add");

  cmd
    .description("向当前工作区 inbox 追加一条原始请求")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .requiredOption("--chat-id <id>", "目标线程/会话对应的 chatId")
    .requiredOption("--text <text>", "原始输入文本")
    .option("--transport <name>", "来源通道，默认 web", "web")
    .option("--sender <handle>", "发送者 handle")
    .option("--sender-name <name>", "发送者显示名")
    .option("--message-id <id>", "显式消息 ID；默认自动生成")
    .option("--json", "JSON 格式输出")
    .action(async (options: {
      workspace: string;
      chatId: string;
      text: string;
      transport?: string;
      sender?: string;
      senderName?: string;
      messageId?: string;
      json?: boolean;
    }) => {
      const startTime = Date.now();
      const command = `msgcode inbox add --workspace ${options.workspace}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      const workspacePath = getWorkspacePath(options.workspace);
      if (!existsSync(workspacePath)) {
        errors.push(
          createInboxDiagnostic(
            INBOX_ERROR_CODES.WORKSPACE_MISSING,
            "工作区不存在",
            "先初始化 workspace，或传绝对路径",
            { workspacePath, input: options.workspace }
          )
        );
      }

      const chatId = normalizeNonEmpty(options.chatId);
      if (!chatId) {
        errors.push(
          createInboxDiagnostic(
            INBOX_ERROR_CODES.CHAT_ID_MISSING,
            "chatId 不能为空",
            "传入当前线程对应的 chatId",
          )
        );
      }

      const text = normalizeNonEmpty(options.text);
      if (!text) {
        errors.push(
          createInboxDiagnostic(
            INBOX_ERROR_CODES.TEXT_MISSING,
            "输入文本不能为空",
            "传入至少一行用户原始输入",
          )
        );
      }

      let transport = "web";
      try {
        transport = normalizeTransport(options.transport || "web");
      } catch (error) {
        errors.push(
          createInboxDiagnostic(
            INBOX_ERROR_CODES.TRANSPORT_INVALID,
            error instanceof Error ? error.message : String(error),
            "transport 只允许小写字母、数字和连字符",
            { transport: options.transport }
          )
        );
      }

      if (errors.length > 0) {
        const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
        return;
      }

      try {
        const messageId = normalizeNonEmpty(options.messageId ?? "") || `${transport}-${randomUUID()}`;
        const sender = normalizeNonEmpty(options.sender ?? "");
        const senderName = normalizeNonEmpty(options.senderName ?? "");
        const record = await createInboxRequest(workspacePath, {
          id: messageId,
          transport,
          chatId,
          text,
          isFromMe: false,
          date: Date.now(),
          sender,
          senderName,
          handle: sender,
          messageType: "text",
        });

        const envelope = createEnvelope(command, startTime, "pass", {
          workspacePath,
          chatId,
          messageId,
          requestNumber: record.requestNumber,
          state: record.state,
          transport: record.transport,
          filePath: record.path,
        }, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(0);
      } catch (error) {
        errors.push(
          createInboxDiagnostic(
            INBOX_ERROR_CODES.ADD_FAILED,
            `inbox 追加失败: ${error instanceof Error ? error.message : String(error)}`,
            "检查 workspace、chatId 与文本输入",
            { workspacePath, chatId, transport }
          )
        );
        const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }
    });

  return cmd;
}

export function createInboxCommand(): Command {
  const cmd = new Command("inbox");
  cmd.description("原始请求投递面（file-first）");
  cmd.addCommand(createInboxAddCommand());
  return cmd;
}

export function getInboxAddContract() {
  return {
    name: "msgcode inbox add",
    description: "向当前工作区 inbox 追加一条原始请求",
    options: {
      required: {
        "--workspace": "Workspace 相对路径或绝对路径",
        "--chat-id": "目标线程/会话对应的 chatId",
        "--text": "原始输入文本",
      },
      optional: {
        "--transport": "来源通道，默认 web",
        "--sender": "发送者 handle",
        "--sender-name": "发送者显示名",
        "--message-id": "显式消息 ID；默认自动生成",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      workspacePath: "工作区绝对路径",
      chatId: "目标 chatId",
      messageId: "本次投递消息 ID",
      requestNumber: "inbox 请求号",
      state: "当前状态（new）",
      transport: "来源通道",
      filePath: "inbox 文件路径",
    },
    errorCodes: [
      INBOX_ERROR_CODES.WORKSPACE_MISSING,
      INBOX_ERROR_CODES.CHAT_ID_MISSING,
      INBOX_ERROR_CODES.TEXT_MISSING,
      INBOX_ERROR_CODES.TRANSPORT_INVALID,
      INBOX_ERROR_CODES.ADD_FAILED,
    ],
  };
}

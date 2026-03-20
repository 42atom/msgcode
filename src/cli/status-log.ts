import { existsSync } from "node:fs";
import { Command } from "commander";
import type { Diagnostic } from "../memory/types.js";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import {
  appendWorkspaceStatus,
  getWorkspaceStatusLogPath,
  readWorkspaceStatusTail,
  type WorkspaceStatusKind,
} from "../runtime/status-log.js";

const STATUS_LOG_ERROR_CODES = {
  WORKSPACE_MISSING: "STATUS_LOG_WORKSPACE_MISSING",
  ADD_FAILED: "STATUS_LOG_ADD_FAILED",
  TAIL_FAILED: "STATUS_LOG_TAIL_FAILED",
  KIND_INVALID: "STATUS_LOG_KIND_INVALID",
} as const;

type StatusLogErrorCode = typeof STATUS_LOG_ERROR_CODES[keyof typeof STATUS_LOG_ERROR_CODES];

function createStatusLogDiagnostic(
  code: StatusLogErrorCode,
  message: string,
  hint?: string,
  details?: Record<string, unknown>
): Diagnostic {
  return { code, message, hint, details };
}

function normalizeStatusKind(value: string): WorkspaceStatusKind {
  if (value === "decision" || value === "state") {
    return value;
  }
  throw new Error("status.log kind 只允许 decision 或 state");
}

function getWorkspaceOrFail(
  workspace: string,
  errors: Diagnostic[],
  input: string
): string | null {
  const workspacePath = getWorkspacePath(workspace);
  if (existsSync(workspacePath)) {
    return workspacePath;
  }

  errors.push(
    createStatusLogDiagnostic(
      STATUS_LOG_ERROR_CODES.WORKSPACE_MISSING,
      "工作区不存在",
      "先初始化 workspace，或传绝对路径",
      { workspacePath, input }
    )
  );
  return null;
}

export function createStatusLogAddCommand(): Command {
  const cmd = new Command("add");

  cmd
    .description("向当前工作区 status.log 追加一条共享状态")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .requiredOption("--thread <name>", "线程名")
    .requiredOption("--kind <decision|state>", "记录类型")
    .requiredOption("--summary <text>", "一行状态摘要")
    .requiredOption("--ref-path <path>", "工作区内原文相对路径或绝对路径")
    .requiredOption("--ref-line <n>", "原文行号")
    .option("--json", "JSON 格式输出")
    .action(async (options: {
      workspace: string;
      thread: string;
      kind: string;
      summary: string;
      refPath: string;
      refLine: string;
      json?: boolean;
    }) => {
      const startTime = Date.now();
      const command = `msgcode status-log add --workspace ${options.workspace}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      const workspacePath = getWorkspaceOrFail(options.workspace, errors, options.workspace);
      if (!workspacePath) {
        const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
        return;
      }

      try {
        const kind = normalizeStatusKind(options.kind);
        const refLine = Number.parseInt(options.refLine, 10);
        const result = appendWorkspaceStatus({
          workspacePath,
          thread: options.thread,
          kind,
          summary: options.summary,
          refPath: options.refPath,
          refLine,
        });

        const envelope = createEnvelope(command, startTime, "pass", {
          workspacePath,
          filePath: result.filePath,
          written: result.written,
          record: result.record,
        }, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = message.includes("kind")
          ? STATUS_LOG_ERROR_CODES.KIND_INVALID
          : STATUS_LOG_ERROR_CODES.ADD_FAILED;
        errors.push(
          createStatusLogDiagnostic(
            code,
            `status.log 追加失败: ${message}`,
            "检查 kind / summary / refPath / refLine 输入",
            { workspacePath }
          )
        );
        const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }
    });

  return cmd;
}

export function createStatusLogTailCommand(): Command {
  const cmd = new Command("tail");

  cmd
    .description("读取当前工作区 status.log 最近几条")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const command = `msgcode status-log tail --workspace ${options.workspace}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      const workspacePath = getWorkspaceOrFail(options.workspace, errors, options.workspace);
      if (!workspacePath) {
        const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
        return;
      }

      try {
        const entries = readWorkspaceStatusTail({ workspacePath });
        const envelope = createEnvelope(command, startTime, "pass", {
          workspacePath,
          filePath: getWorkspaceStatusLogPath(workspacePath),
          updatedAt: entries[0]?.timestamp ?? "",
          count: entries.length,
          entries,
        }, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(
          createStatusLogDiagnostic(
            STATUS_LOG_ERROR_CODES.TAIL_FAILED,
            `status.log 读取失败: ${message}`,
            "检查 status.log 文件是否可读",
            { workspacePath }
          )
        );
        const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }
    });

  return cmd;
}

export function createStatusLogCommand(): Command {
  const cmd = new Command("status-log");
  cmd.description("工作区共享工作状况日志");
  cmd.addCommand(createStatusLogAddCommand());
  cmd.addCommand(createStatusLogTailCommand());
  return cmd;
}

export function getStatusLogAddContract() {
  return {
    name: "msgcode status-log add",
    description: "向当前工作区 status.log 追加一条共享状态",
    options: {
      required: {
        "--workspace": "Workspace 相对路径或绝对路径",
        "--thread": "线程名",
        "--kind": "记录类型（decision|state）",
        "--summary": "一行状态摘要",
        "--ref-path": "工作区内原文相对路径或绝对路径",
        "--ref-line": "原文行号",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      workspacePath: "工作区绝对路径",
      filePath: "status.log 路径",
      written: "是否成功追加",
      record: "统一格式化后的单行记录",
    },
    errorCodes: [
      STATUS_LOG_ERROR_CODES.WORKSPACE_MISSING,
      STATUS_LOG_ERROR_CODES.KIND_INVALID,
      STATUS_LOG_ERROR_CODES.ADD_FAILED,
    ],
  };
}

export function getStatusLogTailContract() {
  return {
    name: "msgcode status-log tail",
    description: "读取当前工作区 status.log 最近几条",
    options: {
      required: {
        "--workspace": "Workspace 相对路径或绝对路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      workspacePath: "工作区绝对路径",
      filePath: "status.log 路径",
      updatedAt: "最近一条状态时间",
      count: "返回条数",
      entries: "最近几条状态记录",
    },
    errorCodes: [
      STATUS_LOG_ERROR_CODES.WORKSPACE_MISSING,
      STATUS_LOG_ERROR_CODES.TAIL_FAILED,
    ],
  };
}

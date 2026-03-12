/**
 * msgcode: Subagent CLI 命令
 *
 * 职责：
 * - 提供 codex / claude-code 子代理正式合同
 * - 直接复用 runtime/subagent.ts，不新造控制面
 */

import { Command } from "commander";
import type { Diagnostic } from "../memory/types.js";
import { createEnvelope } from "./command-runner.js";
import {
  SUBAGENT_ERROR_CODES,
  SubagentRuntimeError,
  getSubagentTaskStatus,
  listSubagentTasks,
  runSubagentTask,
  stopSubagentTask,
} from "../runtime/subagent.js";

function createSubagentDiagnostic(code: string, message: string, details?: Record<string, unknown>): Diagnostic {
  const diagnostic: Diagnostic = { code, message };
  if (details) {
    diagnostic.details = details;
  }
  return diagnostic;
}

function formatRunText(data: {
  taskId: string;
  client: string;
  status: string;
  workspacePath: string;
  sessionName: string;
  taskFile: string;
  startupMessage?: string;
  response?: string;
}): string {
  const lines = [
    `taskId: ${data.taskId}`,
    `client: ${data.client}`,
    `status: ${data.status}`,
    `workspace: ${data.workspacePath}`,
    `session: ${data.sessionName}`,
    `taskFile: ${data.taskFile}`,
  ];
  if (data.startupMessage) {
    lines.push("", data.startupMessage);
  }
  if (data.response) {
    lines.push("", "response:", data.response);
  }
  return lines.join("\n");
}

function formatStatusText(data: {
  taskId: string;
  client: string;
  status: string;
  workspacePath: string;
  sessionName: string;
  taskFile: string;
  paneTail?: string;
}): string {
  const lines = [
    `taskId: ${data.taskId}`,
    `client: ${data.client}`,
    `status: ${data.status}`,
    `workspace: ${data.workspacePath}`,
    `session: ${data.sessionName}`,
    `taskFile: ${data.taskFile}`,
  ];
  if (data.paneTail) {
    lines.push("", "paneTail:", data.paneTail);
  }
  return lines.join("\n");
}

function formatListText(data: {
  workspacePath: string;
  tasks: Array<{
    taskId: string;
    client: string;
    status: string;
    updatedAt: string;
    taskFile: string;
    goal: string;
  }>;
}): string {
  const lines = [`workspace: ${data.workspacePath}`, `count: ${data.tasks.length}`];
  for (const task of data.tasks) {
    lines.push(
      "",
      `taskId: ${task.taskId}`,
      `client: ${task.client}`,
      `status: ${task.status}`,
      `updatedAt: ${task.updatedAt}`,
      `taskFile: ${task.taskFile}`,
      `goal: ${task.goal}`,
    );
  }
  return lines.join("\n");
}

function resolveErrorCode(error: unknown, fallback: string): string {
  if (error instanceof SubagentRuntimeError) {
    return error.code;
  }
  return fallback;
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createSubagentRunCommand(): Command {
  const cmd = new Command("run");

  cmd
    .description("启动子代理任务（codex|claude-code）")
    .argument("<client>", "子代理执行臂：codex | claude-code")
    .requiredOption("--goal <text>", "子任务目标")
    .option("--workspace <id|path>", "工作目录（默认当前 cwd）")
    .option("--watch", "阻塞等待子代理完成")
    .option("--timeout-ms <ms>", "watch 超时（毫秒）")
    .option("--json", "JSON 格式输出")
    .action(async (client: string, options) => {
      const startTime = Date.now();
      const command = "msgcode subagent run";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const result = await runSubagentTask({
          client,
          goal: options.goal,
          workspace: options.workspace,
          watch: options.watch === true,
          timeoutMs: options.timeoutMs ? Number(options.timeoutMs) : undefined,
        });
        const data = {
          taskId: result.task.taskId,
          client: result.task.client,
          status: result.task.status,
          workspacePath: result.task.workspacePath,
          sessionName: result.task.sessionName,
          taskFile: result.task.taskFile,
          startupMessage: result.startupMessage,
          response: result.watchResult?.response,
        };
        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(formatRunText(data));
        }
        process.exit(0);
      } catch (error) {
        const message = resolveErrorMessage(error);
        const code = resolveErrorCode(error, SUBAGENT_ERROR_CODES.DELEGATE_FAILED);
        errors.push(createSubagentDiagnostic(code, message, {
          client,
          workspace: options.workspace ?? process.cwd(),
        }));
        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`${code}: ${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

export function createSubagentStatusCommand(): Command {
  const cmd = new Command("status");

  cmd
    .description("查看子代理任务状态")
    .argument("<task-id>", "taskId")
    .option("--workspace <id|path>", "工作目录（默认当前 cwd）")
    .option("--json", "JSON 格式输出")
    .action(async (taskId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode subagent status";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const result = await getSubagentTaskStatus({
          taskId,
          workspace: options.workspace,
        });
        const data = {
          taskId: result.task.taskId,
          client: result.task.client,
          status: result.task.status,
          workspacePath: result.task.workspacePath,
          sessionName: result.task.sessionName,
          taskFile: result.task.taskFile,
          paneTail: result.paneTail,
        };
        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(formatStatusText(data));
        }
        process.exit(0);
      } catch (error) {
        const message = resolveErrorMessage(error);
        const code = resolveErrorCode(error, SUBAGENT_ERROR_CODES.TASK_NOT_FOUND);
        errors.push(createSubagentDiagnostic(code, message, {
          taskId,
          workspace: options.workspace ?? process.cwd(),
        }));
        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`${code}: ${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

export function createSubagentListCommand(): Command {
  const cmd = new Command("list");

  cmd
    .description("列出当前 workspace 的子代理任务")
    .option("--workspace <id|path>", "工作目录（默认当前 cwd）")
    .option("--client <client>", "按执行臂过滤：codex | claude-code")
    .option("--status <status>", "按任务状态过滤：running|completed|failed|stopped")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode subagent list";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const result = await listSubagentTasks({
          workspace: options.workspace,
          client: options.client,
          status: options.status,
        });
        const data = {
          workspacePath: result.workspacePath,
          tasks: result.tasks.map((task) => ({
            taskId: task.taskId,
            client: task.client,
            status: task.status,
            updatedAt: task.updatedAt,
            taskFile: task.taskFile,
            goal: task.goal,
          })),
        };
        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(formatListText(data));
        }
        process.exit(0);
      } catch (error) {
        const message = resolveErrorMessage(error);
        const code = resolveErrorCode(error, SUBAGENT_ERROR_CODES.INVALID_CLIENT);
        errors.push(createSubagentDiagnostic(code, message, {
          workspace: options.workspace ?? process.cwd(),
          client: options.client,
          status: options.status,
        }));
        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`${code}: ${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

export function createSubagentStopCommand(): Command {
  const cmd = new Command("stop");

  cmd
    .description("停止当前子代理任务")
    .argument("<task-id>", "taskId")
    .option("--workspace <id|path>", "工作目录（默认当前 cwd）")
    .option("--json", "JSON 格式输出")
    .action(async (taskId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode subagent stop";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const result = await stopSubagentTask({
          taskId,
          workspace: options.workspace,
        });
        const data = {
          taskId: result.task.taskId,
          client: result.task.client,
          status: result.task.status,
          workspacePath: result.task.workspacePath,
          sessionName: result.task.sessionName,
          taskFile: result.task.taskFile,
          paneTail: result.paneTail,
        };
        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(formatStatusText(data));
        }
        process.exit(0);
      } catch (error) {
        const message = resolveErrorMessage(error);
        const code = resolveErrorCode(error, SUBAGENT_ERROR_CODES.STOP_FAILED);
        errors.push(createSubagentDiagnostic(code, message, {
          taskId,
          workspace: options.workspace ?? process.cwd(),
        }));
        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`${code}: ${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

export function createSubagentCommand(): Command {
  const cmd = new Command("subagent");

  cmd.description("子代理执行臂（codex / claude-code）");
  cmd.addCommand(createSubagentRunCommand());
  cmd.addCommand(createSubagentListCommand());
  cmd.addCommand(createSubagentStatusCommand());
  cmd.addCommand(createSubagentStopCommand());

  return cmd;
}

export function getSubagentRunContract() {
  return {
    name: "msgcode subagent run",
    description: "启动子代理任务并可选 watch 到完成",
    options: {
      required: {
        "<client>": "codex | claude-code",
        "--goal": "子任务目标",
      },
      optional: {
        "--workspace": "工作目录（默认当前 cwd）",
        "--watch": "阻塞等待子代理完成",
        "--timeout-ms": "watch 超时（毫秒）",
        "--json": "JSON 格式输出",
      },
    },
    errorCodes: [
      SUBAGENT_ERROR_CODES.INVALID_CLIENT,
      SUBAGENT_ERROR_CODES.BUSY,
      SUBAGENT_ERROR_CODES.START_FAILED,
      SUBAGENT_ERROR_CODES.DELEGATE_FAILED,
    ],
  };
}

export function getSubagentStatusContract() {
  return {
    name: "msgcode subagent status",
    description: "查看子代理任务状态与 paneTail",
    options: {
      required: {
        "<task-id>": "taskId",
      },
      optional: {
        "--workspace": "工作目录（默认当前 cwd）",
        "--json": "JSON 格式输出",
      },
    },
    errorCodes: [
      SUBAGENT_ERROR_CODES.TASK_NOT_FOUND,
    ],
  };
}

export function getSubagentListContract() {
  return {
    name: "msgcode subagent list",
    description: "列出当前 workspace 的子代理任务",
    options: {
      optional: {
        "--workspace": "工作目录（默认当前 cwd）",
        "--client": "按执行臂过滤：codex | claude-code",
        "--status": "按状态过滤：running|completed|failed|stopped",
        "--json": "JSON 格式输出",
      },
    },
    errorCodes: [
      SUBAGENT_ERROR_CODES.INVALID_CLIENT,
    ],
  };
}

export function getSubagentStopContract() {
  return {
    name: "msgcode subagent stop",
    description: "向子代理会话发送 ESC 并标记任务停止",
    options: {
      required: {
        "<task-id>": "taskId",
      },
      optional: {
        "--workspace": "工作目录（默认当前 cwd）",
        "--json": "JSON 格式输出",
      },
    },
    errorCodes: [
      SUBAGENT_ERROR_CODES.TASK_NOT_FOUND,
      SUBAGENT_ERROR_CODES.STOP_FAILED,
    ],
  };
}

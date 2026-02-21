/**
 * msgcode: Todo CLI 命令
 *
 * 职责：
 * - msgcode todo add <title> --workspace <id|path>
 * - msgcode todo list --workspace <id|path>
 * - msgcode todo done <taskId> --workspace <id|path>
 *
 * 存储：workspace 本地 todo.db
 */

import { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { Diagnostic } from "../memory/types.js";
import { parseWorkspaceParam } from "../memory/types.js";
import { getWorkspaceRootForDisplay } from "../routes/store.js";
import { createEnvelope } from "./command-runner.js";
import { randomUUID } from "node:crypto";

// ============================================
// 错误码定义
// ============================================

export const TODO_ERROR_CODES = {
  EMPTY_TITLE: "TODO_EMPTY_TITLE",
  NOT_FOUND: "TODO_NOT_FOUND",
  ADD_FAILED: "TODO_ADD_FAILED",
  LIST_FAILED: "TODO_LIST_FAILED",
  DONE_FAILED: "TODO_DONE_FAILED",
  WORKSPACE_NOT_FOUND: "TODO_WORKSPACE_NOT_FOUND",
} as const;

// ============================================
// 类型定义
// ============================================

interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "done";
  createdAt: string;
  doneAt: string | null;
}

// ============================================
// 辅助函数
// ============================================

/**
 * 解析 workspace 参数为绝对路径
 */
async function resolveWorkspacePathParam(input: string): Promise<string> {
  const param = parseWorkspaceParam(input);

  if (param.kind === "id") {
    const { getRouteByChatId } = await import("../routes/store.js");
    const route = getRouteByChatId(param.value);
    if (!route) {
      throw new Error(TODO_ERROR_CODES.WORKSPACE_NOT_FOUND);
    }
    return route.workspacePath;
  } else {
    const workspaceRoot = getWorkspaceRootForDisplay();
    const resolved = path.resolve(workspaceRoot, param.value);

    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("PATH_TRAVERSAL");
    }

    return resolved;
  }
}

/**
 * 创建 Todo 诊断信息
 */
function createTodoDiagnostic(
  code: string,
  message: string,
  hint?: string,
  details?: Record<string, unknown>
): Diagnostic {
  const diag: Diagnostic = {
    code,
    message,
  };
  if (hint) {
    diag.hint = hint;
  }
  if (details) {
    diag.details = details;
  }
  return diag;
}

/**
 * 获取 todo.db 路径
 */
function getTodoDbPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "todo.db");
}

/**
 * 初始化数据库
 */
function initTodoDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT NOT NULL,
      doneAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_status ON todos(status);
  `);
}

/**
 * 打开数据库连接
 */
function openTodoDb(workspacePath: string): Database.Database {
  const dbPath = getTodoDbPath(workspacePath);
  const dir = path.dirname(dbPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  initTodoDb(db);

  return db;
}

// ============================================
// 命令实现
// ============================================

/**
 * add 命令 - 添加 todo
 */
export function createTodoAddCommand(): Command {
  const cmd = new Command("add");

  cmd
    .description("添加待办事项")
    .argument("<title>", "待办事项标题")
    .requiredOption("--workspace <id|path>", "Workspace ID 或相对路径")
    .option("--json", "JSON 格式输出")
    .action(async (title: string, options) => {
      const startTime = Date.now();
      const command = "msgcode todo add";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // P5.7-R5-1: 空标题校验
        if (!title || title.trim() === "") {
          errors.push(
            createTodoDiagnostic(
              TODO_ERROR_CODES.EMPTY_TITLE,
              "待办事项标题不能为空",
              "请提供非空的待办事项标题"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 待办事项标题不能为空");
          }
          process.exit(1);
          return;
        }

        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        // 打开数据库
        const db = openTodoDb(workspacePath);

        // 创建 todo
        const todoId = randomUUID();
        const createdAt = new Date().toISOString();

        const stmt = db.prepare(`
          INSERT INTO todos (id, title, status, createdAt, doneAt)
          VALUES (?, ?, 'pending', ?, NULL)
        `);

        stmt.run(todoId, title.trim(), createdAt);
        db.close();

        const data = {
          taskId: todoId,
          title: title.trim(),
          createdAt,
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已添加待办: ${todoId}`);
          console.log(`  标题: ${title.trim()}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === TODO_ERROR_CODES.WORKSPACE_NOT_FOUND) {
          errors.push(
            createTodoDiagnostic(
              TODO_ERROR_CODES.WORKSPACE_NOT_FOUND,
              `Workspace 不存在: ${options.workspace}`,
              "使用 msgcode routes list 查看可用的 workspace"
            )
          );
        } else {
          errors.push(
            createTodoDiagnostic(
              TODO_ERROR_CODES.ADD_FAILED,
              `添加待办失败: ${message}`,
              undefined,
              { workspace: options.workspace, titleLength: title.length }
            )
          );
        }

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * list 命令 - 列出 todos
 */
export function createTodoListCommand(): Command {
  const cmd = new Command("list");

  cmd
    .description("列出待办事项")
    .requiredOption("--workspace <id|path>", "Workspace ID 或相对路径")
    .option("--status <status>", "筛选状态（pending/done）")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode todo list";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        // 打开数据库
        const db = openTodoDb(workspacePath);

        // 查询 todos
        let sql = "SELECT * FROM todos";
        const params: string[] = [];

        if (options.status) {
          sql += " WHERE status = ?";
          params.push(options.status);
        }

        sql += " ORDER BY createdAt DESC";

        const stmt = db.prepare(sql);
        const rows = stmt.all(...params) as TodoItem[];

        db.close();

        const data = {
          count: rows.length,
          items: rows,
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          if (rows.length === 0) {
            console.log("暂无待办事项");
          } else {
            console.log(`待办事项 (${rows.length}):`);
            for (const row of rows) {
              const statusIcon = row.status === "done" ? "[x]" : "[ ]";
              console.log(`  ${statusIcon} ${row.id.slice(0, 8)}... ${row.title}`);
            }
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === TODO_ERROR_CODES.WORKSPACE_NOT_FOUND) {
          errors.push(
            createTodoDiagnostic(
              TODO_ERROR_CODES.WORKSPACE_NOT_FOUND,
              `Workspace 不存在: ${options.workspace}`,
              "使用 msgcode routes list 查看可用的 workspace"
            )
          );
        } else {
          errors.push(
            createTodoDiagnostic(
              TODO_ERROR_CODES.LIST_FAILED,
              `列出待办失败: ${message}`,
              undefined,
              { workspace: options.workspace }
            )
          );
        }

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * done 命令 - 完成 todo
 */
export function createTodoDoneCommand(): Command {
  const cmd = new Command("done");

  cmd
    .description("完成待办事项")
    .argument("<taskId>", "待办事项 ID")
    .requiredOption("--workspace <id|path>", "Workspace ID 或相对路径")
    .option("--json", "JSON 格式输出")
    .action(async (taskId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode todo done";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        // 打开数据库
        const db = openTodoDb(workspacePath);

        // 检查 todo 是否存在
        const checkStmt = db.prepare("SELECT * FROM todos WHERE id = ?");
        const existing = checkStmt.get(taskId) as TodoItem | undefined;

        if (!existing) {
          db.close();
          errors.push(
            createTodoDiagnostic(
              TODO_ERROR_CODES.NOT_FOUND,
              `待办事项不存在: ${taskId}`,
              "使用 msgcode todo list 查看所有待办事项"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: 待办事项不存在 (${taskId})`);
          }
          process.exit(1);
          return;
        }

        // 更新状态
        const doneAt = new Date().toISOString();
        const updateStmt = db.prepare(`
          UPDATE todos SET status = 'done', doneAt = ? WHERE id = ?
        `);
        updateStmt.run(doneAt, taskId);

        db.close();

        const data = {
          taskId,
          doneAt,
          status: "done",
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已完成待办: ${taskId}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === TODO_ERROR_CODES.WORKSPACE_NOT_FOUND) {
          errors.push(
            createTodoDiagnostic(
              TODO_ERROR_CODES.WORKSPACE_NOT_FOUND,
              `Workspace 不存在: ${options.workspace}`,
              "使用 msgcode routes list 查看可用的 workspace"
            )
          );
        } else {
          errors.push(
            createTodoDiagnostic(
              TODO_ERROR_CODES.DONE_FAILED,
              `完成待办失败: ${message}`,
              undefined,
              { workspace: options.workspace, taskId }
            )
          );
        }

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// Todo 命令组
// ============================================

export function createTodoCommand(): Command {
  const cmd = new Command("todo");

  cmd.description("Todo 待办管理");

  cmd.addCommand(createTodoAddCommand());
  cmd.addCommand(createTodoListCommand());
  cmd.addCommand(createTodoDoneCommand());

  return cmd;
}

// ============================================
// 合同导出（help-docs 使用）
// ============================================

/**
 * 获取 todo add 命令合同
 */
export function getTodoAddContract() {
  return {
    name: "msgcode todo add",
    description: "添加待办事项",
    options: {
      required: {
        "--workspace": "Workspace ID 或相对路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      taskId: "待办事项 ID",
      title: "待办事项标题",
      createdAt: "创建时间（ISO 8601）",
    },
    errorCodes: [
      "TODO_EMPTY_TITLE",
      "TODO_WORKSPACE_NOT_FOUND",
      "TODO_ADD_FAILED",
    ],
  };
}

/**
 * 获取 todo list 命令合同
 */
export function getTodoListContract() {
  return {
    name: "msgcode todo list",
    description: "列出待办事项",
    options: {
      required: {
        "--workspace": "Workspace ID 或相对路径",
      },
      optional: {
        "--status": "筛选状态（pending/done）",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      count: "待办事项数量",
      items: "待办事项列表",
    },
    errorCodes: [
      "TODO_WORKSPACE_NOT_FOUND",
      "TODO_LIST_FAILED",
    ],
  };
}

/**
 * 获取 todo done 命令合同
 */
export function getTodoDoneContract() {
  return {
    name: "msgcode todo done",
    description: "完成待办事项",
    options: {
      required: {
        "--workspace": "Workspace ID 或相对路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      taskId: "待办事项 ID",
      doneAt: "完成时间（ISO 8601）",
      status: "状态（done）",
    },
    errorCodes: [
      "TODO_NOT_FOUND",
      "TODO_WORKSPACE_NOT_FOUND",
      "TODO_DONE_FAILED",
    ],
  };
}

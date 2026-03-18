/**
 * msgcode: Todo CLI 命令
 *
 * 职责：
 * - msgcode todo add <title> --workspace <id|path>
 * - msgcode todo list --workspace <id|path>
 * - msgcode todo done <taskId> --workspace <id|path>
 *
 * 存储：workspace 本地 .msgcode/todo.json
 */

import { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Diagnostic } from "../memory/types.js";
import { parseWorkspaceParam } from "../memory/types.js";
import { getWorkspaceRootForDisplay } from "../routes/store.js";
import { createEnvelope } from "./command-runner.js";
import { randomUUID } from "node:crypto";
import { loadBetterSqlite3 } from "../deps/better-sqlite3.js";

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

interface TodoStateFile {
  version: 1;
  updatedAt: string;
  items: TodoItem[];
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
    if (path.isAbsolute(param.value)) {
      return path.resolve(param.value);
    }

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
 * 获取 todo.json 路径
 */
function getTodoJsonPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "todo.json");
}

/**
 * 获取历史 todo.db 路径
 */
function getTodoDbPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "todo.db");
}

/**
 * 原子写 todo.json
 */
function writeTodoStateAtomic(workspacePath: string, state: TodoStateFile): void {
  const todoPath = getTodoJsonPath(workspacePath);
  const dir = path.dirname(todoPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${todoPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tempPath, todoPath);
}

function createEmptyTodoState(): TodoStateFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

async function importLegacyTodoDb(workspacePath: string): Promise<TodoStateFile | null> {
  const dbPath = getTodoDbPath(workspacePath);
  if (!existsSync(dbPath)) {
    return null;
  }

  const Database = loadBetterSqlite3();
  const db = new Database(dbPath, { readonly: true });

  try {
    const table = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='todos'
    `).get() as { name?: string } | undefined;

    if (!table?.name) {
      return createEmptyTodoState();
    }

    const rows = db.prepare(`
      SELECT id, title, status, createdAt, doneAt
      FROM todos
      ORDER BY createdAt DESC
    `).all() as TodoItem[];

    const state: TodoStateFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status === "done" ? "done" : "pending",
        createdAt: row.createdAt,
        doneAt: row.doneAt ?? null,
      })),
    };

    writeTodoStateAtomic(workspacePath, state);
    renameSync(dbPath, `${dbPath}.legacy.bak`);
    return state;
  } finally {
    db.close();
  }
}

async function loadTodoState(workspacePath: string): Promise<TodoStateFile> {
  const todoPath = getTodoJsonPath(workspacePath);
  if (existsSync(todoPath)) {
    const parsed = JSON.parse(readFileSync(todoPath, "utf8")) as TodoStateFile;
    return {
      version: 1,
      updatedAt: parsed.updatedAt,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  }

  const migrated = await importLegacyTodoDb(workspacePath);
  if (migrated) {
    return migrated;
  }

  const empty = createEmptyTodoState();
  writeTodoStateAtomic(workspacePath, empty);
  return empty;
}

function saveTodoState(workspacePath: string, items: TodoItem[]): TodoStateFile {
  const state: TodoStateFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items,
  };
  writeTodoStateAtomic(workspacePath, state);
  return state;
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
    .requiredOption("--workspace <id|path>", "Workspace ID、相对路径或绝对路径")
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

        const state = await loadTodoState(workspacePath);
        const todoId = randomUUID();
        const createdAt = new Date().toISOString();
        const item: TodoItem = {
          id: todoId,
          title: title.trim(),
          status: "pending",
          createdAt,
          doneAt: null,
        };
        saveTodoState(workspacePath, [item, ...state.items]);

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
              "使用 msgcode thread list 查看可用的 workspace"
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
    .requiredOption("--workspace <id|path>", "Workspace ID、相对路径或绝对路径")
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

        const state = await loadTodoState(workspacePath);
        const rows = options.status
          ? state.items.filter((item) => item.status === options.status)
          : state.items;

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
              "使用 msgcode thread list 查看可用的 workspace"
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
    .requiredOption("--workspace <id|path>", "Workspace ID、相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (taskId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode todo done";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        const state = await loadTodoState(workspacePath);
        const existing = state.items.find((item) => item.id === taskId);

        if (!existing) {
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
        const items = state.items.map((item) =>
          item.id === taskId
            ? { ...item, status: "done" as const, doneAt }
            : item
        );
        saveTodoState(workspacePath, items);

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
              "使用 msgcode thread list 查看可用的 workspace"
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
        "--workspace": "Workspace ID、相对路径或绝对路径",
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
        "--workspace": "Workspace ID、相对路径或绝对路径",
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
        "--workspace": "Workspace ID、相对路径或绝对路径",
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

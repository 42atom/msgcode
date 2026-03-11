/**
 * msgcode: Thread CLI 命令
 *
 * 对齐 spec: P5.7-R4-2 thread 命令与 active 强确认
 * CLI Contract: AIDOCS/msgcode-2.1/cli_contract_v2.1.md
 *
 * 命令：
 * - msgcode thread list
 * - msgcode thread messages <thread-id>
 * - msgcode thread active
 * - msgcode thread switch <thread-id>
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Diagnostic } from "../memory/types.js";
import { loadRoutes, getRouteByChatId, type RouteEntry } from "../routes/store.js";
import { createEnvelope } from "./command-runner.js";

// ============================================
// 常量
// ============================================

/** 活动线程存储文件路径 */
function getActiveThreadFilePath(): string {
  return process.env.ACTIVE_THREAD_FILE || path.join(os.homedir(), ".config/msgcode/active_thread.json");
}

// ============================================
// 错误码
// ============================================

export const THREAD_ERROR_CODES = {
  THREAD_NOT_FOUND: "THREAD_NOT_FOUND",
  NO_ACTIVE_THREAD: "THREAD_NO_ACTIVE_THREAD",
  THREAD_SWITCH_FAILED: "THREAD_SWITCH_FAILED",
  THREAD_LIST_FAILED: "THREAD_LIST_FAILED",
  THREAD_MESSAGES_FAILED: "THREAD_MESSAGES_FAILED",
  THREAD_ACTIVE_FAILED: "THREAD_ACTIVE_FAILED",
} as const;

export type ThreadErrorCode = typeof THREAD_ERROR_CODES[keyof typeof THREAD_ERROR_CODES];

/**
 * 创建 Thread 错误的 Diagnostic
 */
function createThreadDiagnostic(
  code: ThreadErrorCode,
  message: string,
  hint?: string,
  details?: Record<string, unknown>
): Diagnostic {
  return { code, message, hint, details };
}

// ============================================
// 活动线程存储
// ============================================

interface ActiveThreadData {
  threadId: string;
  switchedAt: string;
}

/**
 * 获取活动线程
 */
function getActiveThread(): ActiveThreadData | null {
  const filePath = getActiveThreadFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as ActiveThreadData;
  } catch {
    return null;
  }
}

/**
 * 设置活动线程
 */
function setActiveThread(threadId: string): ActiveThreadData {
  const data: ActiveThreadData = {
    threadId,
    switchedAt: new Date().toISOString(),
  };

  const filePath = getActiveThreadFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return data;
}

// ============================================
// 命令实现
// ============================================

/**
 * list 命令
 */
export function createThreadListCommand(): Command {
  const cmd = new Command("list");

  cmd
    .description("列出所有线程（routes）")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode thread list";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const data = loadRoutes();
        const threads = Object.values(data.routes).map((entry) => ({
          threadId: entry.chatGuid,
          label: entry.label || entry.workspacePath,
          workspacePath: entry.workspacePath,
          status: entry.status,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        }));

        const result = {
          count: threads.length,
          threads,
        };

        const envelope = createEnvelope(command, startTime, "pass", result, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`共 ${threads.length} 个线程:`);
          for (const t of threads) {
            console.log(`  - ${t.threadId.slice(-8)}: ${t.label} (${t.status})`);
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createThreadDiagnostic(
            THREAD_ERROR_CODES.THREAD_LIST_FAILED,
            `列出线程失败: ${message}`
          )
        );

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
 * messages 命令
 */
export function createThreadMessagesCommand(): Command {
  const cmd = new Command("messages");

  cmd
    .description("获取线程消息")
    .argument("<thread-id>", "线程 ID")
    .option("--limit <n>", "返回消息数量", "20")
    .option("--json", "JSON 格式输出")
    .action(async (threadId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode thread messages";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 查找线程
        const route = getRouteByChatId(threadId);
        if (!route) {
          errors.push(
            createThreadDiagnostic(
              THREAD_ERROR_CODES.THREAD_NOT_FOUND,
              `线程不存在: ${threadId}`,
              "使用 msgcode thread list 查看可用线程"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 线程不存在");
          }
          process.exit(1);
          return;
        }

        const limit = parseInt(options.limit, 10);

        // 读取消息文件（如果存在）
        const messagesPath = path.join(route.workspacePath, "messages.json");
        let messages: Array<unknown> = [];

        if (fs.existsSync(messagesPath)) {
          try {
            const content = fs.readFileSync(messagesPath, "utf8");
            const data = JSON.parse(content);
            messages = (data.messages || []).slice(-limit);
          } catch {
            // 文件损坏，返回空数组
          }
        }

        const result = {
          threadId: route.chatGuid,
          threadTitle: route.label,
          workspacePath: route.workspacePath,
          count: messages.length,
          messages,
        };

        const envelope = createEnvelope(command, startTime, "pass", result, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`线程 ${route.label || route.chatGuid.slice(-8)}: ${messages.length} 条消息`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createThreadDiagnostic(
            THREAD_ERROR_CODES.THREAD_MESSAGES_FAILED,
            `获取消息失败: ${message}`
          )
        );

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
 * active 命令
 */
export function createThreadActiveCommand(): Command {
  const cmd = new Command("active");

  cmd
    .description("获取当前活动线程")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode thread active";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const activeData = getActiveThread();

        // P5.7-R4-2: 无活动线程时返回失败，不返回伪成功
        if (!activeData) {
          errors.push(
            createThreadDiagnostic(
              THREAD_ERROR_CODES.NO_ACTIVE_THREAD,
              "当前没有活动线程",
              "使用 msgcode thread switch <thread-id> 切换到指定线程"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 当前没有活动线程");
          }
          process.exit(1);
          return;
        }

        // 验证活动线程是否仍然存在
        const route = getRouteByChatId(activeData.threadId);
        if (!route) {
          errors.push(
            createThreadDiagnostic(
              THREAD_ERROR_CODES.THREAD_NOT_FOUND,
              `活动线程不存在: ${activeData.threadId}`,
              "该线程可能已被删除，请使用 msgcode thread switch 切换到其他线程"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 活动线程不存在");
          }
          process.exit(1);
          return;
        }

        const result = {
          activeThreadId: route.chatGuid,
          activeThreadTitle: route.label || route.workspacePath,
          workspacePath: route.workspacePath,
          status: route.status,
          switchedAt: activeData.switchedAt,
        };

        const envelope = createEnvelope(command, startTime, "pass", result, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`当前活动线程:`);
          console.log(`  ID: ${route.chatGuid}`);
          console.log(`  标题: ${route.label || route.workspacePath}`);
          console.log(`  切换时间: ${activeData.switchedAt}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createThreadDiagnostic(
            THREAD_ERROR_CODES.THREAD_ACTIVE_FAILED,
            `获取活动线程失败: ${message}`
          )
        );

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
 * switch 命令
 */
export function createThreadSwitchCommand(): Command {
  const cmd = new Command("switch");

  cmd
    .description("切换到指定线程")
    .argument("<thread-id>", "线程 ID")
    .option("--json", "JSON 格式输出")
    .action(async (threadId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode thread switch";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // P5.7-R4-2: 切换到无效 thread id 必须失败
        const route = getRouteByChatId(threadId);
        if (!route) {
          errors.push(
            createThreadDiagnostic(
              THREAD_ERROR_CODES.THREAD_NOT_FOUND,
              `线程不存在: ${threadId}`,
              "使用 msgcode thread list 查看可用线程"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error("错误: 线程不存在");
          }
          process.exit(1);
          return;
        }

        // 设置活动线程
        const activeData = setActiveThread(route.chatGuid);

        // P5.7-R4-2: 成功必须返回 activeThreadId, activeThreadTitle, switchedAt
        const result = {
          activeThreadId: route.chatGuid,
          activeThreadTitle: route.label || route.workspacePath,
          workspacePath: route.workspacePath,
          status: route.status,
          switchedAt: activeData.switchedAt,
        };

        const envelope = createEnvelope(command, startTime, "pass", result, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已切换到线程: ${route.label || route.chatGuid.slice(-8)}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createThreadDiagnostic(
            THREAD_ERROR_CODES.THREAD_SWITCH_FAILED,
            `切换线程失败: ${message}`
          )
        );

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
// Thread 命令组
// ============================================

export function createThreadCommand(): Command {
  const cmd = new Command("thread");

  cmd.description("线程管理（会话切换）");

  cmd.addCommand(createThreadListCommand());
  cmd.addCommand(createThreadMessagesCommand());
  cmd.addCommand(createThreadActiveCommand());
  cmd.addCommand(createThreadSwitchCommand());

  return cmd;
}

// ============================================
// 合同导出（help-docs 使用）
// ============================================

/**
 * 获取 thread list 命令合同
 */
export function getThreadListContract() {
  return {
    name: "msgcode thread list",
    description: "列出所有线程",
    options: {
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      count: "线程数量",
      threads: "线程列表",
    },
    errorCodes: [
      "THREAD_LIST_FAILED",
    ],
  };
}

/**
 * 获取 thread messages 命令合同
 */
export function getThreadMessagesContract() {
  return {
    name: "msgcode thread messages",
    description: "获取线程消息",
    options: {
      required: {
        "<thread-id>": "线程 ID",
      },
      optional: {
        "--limit": "返回消息数量（默认 20）",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      threadId: "线程 ID",
      threadTitle: "线程标题",
      count: "消息数量",
      messages: "消息列表",
    },
    errorCodes: [
      "THREAD_NOT_FOUND",
      "THREAD_MESSAGES_FAILED",
    ],
  };
}

/**
 * 获取 thread active 命令合同
 */
export function getThreadActiveContract() {
  return {
    name: "msgcode thread active",
    description: "获取当前活动线程",
    options: {
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      activeThreadId: "活动线程 ID",
      activeThreadTitle: "活动线程标题",
      switchedAt: "切换时间",
    },
    errorCodes: [
      "THREAD_NO_ACTIVE_THREAD",
      "THREAD_NOT_FOUND",
      "THREAD_ACTIVE_FAILED",
    ],
  };
}

/**
 * 获取 thread switch 命令合同
 */
export function getThreadSwitchContract() {
  return {
    name: "msgcode thread switch",
    description: "切换到指定线程",
    options: {
      required: {
        "<thread-id>": "线程 ID",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      activeThreadId: "活动线程 ID",
      activeThreadTitle: "活动线程标题",
      switchedAt: "切换时间（ISO 8601）",
    },
    errorCodes: [
      "THREAD_NOT_FOUND",
      "THREAD_SWITCH_FAILED",
    ],
  };
}

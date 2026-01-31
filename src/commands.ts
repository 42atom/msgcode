/**
 * msgcode: CLI 命令实现（2.0）
 *
 * 原则：
 * - iMessage I/O 统一走 imsg RPC
 * - 无 iMessage SDK / 无 AppleScript
 * - start/stop 只解决真实问题，避免过度防御
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger/index.js";
import { config } from "./config.js";
import { ImsgRpcClient } from "./imsg/rpc-client.js";
import type { InboundMessage } from "./imsg/types.js";
import crypto from "node:crypto";

const execAsync = promisify(exec);

let imsgClient: ImsgRpcClient | null = null;
const perChatQueue = new Map<string, Promise<void>>();

async function keepAlive(): Promise<void> {
  await new Promise<void>(() => {});
}

async function killMsgcodeProcesses(): Promise<void> {
  const patterns = [
    "tsx.*src/index.ts",
    "tsx.*src/daemon.ts",
    "tsx.*src/cli.ts",
    "node.*tsx.*msgcode",
    "npm exec tsx src/index.ts",
  ];

  for (const pattern of patterns) {
    try {
      await execAsync(`pkill -9 -f '${pattern}'`);
    } catch {
      // ignore
    }
  }
}

async function killMsgcodeTmuxSessions(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`tmux list-sessions -F "#{session_name}" || true`);
    const sessions = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s.startsWith("msgcode-"));

    for (const s of sessions) {
      try {
        await execAsync(`tmux kill-session -t ${s}`);
      } catch {
        // ignore
      }
    }

    return sessions;
  } catch {
    return [];
  }
}

export async function startBot(): Promise<void> {
  logger.info("启动 msgcode", { module: "commands" });
  console.log("启动 msgcode...");

  imsgClient = new ImsgRpcClient(config.imsgPath);
  await imsgClient.start();

  // E14: 加载游标状态，使用 since_rowid 或 start 参数
  // rowid 全局递增，因此使用 max(lastSeenRowid) 即可避免历史积压
  const { loadState } = await import("./state/store.js");

  try {
    const state = loadState();
    const chatStates = Object.values(state.chats);

    if (chatStates.length > 0) {
      const maxRowid = chatStates.reduce((acc, s) => Math.max(acc, s.lastSeenRowid), 0);
      if (maxRowid > 0) {
        logger.info(`加载 ${chatStates.length} 个群组游标，使用最大 rowid: ${maxRowid}`, { module: "commands" });
        await imsgClient.subscribe({
          sinceRowid: maxRowid,
        });
      } else {
        // 有 state 但无有效游标：使用 start 窗口
        const startTime = new Date(Date.now() - 60000).toISOString();
        logger.info(`游标为空，使用 start 时间窗口: ${startTime}`, { module: "commands" });
        await imsgClient.subscribe({ start: startTime });
      }
    } else {
      // 无游标：使用 start 参数（最近 60 秒）
      const startTime = new Date(Date.now() - 60000).toISOString();
      logger.info(`无游标，使用 start 时间窗口: ${startTime}`, { module: "commands" });
      await imsgClient.subscribe({ start: startTime });
    }
  } catch (stateError) {
    // state.json 不存在或格式错误，回退到 start 窗口
    logger.warn(`无法加载游标状态: ${stateError instanceof Error ? stateError.message : String(stateError)}`, { module: "commands" });
    const startTime = new Date(Date.now() - 60000).toISOString();
    await imsgClient.subscribe({ start: startTime });
  }

  const { handleMessage } = await import("./listener.js");

  // 按 chat 串行处理消息，避免"回复错位/滞后一条"的乱序现象
  // 允许不同 chat 并行，但同一 chat 必须严格有序。
  // E16: 添加 DEBUG_TRACE 支持以追踪队列状态
  imsgClient.on("message", (message: InboundMessage) => {
    const chatKey = message.chatId;
    const prev = perChatQueue.get(chatKey) ?? Promise.resolve();
    const text = (message.text ?? "").trim();
    const textLength = text.length;
    const textDigest = text ? crypto.createHash("sha256").update(text).digest("hex").slice(0, 12) : "";

    // E16: trace 队列状态
    if (process.env.DEBUG_TRACE === "1") {
      const queueSize = perChatQueue.size;
      const hasPending = perChatQueue.has(chatKey);
      logger.debug("消息入队", {
        module: "commands",
        chatId: chatKey,
        rowid: message.rowid,
        queueSize,
        hasPending,
        textLength,
        textDigest,
        ...(process.env.DEBUG_TRACE_TEXT === "1" ? { textPreview: text.slice(0, 30) } : {}),
      });
    }

    const next = prev
      .catch(() => {
        // 上一个任务失败不应阻塞后续
        if (process.env.DEBUG_TRACE === "1") {
          logger.debug("队列前置任务失败，继续", {
            module: "commands",
            chatId: chatKey,
          });
        }
      })
      .then(async () => {
        if (process.env.DEBUG_TRACE === "1") {
          logger.debug("开始处理消息", {
            module: "commands",
            chatId: chatKey,
            rowid: message.rowid,
          });
        }
        await handleMessage(message, { imsgClient: imsgClient! });
      })
      .catch((error: unknown) => {
        logger.error("处理消息失败", {
          module: "commands",
          chatId: chatKey,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (perChatQueue.get(chatKey) === next) {
          perChatQueue.delete(chatKey);
          if (process.env.DEBUG_TRACE === "1") {
            logger.debug("队列清理完成", {
              module: "commands",
              chatId: chatKey,
            });
          }
        }
      });

    perChatQueue.set(chatKey, next);
  });

  imsgClient.on("error", (error: Error) => {
    logger.error("imsg RPC 错误", { module: "commands", error: error.message });
  });

  imsgClient.on("close", () => {
    logger.warn("imsg RPC 连接已关闭", { module: "commands" });
  });

  console.log("msgcode 已启动（imsg RPC）");
  logger.info("msgcode 已启动（imsg RPC）", { module: "commands" });

  process.on("SIGINT", async () => {
    await stopBot();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await stopBot();
    process.exit(0);
  });

  await keepAlive();
}

export async function stopBot(): Promise<void> {
  console.log("停止 msgcode...");
  logger.info("停止 msgcode", { module: "commands" });

  if (imsgClient) {
    try {
      await imsgClient.stop();
    } catch {
      // ignore
    }
    imsgClient = null;
  }

  await killMsgcodeProcesses();
  // 重要：stop 只停止 msgcode 本身，不杀 tmux 会话。
  // 目的：允许重启 msgcode 后继续复用原有 Claude 上下文（避免“重启丢上下文”）。
  // 如需清理 tmux，请使用 allStop。
}

export async function restartBot(): Promise<void> {
  await stopBot();
  await new Promise((r) => setTimeout(r, 500));
  await startBot();
}

export async function allStop(): Promise<void> {
  await stopBot();
  const sessions = await killMsgcodeTmuxSessions();
  if (sessions.length > 0) {
    logger.info("已停止 tmux 会话", { module: "commands", sessions });
  }
  process.exit(0);
}

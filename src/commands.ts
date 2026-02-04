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
import { getVersion } from "./version.js";

const execAsync = promisify(exec);

let imsgClient: ImsgRpcClient | null = null;
let jobScheduler: import("./jobs/scheduler.js").JobScheduler | null = null;
const perChatQueue = new Map<string, Promise<void>>();
const perChatAbort = new Map<string, AbortController>();

// ============================================
// Control Lane: 只读命令快车道（P0）
// ============================================

// 白名单：只读命令（秒回、不抢占、不破坏游标安全）
const CONTROL_READONLY_COMMANDS = /^\/(status|where|help)(\s|$)/;

const FAST_REPLIED_TTL_MS = 5 * 60 * 1000; // 5 分钟 TTL
const fastReplied = new Map<string, number>();

/**
 * 生成快车道消息的 key
 *
 * P1: 如果既没有 id 也没有 rowid，禁用 control lane（返回空字符串）
 * 避免极端情况下生成 chatId:undefined 导致误判
 */
function fastReplyKey(message: InboundMessage): string {
  if (message.id) {
    return message.id;
  }
  if (message.rowid !== undefined) {
    return `${message.chatId}:${message.rowid}`;
  }
  // 既没有 id 也没有 rowid，禁用 control lane
  return "";
}

/**
 * 标记消息已通过快车道回复
 */
function markFastReplied(message: InboundMessage): void {
  const key = fastReplyKey(message);
  if (!key) return; // 没有有效 key，禁用 control lane
  fastReplied.set(key, Date.now());
  // 定期清理过期条目
  pruneFastReplied(Date.now());
}

/**
 * 检查消息是否已通过快车道回复
 */
function wasFastReplied(message: InboundMessage): boolean {
  const key = fastReplyKey(message);
  if (!key) return false; // 没有有效 key，视为未快回
  const timestamp = fastReplied.get(key);
  if (!timestamp) return false;

  // 检查是否过期
  const now = Date.now();
  if (now - timestamp > FAST_REPLIED_TTL_MS) {
    fastReplied.delete(key);
    return false;
  }
  return true;
}

/**
 * 清理过期的快车道记录
 */
function pruneFastReplied(now: number): void {
  for (const [key, timestamp] of fastReplied.entries()) {
    if (now - timestamp > FAST_REPLIED_TTL_MS) {
      fastReplied.delete(key);
    }
  }
}

/**
 * 在快车道处理只读命令（/status /where /help）
 *
 * - 不等待队列，立即回复
 * - 不调用 abort（不抢占长任务）
 * - 不更新游标（由队列里的同名消息负责）
 * - 处理成功后标记为 fastReplied
 */
async function handleControlCommandInFastLane(message: InboundMessage): Promise<void> {
  return handleControlCommandInFastLaneWithClient(message);
}

type FastLaneSendClient = Pick<ImsgRpcClient, "send">;

async function handleControlCommandInFastLaneWithClient(
  message: InboundMessage,
  clientOverride?: FastLaneSendClient
): Promise<void> {
  const client = clientOverride ?? imsgClient;
  if (!client) {
    return;
  }

  const text = (message.text ?? "").trim();
  const command = text.split(/\s+/)[0]; // 提取命令部分（/status /where /help）

  let sendSuccessful = false; // 标记是否成功发送
  let sentText: string | undefined; // 跟踪实际发送的文本（P0: 只有发送非空文本才 markFastReplied）

  try {
    let responseText: string;

    if (command === "/status") {
      // /status: 使用现有 handler
      const { routeByChatId } = await import("./router.js");
      const { getHandler } = await import("./handlers.js");

      const route = routeByChatId(message.chatId);
      if (!route) {
        const errorMsg = "未绑定工作区，请先发送 /bind <工作区路径>";
        await client.send({ chat_guid: message.chatId, text: errorMsg });
        sendSuccessful = true;
        sentText = errorMsg;
        return;
      }

      const handler = getHandler(route.botType ?? "default");
      const result = await handler.handle("/status", {
        botType: route.botType ?? "default",
        chatId: route.chatId,
        groupName: route.groupName,
        projectDir: route.projectDir,
        originalMessage: message,
      });

      responseText = result.success && result.response ? result.response : result.error || "命令执行失败";

    } else if (command === "/where" || command === "/help") {
      // /where /help: 使用路由命令处理器
      const { handleRouteCommand } = await import("./routes/commands.js");
      const routeCommandName = command.slice(1); // 去掉前导斜杠

      const result = await handleRouteCommand(routeCommandName, {
        chatId: message.chatId,
        args: [],
      });

      responseText = result.message;
    } else {
      responseText = "未知命令";
    }

    // 发送回复
      await client.send({ chat_guid: message.chatId, text: responseText });
      sendSuccessful = true;
      sentText = responseText;

  } catch (error) {
    logger.error(`Control Lane 快车道执行失败: ${command}`, {
      module: "commands",
      chatId: message.chatId,
      command,
      error: error instanceof Error ? error.message : String(error),
    });
    // 出错时也尝试回复用户
    const errorMsg = `命令执行出错: ${error instanceof Error ? error.message : String(error)}`;
    await client.send({ chat_guid: message.chatId, text: errorMsg });
    sendSuccessful = true;
    sentText = errorMsg;
  } finally {
    // P0: 只有成功发送了非空文本后才标记为已快回，避免重复回复
    // 保险丝：即使 handler 返回空文本，queue lane 仍会处理（不吞回复）
    if (sendSuccessful && sentText && sentText.trim().length > 0) {
      markFastReplied(message);
    }
  }
}

/**
 * 检查消息是否已通过快车道回复（供 listener.ts 使用）
 */
export { wasFastReplied };

// 仅用于测试（BDD/Cucumber）
export const __test = process.env.NODE_ENV === "test"
  ? {
    clearFastReplied: () => fastReplied.clear(),
    markFastReplied,
    handleControlCommandInFastLaneForTest: handleControlCommandInFastLaneWithClient,
  }
  : undefined;

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
  // M4-B: Preflight 校验（启动前检查依赖）
  const { loadManifest } = await import("./deps/load.js");
  const { runPreflight } = await import("./deps/preflight.js");

  try {
    const manifest = await loadManifest();
    const preflightResult = await runPreflight(manifest);

    // 检查 requiredForStart
    const missingStart = preflightResult.requiredForStart.filter((r) => !r.available);
    if (missingStart.length > 0) {
      console.error("启动必需依赖缺失:");
      for (const check of missingStart) {
        console.error(`  - ${check.dependencyId}: ${check.error}`);
      }
      console.error("\n请解决缺失依赖后重试。运行 'msgcode preflight --json' 查看详情。");
      process.exit(1);
    }

    // 记录 Jobs 依赖状态
    const missingJobs = preflightResult.requiredForJobs.filter((r) => !r.available);
    if (missingJobs.length > 0) {
      logger.warn("Jobs 依赖缺失，定时任务将无法运行", {
        module: "commands",
        missing: missingJobs.map((r) => r.dependencyId),
      });
    }
  } catch (preflightErr) {
    console.error("依赖检查失败:", preflightErr instanceof Error ? preflightErr.message : String(preflightErr));
    process.exit(1);
  }

  const version = getVersion();
  logger.info(`msgcode v${version}`, { module: "commands", version, binPath: process.argv[1] });
  console.log(`msgcode v${version}`);
  console.log("");

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

  // M3.2-2: 初始化 JobScheduler（daemon 自动调度）
  const { createJobScheduler } = await import("./jobs/scheduler.js");
  const { getRouteByChatId } = await import("./routes/store.js");
  const { executeJob } = await import("./jobs/runner.js");

  // Lane queue：按 chatGuid 串行化执行（用户消息与 job 注入共享）
  function enqueueLane<T>(laneId: string, fn: () => Promise<T>): Promise<T> {
    const prev = perChatQueue.get(laneId) ?? Promise.resolve() as Promise<unknown>;
    const next = prev.catch(() => {}).then(async () => {
      if (process.env.DEBUG_TRACE === "1") {
        logger.debug("Lane 执行开始", { module: "commands", laneId });
      }
      try {
        return await fn();
      } finally {
        if (perChatQueue.get(laneId) === next) {
          perChatQueue.delete(laneId);
        }
      }
    }) as Promise<T>;
    perChatQueue.set(laneId, next as Promise<void>);
    return next;
  }

  jobScheduler = createJobScheduler({
    getRouteFn: getRouteByChatId,
    executeJobFn: async (job) => {
      // 使用 lane queue 串行化同一 chatGuid 的执行
      return enqueueLane(job.route.chatGuid, () => executeJob(job, {
        delivery: true,
        imsgSend: async (chatGuid, text) => {
          if (!imsgClient) {
            throw new Error("imsgClient 未初始化");
          }
          await imsgClient.send({ chat_guid: chatGuid, text });
        },
      }));
    },
    onTick: (info) => {
      logger.info("Scheduler tick", { module: "commands", dueJobs: info.dueJobs.length });
    },
  });

  await jobScheduler.start();
  logger.info("JobScheduler 已启动", { module: "commands" });

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
    const isSlashCommand = text.startsWith("/");

    // P0：控制面命令抢占（远程手机端必须能随时 /status /stop /esc）
    // 规则：只有中断命令才抢占当前任务（/esc /stop /clear）
    // 其他 slash command（如 /status）排队到任务结束后回复
    const isInterrupt = /^\/(esc|stop|clear)(\s|$)/.test(text);
    if (isInterrupt) {
      const controller = perChatAbort.get(chatKey);
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
    }

    // ============================================
    // Control Lane: 只读命令快车道（/status /where /help）
    // ============================================
    const isControlCommand = CONTROL_READONLY_COMMANDS.test(text);
    if (isControlCommand) {
      // 快车道：立即异步回复（不等待队列）
      handleControlCommandInFastLane(message).catch((err: unknown) => {
        logger.error("Control Lane 快车道处理失败", {
          module: "commands",
          chatId: chatKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      // 仍然入队（为了后续按序推进 cursor）
      // 队列里检测到 wasFastReplied 时会跳过实际处理
    }

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
        const controller = new AbortController();
        perChatAbort.set(chatKey, controller);
        if (process.env.DEBUG_TRACE === "1") {
          logger.debug("开始处理消息", {
            module: "commands",
            chatId: chatKey,
            rowid: message.rowid,
          });
        }
        try {
          await handleMessage(message, { imsgClient: imsgClient!, signal: controller.signal });
        } finally {
          // 只清理自己的 controller（避免并发覆盖）
          if (perChatAbort.get(chatKey) === controller) {
            perChatAbort.delete(chatKey);
          }
        }
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

  // M3.2-2: 先停止 JobScheduler（优雅停止，等待当前执行完成）
  if (jobScheduler) {
    jobScheduler.stop();
    jobScheduler = null;
    logger.info("JobScheduler 已停止", { module: "commands" });
  }

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

/**
 * msgcode: CLI 命令实现（2.0）
 *
 * 原则：
 * - 统一运行时只保留一条消息主链
 * - 当前正式消息通道已收口为 Feishu-only
 * - start/stop 只解决真实问题，避免过度防御
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger/index.js";
import { config } from "./config.js";
import type { ChannelSendClient, InboundMessage } from "./channels/types.js";
import crypto from "node:crypto";
import { getVersion } from "./version.js";

const execAsync = promisify(exec);

let sendClient: ChannelSendClient | null = null;
let feishuTransport: import("./feishu/transport.js").FeishuTransport | null = null;
let jobScheduler: import("./jobs/scheduler.js").JobScheduler | null = null;
let heartbeatRunner: import("./runtime/heartbeat.js").HeartbeatRunner | null = null;
let taskSupervisor: import("./runtime/task-supervisor.js").TaskSupervisor | null = null;
const perChatQueue = new Map<string, Promise<void>>();
const perChatAbort = new Map<string, AbortController>();

// ============================================
// Control Lane: 只读命令快车道（P0）
// ============================================

// 白名单：只读命令（秒回、不抢占、不破坏游标安全）
const CONTROL_READONLY_COMMANDS = /^\/(status|where|help|loglevel)(\s|$)/;

const FAST_REPLIED_TTL_MS = 5 * 60 * 1000; // 5 分钟 TTL
const fastReplied = new Map<string, number>();
const fastInFlight = new Set<string>();

/**
 * 生成快车道消息的 key
 *
 * P1: 如果既没有 id 也没有 rowid，禁用 control lane（返回空字符串）
 * 避免极端情况下生成 chatId:undefined 导致误判
 */
function fastReplyKey(message: InboundMessage): string {
  if (message.rowid !== undefined) {
    return `${message.chatId}:${message.rowid}`;
  }
  if (message.id) {
    return message.id;
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
  return handleControlCommandInFastLaneWithClient(message, sendClient ?? undefined);
}

type FastLaneSendClient = ChannelSendClient;

async function handleControlCommandInFastLaneWithClient(
  message: InboundMessage,
  clientOverride?: FastLaneSendClient
): Promise<void> {
  const client = clientOverride ?? sendClient;
  if (!client) {
    return;
  }

  // P0: 防止同一条消息被 transport 重复推送导致快车道重复回复
  // 以 rowid 优先做幂等 key，缺失时降级到 message.id
  const key = fastReplyKey(message);
  if (key) {
    if (wasFastReplied(message)) {
      return;
    }
    if (fastInFlight.has(key)) {
      return;
    }
    fastInFlight.add(key);
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

      const route = routeByChatId(message.chatId, { allowDefaultFallback: false });
      if (!route) {
        const errorMsg = "未绑定工作区，请先发送 /bind <工作区路径>";
        await client.send({ chatId: message.chatId, text: errorMsg });
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

    } else if (command === "/loglevel") {
      // /loglevel: 日志级别命令
      responseText = await handleLogLevelCommand(text);

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
      await client.send({ chatId: message.chatId, text: responseText });
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
    await client.send({ chatId: message.chatId, text: errorMsg });
    sendSuccessful = true;
    sentText = errorMsg;
  } finally {
    if (key) {
      fastInFlight.delete(key);
    }
    // P0: 只有成功发送了非空文本后才标记为已快回，避免重复回复
    // 保险丝：即使 handler 返回空文本，queue lane 仍会处理（不吞回复）
    if (sendSuccessful && sentText && sentText.trim().length > 0) {
      markFastReplied(message);
    }
  }
}

type RuntimeTransport = "feishu";

/**
 * 检查消息是否已通过快车道回复（供 listener.ts 使用）
 */
export { wasFastReplied };

/**
 * 处理 /loglevel 命令
 *
 * 用法：
 * - /loglevel: 返回当前级别 + 来源
 * - /loglevel debug|info|warn|error: 立即生效 + 持久化
 * - /loglevel reset: 删除持久化配置
 *
 * 优先级：ENV > settings.json > 默认值
 */
async function handleLogLevelCommand(text: string): Promise<string> {
  const { getLogLevelSource, setLogLevel, resetLogLevel } = await import("./logger/index.js");
  const { setLogLevel: setSettingsLogLevel, resetLogLevel: resetSettingsLogLevel } = await import("./config/settings.js");
  const validLevels = ["debug", "info", "warn", "error"];

  // 解析参数
  const parts = text.split(/\s+/);
  const arg = parts[1]; // debug|info|warn|error|reset

  if (!arg) {
    // /loglevel: 返回当前级别 + 来源
    const { level, source } = getLogLevelSource();
    const sourceText = {
      env: "环境变量 (LOG_LEVEL)",
      settings: "settings.json (持久化)",
      default: "默认值",
    }[source];
    return `当前日志级别: ${level}\n来源: ${sourceText}`;
  }

  if (arg === "reset") {
    // /loglevel reset: 删除持久化配置
    await resetSettingsLogLevel();
    const envLevel = process.env.LOG_LEVEL;
    if (envLevel) {
      // ENV 优先，重置 settings 不影响当前进程
      return `已重置 settings.json\n注意: 当前进程仍受 ENV 覆盖 (LOG_LEVEL=${envLevel})，重启后生效`;
    }
    // 恢复默认级别
    setLogLevel("info");
    return "已重置日志级别为: info (默认值)";
  }

  // 验证级别参数
  if (!validLevels.includes(arg)) {
    return `无效级别: ${arg}\n有效级别: ${validLevels.join(", ")}`;
  }

  const newLevel = arg as "debug" | "info" | "warn" | "error";

  // 检查 ENV 是否已设置
  if (process.env.LOG_LEVEL) {
    // ENV 优先级最高，警告用户
    await setSettingsLogLevel(newLevel);
    return `已写入 settings.json\n但当前进程仍受 ENV 覆盖 (LOG_LEVEL=${process.env.LOG_LEVEL})\n重启后生效: ${newLevel}`;
  }

  // 立即生效 + 持久化
  setLogLevel(newLevel);
  await setSettingsLogLevel(newLevel);
  return `日志级别已设置为: ${newLevel} (立即生效 + 已持久化)`;
}

/**
 * 检查消息是否正在快车道处理中（用于防止队列车道竞态）
 *
 * @param message InboundMessage
 * @returns 如果消息正在快车道处理中返回 true，否则返回 false
 */
export function isFastLaneInFlight(message: InboundMessage): boolean {
  const key = fastReplyKey(message);
  if (!key) return false; // 没有有效 key，视为未在处理中
  return fastInFlight.has(key);
}

// 仅用于测试（BDD/Cucumber）
export const __test = process.env.NODE_ENV === "test"
  ? {
    clearFastReplied: () => fastReplied.clear(),
    clearFastInFlight: () => fastInFlight.clear(),
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

export async function killMsgcodeTmuxSessions(): Promise<string[]> {
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

    const startupDeps = preflightResult.requiredForStart.filter((check) => !check.available);
    if (startupDeps.length > 0) {
      console.error("启动必需依赖缺失:");
      for (const check of startupDeps) {
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

  // 从 settings.json 初始化日志级别（如果 ENV 未设置）
  const { initLoggerFromSettings } = await import("./logger/index.js");
  await initLoggerFromSettings();

  try {
    const { syncRuntimeSkills } = await import("./skills/runtime-sync.js");
    const skillSync = await syncRuntimeSkills({ overwrite: true });
    if (skillSync.copiedFiles > 0 || skillSync.indexUpdated) {
      logger.info("运行时托管 skills 已同步", {
        module: "commands",
        copiedFiles: skillSync.copiedFiles,
        skippedFiles: skillSync.skippedFiles,
        runtimeSkillIds: skillSync.runtimeSkillIds,
        indexUpdated: skillSync.indexUpdated,
      });
    }
  } catch (error) {
    logger.warn("运行时托管 skills 同步失败", {
      module: "commands",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const { ensureChromeRoot } = await import("./browser/chrome-root.js");
    const chrome = await ensureChromeRoot();
    logger.info("共享工作 Chrome 根目录已就绪", {
      module: "commands",
      chromeRoot: chrome.chromeRoot,
      profilesRoot: chrome.profilesRoot,
      remoteDebuggingPort: chrome.remoteDebuggingPort,
    });
  } catch (error) {
    logger.warn("共享工作 Chrome 根目录初始化失败，browser 主链暂不可用", {
      module: "commands",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const transports = config.transports;
  const activeTransports: RuntimeTransport[] = [];

  // 统一发送口径：当前正式主链只允许 Feishu chatId（feishu:oc_xxx）。
  sendClient = {
    send: async (params) => {
      const chatId = params.chatId;
      const text = typeof params.text === "string" ? params.text : String(params.text ?? "");
      const file = params.file ? String(params.file) : undefined;

      if (!feishuTransport) {
        throw new Error("feishu transport 未初始化");
      }
      return await feishuTransport.send({ chatId, text, file });
    },
  };

  // M3.2-2: 初始化 JobScheduler（daemon 自动调度）
  const { createJobScheduler, registerActiveJobScheduler } = await import("./jobs/scheduler.js");
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
        sendReply: async (chatId, text) => {
          if (!sendClient) {
            throw new Error("sendClient 未初始化");
          }
          await sendClient.send({ chatId, text });
        },
      }));
    },
    onTick: (info) => {
      logger.info("Scheduler tick", { module: "commands", dueJobs: info.dueJobs.length });
    },
  });
  registerActiveJobScheduler(jobScheduler);

  await jobScheduler.start();
  logger.info("JobScheduler 已启动", { module: "commands" });

  // P5.7-R12-T1: 初始化并启动 Heartbeat Runner
  const { HeartbeatRunner } = await import("./runtime/heartbeat.js");
  heartbeatRunner = new HeartbeatRunner({ tag: "msgcode" });

  // P5.7-R12: 初始化并启动 Task Supervisor
  const { createTaskSupervisor } = await import("./runtime/task-supervisor.js");
  const { assembleAgentContext } = await import("./runtime/context-policy.js");
  const { initializeEventQueue, restoreAllQueuesFromDisk } = await import("./steering-queue.js");
  const { executeAgentTurn } = await import("./agent-backend.js");
  const taskDir = `${config.workspaceRoot}/.msgcode/tasks`;
  const eventQueueDir = `${config.workspaceRoot}/.msgcode/event-queue`;
  initializeEventQueue(eventQueueDir);
  const restoredQueues = await restoreAllQueuesFromDisk();
  taskSupervisor = createTaskSupervisor({
    taskDir,
    eventQueueDir,
    heartbeatIntervalMs: 60_000,
    executeTaskTurn: async (task, runContext) => {
      const assembledContext = await assembleAgentContext({
        source: runContext.source,
        chatId: task.chatId,
        prompt: task.goal,
        workspacePath: task.workspacePath,
        taskGoal: task.goal,
        checkpoint: task.checkpoint,
        includeSoulContext: true,
        runId: runContext.runId,
        sessionKey: runContext.sessionKey,
      });

      return executeAgentTurn({
        prompt: assembledContext.prompt,
        workspacePath: task.workspacePath,
        windowMessages: assembledContext.windowMessages,
        summaryContext: assembledContext.summaryContext,
        soulContext: assembledContext.soulContext,
        traceId: runContext.runId,
        runContext: {
          runId: runContext.runId,
          sessionKey: runContext.sessionKey,
          source: runContext.source,
        },
      });
    },
  });

  // 启动 Task Supervisor（heartbeat 由 commands 统一接线）
  await taskSupervisor.start();

  heartbeatRunner.onTick(async (ctx) => {
    // Heartbeat tick 回调：目前仅做观测日志
    logger.debug("Heartbeat tick 触发", {
      module: "commands",
      tickId: ctx.tickId,
      reason: ctx.reason,
    });

    if (taskSupervisor) {
      await taskSupervisor.handleHeartbeatTick(ctx);
    }
  });
  heartbeatRunner.start();
  logger.info("Heartbeat 已启动", { module: "commands" });
  logger.info("Task Supervisor 已启动", {
    module: "commands",
    taskDir,
    eventQueueDir,
    restoredQueueChats: restoredQueues.chatCount,
    restoredQueueEvents: restoredQueues.eventCount,
  });

  const { handleMessage } = await import("./listener.js");

  // 按 chat 串行处理消息，避免"回复错位/滞后一条"的乱序现象
  // 允许不同 chat 并行，但同一 chat 必须严格有序。
  // E16: 添加 DEBUG_TRACE 支持以追踪队列状态
  const handleInbound = (message: InboundMessage) => {
    const chatKey = message.chatId;
    const prev = perChatQueue.get(chatKey) ?? Promise.resolve();
    const text = (message.text ?? "").trim();
    const textLength = text.length;
    const textDigest = text ? crypto.createHash("sha256").update(text).digest("hex").slice(0, 12) : "";

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
          if (!sendClient) {
            throw new Error("sendClient 未初始化");
          }
          await handleMessage(message, { sendClient, signal: controller.signal });
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
  };

  try {
    if (!config.feishu) {
      throw new Error("Feishu-only 主链未配置 FEISHU_APP_ID / FEISHU_APP_SECRET");
    }
    const { createFeishuTransport } = await import("./feishu/transport.js");
    feishuTransport = createFeishuTransport({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      encryptKey: config.feishu.encryptKey,
      onInbound: (m) => handleInbound(m),
    });
    await feishuTransport.start();
    activeTransports.push("feishu");
    logger.info("Feishu transport 已启用", { module: "commands" });
  } catch (error) {
    feishuTransport = null;
    throw error;
  }

  console.log(`msgcode 已启动（transports: ${activeTransports.join(",")}）`);
  logger.info("msgcode 已启动", {
    module: "commands",
    requestedTransports: transports,
    activeTransports,
  });

  process.on("SIGINT", async () => {
    await stopBot();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await stopBot();
    process.exit(0);
  });
  process.on("SIGUSR2", () => {
    if (!jobScheduler) {
      return;
    }

    void jobScheduler.refresh("signal:SIGUSR2").catch((error) => {
      logger.error("JobScheduler refresh signal 失败", {
        module: "commands",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await keepAlive();
}

export async function stopBot(): Promise<void> {
  console.log("停止 msgcode...");
  logger.info("停止 msgcode", { module: "commands" });

  // P5.7-R12-T1: 先停止 Heartbeat（优雅停止）
  if (heartbeatRunner) {
    await heartbeatRunner.stop();
    heartbeatRunner = null;
    logger.info("Heartbeat 已停止", { module: "commands" });
  }

  if (taskSupervisor) {
    await taskSupervisor.stop();
    taskSupervisor = null;
    logger.info("Task Supervisor 已停止", { module: "commands" });
  }

  // M3.2-2: 先停止 JobScheduler（优雅停止，等待当前执行完成）
  if (jobScheduler) {
    const { registerActiveJobScheduler } = await import("./jobs/scheduler.js");
    registerActiveJobScheduler(null);
    jobScheduler.stop();
    jobScheduler = null;
    logger.info("JobScheduler 已停止", { module: "commands" });
  }

  if (feishuTransport) {
    try {
      await feishuTransport.stop();
    } catch {
      // ignore
    }
    feishuTransport = null;
  }

  sendClient = null;

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

// ============================================
// Getter 函数（供其他模块访问）
// ============================================

/**
 * 获取 Task Supervisor 实例
 *
 * P5.7-R12: 供 cmd-task.ts 等命令模块使用
 */
export function getTaskSupervisor(): import("./runtime/task-supervisor.js").TaskSupervisor | null {
  return taskSupervisor;
}

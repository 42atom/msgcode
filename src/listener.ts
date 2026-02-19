/**
 * msgcode: 消息监听器（2.0）
 *
 * 目标：
 * - iMessage I/O 统一走 imsg RPC
 * - 无 iMessage SDK / 无 AppleScript
 * - 只做转发、路由、会话控制（不做内容理解/ASR/TTS）
 */

import type { InboundMessage } from "./imsg/types.js";
import type { ImsgRpcClient } from "./imsg/rpc-client.js";
import { checkWhitelist, formatSender } from "./security.js";
import { routeByChatId } from "./router.js";
import { getHandler } from "./handlers.js";
import {
  handleRouteCommand,
  isRouteCommand,
  parseRouteCommand,
} from "./routes/commands.js";
import { logger } from "./logger/index.js";
import { updateLastSeen } from "./state/store.js";
import { getMemoryInjectConfig } from "./config/workspace.js";
import { AutoTtsLane } from "./runners/tts/auto-lane.js";
import crypto from "node:crypto";

export interface ListenerConfig {
  imsgClient: ImsgRpcClient;
  debug?: boolean;
  signal?: AbortSignal;
}

// ============================================
// Auto TTS Lane（后台自动语音回复，必须串行）
// ============================================

let autoTtsLane: AutoTtsLane | null = null;

function getAutoTtsLane(imsgClient: ImsgRpcClient): AutoTtsLane {
  if (autoTtsLane) return autoTtsLane;

  autoTtsLane = new AutoTtsLane({
    runTts: async (opts) => {
      const { runTts } = await import("./runners/tts.js");
      return await runTts(opts);
    },
    sendText: async (chatId, text) => {
      await sendText(imsgClient, chatId, text);
    },
    sendFile: async (chatId, filePath) => {
      await imsgClient.send({ chat_guid: chatId, text: "", file: filePath });
    },
  });

  return autoTtsLane;
}

// ============================================
// 去重与提示节流（极简版）
// ============================================

const HANDLED_TTL_MS = 5 * 60 * 1000;
const handledMessageAt = new Map<string, number>();

const UNBOUND_HINT_COOLDOWN_MS = 60 * 1000;
const unboundHintAt = new Map<string, number>();

function pruneByTtl(map: Map<string, number>, now: number, ttlMs: number): void {
  for (const [key, ts] of map.entries()) {
    if (now - ts > ttlMs) {
      map.delete(key);
    }
  }
}

async function sendText(
  imsgClient: ImsgRpcClient,
  chatGuid: string,
  text: string
): Promise<void> {
  try {
    const digest = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
    logger.debug("发送回复", {
      module: "listener",
      chatId: chatGuid,
      textLength: text.length,
      textDigest: digest,
      ...(process.env.DEBUG_TRACE_TEXT === "1" ? { textPreview: text.slice(0, 80) } : {}),
    });
    const result = await imsgClient.send({ chat_guid: chatGuid, text });
    logger.debug("回复已发送", {
      module: "listener",
      chatId: chatGuid,
      ok: result.ok,
    });
  } catch (error) {
    logger.error("回复发送失败", {
      module: "listener",
      chatId: chatGuid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * E14: 更新游标（仅在消息成功处理后）
 *
 * 只在 rowid 存在时更新（避免回退）
 */
function updateCursor(message: InboundMessage): void {
  if (message.rowid && message.id) {
    try {
      updateLastSeen(message.chatId, message.rowid, message.id);
      logger.debug("游标已更新", {
        module: "listener",
        chatId: message.chatId,
        rowid: message.rowid,
        messageId: message.id,
      });
    } catch (error) {
      logger.warn("游标更新失败", {
        module: "listener",
        chatId: message.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ============================================
// M6-ACK-P0: 长任务回执机制
// ============================================

// NOTE: 回执文案尽量短，避免打断用户阅读节奏
//       （智能体/长任务：先给“我在处理”的信号即可）
const ACKNOWLEDGEMENT_TEXT = "嗯，等下…";

function getAcknowledgementDelayMs(): number {
  const raw = process.env.MSGCODE_ACK_DELAY_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 15000; // 默认 15 秒（更接近“真的在忙”，减少打断感）
}

/**
 * 判断是否应该发送回执
 *
 * 规则：
 * - 仅对非 slash 命令（不以 / 开头）
 * - 排除 /start /stop /status /esc /clear 等系统命令
 */
function shouldSendAcknowledgement(content: string): boolean {
  const trimmed = content.trim();
  // 不是 slash 命令才需要回执
  return !trimmed.startsWith("/");
}

/**
 * 包装 handler 调用，添加回执机制
 *
 * @param imsgClient iMessage RPC 客户端
 * @param chatGuid 聊天 GUID
 * @param content 消息内容
 * @param handlerFn handler 调用函数
 * @returns handler 结果
 */
async function withAcknowledgement<T>(
  imsgClient: ImsgRpcClient,
  chatGuid: string,
  content: string,
  handlerFn: () => Promise<T>
): Promise<T> {
  // 检查是否需要回执
  const needsAck = shouldSendAcknowledgement(content);

  if (!needsAck) {
    // 不需要回执，直接调用 handler
    return await handlerFn();
  }

  // 需要回执：启动 3s 定时器
  let ackSent = false;
  let timer: NodeJS.Timeout | undefined;

  const sendAck = async () => {
    if (!ackSent) {
      ackSent = true;
      try {
        await sendText(imsgClient, chatGuid, ACKNOWLEDGEMENT_TEXT);
        logger.debug("已发送长任务回执", {
          module: "listener",
          chatId: chatGuid,
        });
      } catch (error) {
        logger.warn("回执发送失败", {
          module: "listener",
          chatId: chatGuid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  // 超过阈值后发送回执
  timer = setTimeout(sendAck, getAcknowledgementDelayMs());

  try {
    // 调用 handler
    const result = await handlerFn();

    // handler 完成，清除定时器
    if (timer) {
      clearTimeout(timer);
    }

    return result;
  } catch (error) {
    // handler 失败，清除定时器
    if (timer) {
      clearTimeout(timer);
    }

    // 如果是取消错误，不需要发送错误消息（已在上层处理）
    if ((error as any)?.message === "__CANCELLED__") {
      throw error;
    }

    // 其他错误，正常抛出（上层会处理错误回复）
    throw error;
  }
}

// 仅用于测试（BDD/Cucumber）
export const __test = process.env.NODE_ENV === "test"
  ? {
    withAcknowledgement,
    shouldSendAcknowledgement,
    getAcknowledgementDelayMs,
    ACKNOWLEDGEMENT_TEXT,
  }
  : undefined;

// ============================================
// M5-3: 记忆注入闸门与检索注入闭环
// P5.6.13-R4: 删除关键词闸门，enabled=true 时每轮检索
// ============================================

/**
 * 记忆注入结果
 */
interface MemoryInjectResult {
  /** 是否注入了记忆 */
  injected: boolean;
  /** 注入后的内容（如果有注入） */
  content: string;
  /** 调试信息 */
  debug?: {
    /** 检索模式 */
    mode?: "hybrid" | "fts-only";
    /** 向量是否可用 */
    vectorAvailable?: boolean;
    /** 检索结果数 */
    hitCount: number;
    /** 注入字符数 */
    injectedChars: number;
    /** 使用的文件路径（不含绝对路径） */
    usedPaths: string[];
    /** 跳过原因 */
    skippedReason?: string;
    /** 强制注入标志 */
    forced?: boolean;
  };
}

/**
 * 记忆注入辅助函数
 *
 * @param content 原始内容
 * @param projectDir 工作目录路径
 * @param force 是否强制注入（/mem force 标志）
 * @returns 注入结果
 */
async function injectMemory(
  content: string,
  projectDir: string,
  force: boolean = false
): Promise<MemoryInjectResult> {
  const debug = process.env.MEMORY_DEBUG === "1";

  // 1. 获取记忆注入配置
  const memConfig = await getMemoryInjectConfig(projectDir);

  // 2. 如果未启用且非强制，直接返回
  if (!memConfig.enabled && !force) {
    if (debug) {
      return {
        injected: false,
        content,
        debug: {
          hitCount: 0,
          injectedChars: 0,
          usedPaths: [],
          skippedReason: "记忆注入未启用",
        },
      };
    }
    return { injected: false, content };
  }

  // 3. P5.6.13-R4: 删除关键词闸门，enabled=true 时直接检索
  // --force-mem 仅做"放宽阈值强制注入"（未来可实现相关度阈值覆盖）

  // 4. 提取搜索查询（使用原始内容，避免噪声）
  const query = content.trim().slice(0, 200); // 限制查询长度

  try {
    // 5. 调用 memory_search
    const { createMemoryStore } = await import("./memory/store.js");
    const path = await import("node:path");
    const store = createMemoryStore();

    // P5.6.13-R4: 获取向量可用状态
    const vectorAvailable = store.isVectorAvailable();

    // 使用 workspace basename 作为 workspaceId（与 memory index 一致，避免跨 workspace 泄露）
    const workspaceId = path.basename(projectDir);
    const results = store.search(workspaceId, query, memConfig.topK);
    store.close();

    if (results.length === 0) {
      if (debug) {
        return {
          injected: false,
          content,
          debug: {
            mode: vectorAvailable ? "fts-only" : "fts-only",
            vectorAvailable,
            hitCount: 0,
            injectedChars: 0,
            usedPaths: [],
            skippedReason: "无搜索结果",
            forced: force,
          },
        };
      }
      return { injected: false, content };
    }

    // 6. 格式化证据块（[记忆] xxx，不含绝对路径/附件元信息）
    const evidenceBlocks: string[] = [];
    let injectedChars = 0;
    const usedPaths: string[] = [];

    for (const result of results) {
      // 格式: [记忆] file.ts:123-456: snippet
      const block = `[记忆] ${result.path}:${result.startLine}-${result.startLine + result.lines - 1}\n${result.snippet.trim()}`;

      // 检查字符数限制
      if (injectedChars + block.length > memConfig.maxChars) {
        break; // 已达上限，停止添加
      }

      evidenceBlocks.push(block);
      injectedChars += block.length;
      usedPaths.push(result.path);
    }

    if (evidenceBlocks.length === 0) {
      if (debug) {
        return {
          injected: false,
          content,
          debug: {
            mode: vectorAvailable ? "fts-only" : "fts-only",
            vectorAvailable,
            hitCount: results.length,
            injectedChars: 0,
            usedPaths: [],
            skippedReason: "证据块超出字符限制",
            forced: force,
          },
        };
      }
      return { injected: false, content };
    }

    // 7. 注入证据块（在用户问题之前）
    const injectedContent =
      "相关记忆：\n" +
      evidenceBlocks.join("\n\n") +
      "\n\n" +
      "用户问题：" +
      "\n" +
      content;

    if (debug) {
      logger.debug("记忆注入已触发", {
        module: "listener",
        mode: vectorAvailable ? "fts-only" : "fts-only",
        vectorAvailable,
        hitCount: results.length,
        injectedChars,
        usedPaths,
        forced: force,
      });
    }

    return {
      injected: true,
      content: injectedContent,
      debug: {
        mode: vectorAvailable ? "fts-only" : "fts-only",
        vectorAvailable,
        hitCount: results.length,
        injectedChars,
        usedPaths,
        forced: force,
      },
    };
  } catch (error) {
    // 搜索失败不影响主流程
    logger.warn("记忆注入失败", {
      module: "listener",
      error: error instanceof Error ? error.message : String(error),
    });

    if (debug) {
      return {
        injected: false,
        content,
        debug: {
          mode: undefined,
          vectorAvailable: false,
          hitCount: 0,
          injectedChars: 0,
          usedPaths: [],
          skippedReason: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
          forced: force,
        },
      };
    }
    return { injected: false, content };
  }
}

// ============================================
// 入口：处理单条消息
// ============================================

export async function handleMessage(
  message: InboundMessage,
  ctx: ListenerConfig
): Promise<void> {
  // E14: 尽量"看见即推进"，避免重启重复推送。
  // 但为了不丢消息：只有在本次消息完成处理/明确忽略后才推进（finally 执行）
  let shouldAdvanceCursor = false;
  const startedAtMs = Date.now();

  try {
    // E17: 预处理文本（用于后续检查）
    // E17: 过滤 iMessage 占位符字符（\uFFFC = Object Replacement Character）
    const placeholderPattern = /[\uFFFC\uFFFD]/g;
    const text = (message.text ?? "").trim().replace(placeholderPattern, "");
    const hasAttachments = Boolean(message.attachments && message.attachments.length > 0);

    // P0: Control Lane 竞态防护 - 如果消息正在快车道处理中，直接返回
    // 避免队列车道在竞态窗口里"补刀回复"（例如 fast lane 已秒回 /loglevel，但 queue lane 又回一次“未知命令”）
    if (/^\/(status|where|help|loglevel)(\s|$)/.test(text)) {
      const { isFastLaneInFlight } = await import("./commands.js");
      if (isFastLaneInFlight(message)) {
        shouldAdvanceCursor = true;
        return;
      }
    }

    // Control Lane: 检查是否已通过快车道回复（/status /where /help /loglevel 秒回）
    // 如果是快车道已回复的消息，只推进游标，跳过实际处理
    const { wasFastReplied } = await import("./commands.js");
    if (wasFastReplied(message)) {
      shouldAdvanceCursor = true;
      return;
    }

  if (ctx.signal?.aborted) {
    shouldAdvanceCursor = true;
    return;
  }
  // 自己发的消息不处理（避免回声循环）
  if (message.isFromMe) {
    shouldAdvanceCursor = true;
    return;
  }

  // M4-A2: 有附件时（特别是语音）不直接忽略
  if (!text && !hasAttachments) {
    shouldAdvanceCursor = true;
    return;
  }

  // E14: 游标过滤（每 chat 独立游标策略）
  // 只处理 rowid > lastSeenRowid 的新消息，避免重复处理
  if (message.rowid) {
    const { loadState } = await import("./state/store.js");
    const state = loadState();
    const chatState = state.chats[message.chatId];

    if (chatState && message.rowid <= chatState.lastSeenRowid) {
      // 已处理过的消息，跳过
      shouldAdvanceCursor = true;
      return;
    }
  }

  // 去重（imsg watch 偶发重复推送时兜底）
  const now = Date.now();
  pruneByTtl(handledMessageAt, now, HANDLED_TTL_MS);
  if (message.id) {
    const last = handledMessageAt.get(message.id);
    if (last && now - last < HANDLED_TTL_MS) {
      return;
    }
    handledMessageAt.set(message.id, now);
  }

  // 白名单校验
  const check = checkWhitelist(message);
  if (!check.allowed) {
    logger.warn("消息被白名单拦截", {
      module: "listener",
      chatId: message.chatId,
      sender: check.sender,
      reason: check.reason,
    });
    shouldAdvanceCursor = true;
    return;
  }

  const textDigest = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
  logger.info("收到消息", {
    module: "listener",
    chatId: message.chatId,
    sender: formatSender(message),
    textLength: text.length,
    textDigest,
    isCommand: text.startsWith("/"),
    ...(process.env.MSGCODE_LOG_PLAINTEXT_INPUT === "1" ? { inboundText: text } : {}),
  });

  // 路由控制面命令：/bind /where /unbind（必须在未绑定时也能用）
  if (isRouteCommand(text)) {
    const parsed = parseRouteCommand(text);
    if (!parsed) {
      shouldAdvanceCursor = true;
      return;
    }
    const result = await handleRouteCommand(parsed.command, {
      chatId: message.chatId,
      args: parsed.args,
    });
    await sendText(ctx.imsgClient, message.chatId, result.message);
    shouldAdvanceCursor = true;
    return;
  }

  // 业务路由：群 -> workspace
  const route = routeByChatId(message.chatId);

  // DEBUG: 路由追踪（需 DEBUG_TRACE=1 启用）
  if (process.env.DEBUG_TRACE === "1") {
    logger.debug("路由查找", {
      module: "listener",
      inputChatId: message.chatId,
      routeFound: !!route,
      routeBotType: route?.botType ?? null,
    });
  }

  if (!route) {
    // 只在用户发"命令类消息"时提示绑定（避免对普通聊天刷屏）
    if (text.startsWith("/")) {
      const last = unboundHintAt.get(message.chatId) ?? 0;
      if (now - last > UNBOUND_HINT_COOLDOWN_MS) {
        unboundHintAt.set(message.chatId, now);
        await sendText(
          ctx.imsgClient,
          message.chatId,
          "本群尚未绑定工作目录。\n先发送: /bind <dir>\n例如: /bind acme/ops"
        );
      }
    }
    shouldAdvanceCursor = true;
    return;
  }

  // 命令/转发交给对应 bot handler（默认 bot 直接走 tmux）
  const handler = getHandler(route.botType ?? "default");

  // M4-A2: 处理附件（语音消息等）
  let attachmentText = "";

  // DEBUG: 检查附件信息
  const attachmentsInfo = message.attachments?.map(a => ({
    filename: a.filename,
    mime: a.mime,
    missing: a.missing,
    path: a.path,
  })) ?? [];
  logger.info(`附件检查: hasAttachments=${hasAttachments}, count=${attachmentsInfo.length}, routeFound=${!!route}, projectDir=${route?.projectDir ?? 'null'}`, {
    module: "listener",
    chatId: message.chatId,
    hasAttachments,
    attachmentsCount: attachmentsInfo.length,
    attachments: attachmentsInfo,
    routeFound: !!route,
    routeProjectDir: route?.projectDir ?? null,
  });

  if (hasAttachments && message.attachments) {
    const { copyToVault, isAudioAttachment, isImageAttachment, formatAttachmentForTmux } = await import("./attachments/vault.js");
    const { processAttachment, formatDerivedForTmux } = await import("./media/pipeline.js");

    for (const attachment of message.attachments) {
      // B2: 只处理允许的附件类型（使用 vault.ts 的类型检查，支持 mime/UTI/扩展名兜底）
      const isAudio = isAudioAttachment(attachment);
      const isImage = isImageAttachment(attachment);
      const isAllowed = isAudio || isImage || attachment.mime === "application/pdf";

      if (!isAllowed) {
        continue;
      }

      // 复制到 vault
      const msgId = message.id ?? "unknown";
      const workspacePath = route.projectDir;
      if (!workspacePath) {
        logger.warn("路由缺少工作区路径，跳过附件", {
          module: "listener",
          chatId: message.chatId,
        });
        continue;
      }
      const copyResult = await copyToVault(workspacePath, msgId, attachment);

      if (!copyResult.success || !copyResult.localPath || !copyResult.digest) {
        // missing=true 或复制失败，记录但不崩溃
        logger.warn("附件复制失败", {
          module: "listener",
          chatId: message.chatId,
          error: copyResult.error,
        });
        continue;
      }

      // 格式化附件信息注入 tmux
      const thisAttachmentText = formatAttachmentForTmux(attachment, copyResult.localPath, copyResult.digest) + "\n";
      attachmentText += thisAttachmentText;

      // MediaPipeline: 自动处理附件（ASR/读图/提取）
      try {
        const pipelineResult = await processAttachment(copyResult.localPath, attachment, workspacePath, text);

        if (pipelineResult.derived) {
          // B3: 追加派生文本到 tmux（读取全文，带截断控制）
          const derivedText = await formatDerivedForTmux(pipelineResult.derived) + "\n";
          attachmentText += derivedText;

          logger.info("附件已生成派生文本", {
            module: "listener",
            chatId: message.chatId,
            kind: pipelineResult.derived.kind,
            status: pipelineResult.derived.status,
          });
        }
      } catch (pipelineError) {
        // Pipeline 失败不崩溃，只记录
        logger.warn("附件处理失败", {
          module: "listener",
          chatId: message.chatId,
          error: pipelineError instanceof Error ? pipelineError.message : String(pipelineError),
        });
      }

      logger.info("附件已复制到 vault", {
        module: "listener",
        chatId: message.chatId,
        localPath: copyResult.localPath,
        skipped: copyResult.skipped,
      });
    }
  }

  // DEBUG: Handler 调用追踪（需 DEBUG_TRACE=1 启用）
  if (process.env.DEBUG_TRACE === "1") {
    logger.debug("调用 Handler", {
      module: "listener",
      botType: route.botType,
      textLength: text.length,
      textDigest,
      ...(process.env.DEBUG_TRACE_TEXT === "1" ? { textPreview: text.slice(0, 30) } : {}),
    });
  }

  // M5-3: 记忆注入闸门（检查 /mem force 标志和触发关键词）
  const memForceFlag = /\b--force-mem\b|\bforce-mem\b|\b--mem-force\b/i.test(text);
  let baseContent = text; // 默认使用原始文本

  if (route.projectDir) {
    const memResult = await injectMemory(text, route.projectDir, memForceFlag);
    if (memResult.injected) {
      baseContent = memResult.content;
      if (memResult.debug && process.env.MEMORY_DEBUG === "1") {
        logger.debug("记忆注入结果", {
          module: "listener",
          ...memResult.debug,
        });
      }
    }
  }

  try {
    // M4-A2: 按 botType 分流构造输入（避免 4.7 reasoning 崩溃）
    const botType = route.botType ?? "default";

    // 声明 result 变量（在 if/else 外部，以便后续代码访问）
    let result: Awaited<ReturnType<typeof handler.handle>>;

    // botType=lmstudio（喂 4.7）：只进核心内容，禁止 [attachment] 元信息
    if (botType === "lmstudio") {
      // M5-3: 使用记忆注入后的内容（baseContent 已包含可能的记忆证据块）
      let contentToHandle = (baseContent || "").trim();

      // 检查是否有 OCR 失败（包含错误信息的派生文本）
      const hasOcrError =
        attachmentText.includes("LM Studio 未返回文本内容") ||
        attachmentText.includes("LM Studio API 错误") ||
        attachmentText.includes("模型只输出 reasoning content") ||
        attachmentText.includes("模型进程崩溃") ||
        attachmentText.includes("The model has crashed");

      if (hasOcrError) {
        // P0: OCR 失败直接固定文案回复，不喂给 4.7（避免元叙事）
        await sendText(ctx.imsgClient, message.chatId, "图片识别失败。若要纯抽字请发：ocr");
        shouldAdvanceCursor = true;
        return;
      }

      // 只追加派生文本（[图片文字]/[语音转写]），去掉标签本体，避免模型复述方括号块
      const derivedEvidence = attachmentText
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .filter(line => line.startsWith("[图片文字]") || line.startsWith("[语音转写]"))
        .map(line => line.replace(/^\[[^\]]+\]\s*/g, "").trim())
        .filter(Boolean);

      // 若用户未附带问题但有证据（只发图/语音），给一个默认问题，避免模型进入"分析输入"模式
      if (!contentToHandle && derivedEvidence.length > 0) {
        contentToHandle = "请用一句话概括主要内容。";
      }

      if (derivedEvidence.length > 0) {
        contentToHandle +=
          (contentToHandle ? "\n\n" : "") +
          "补充信息：" +
          "\n" +
          derivedEvidence.join("\n");
      }

      // 如果既没有文本也没有可处理的附件，跳过
      if (!contentToHandle.trim()) {
        shouldAdvanceCursor = true;
        return;
      }

      result = await withAcknowledgement(
        ctx.imsgClient,
        message.chatId,
        contentToHandle,
        () => handler.handle(contentToHandle, {
          botType,
          chatId: route.chatId,
          groupName: route.groupName,
          projectDir: route.projectDir,
          originalMessage: message,
          signal: ctx.signal,
        })
      );
    } else {
      // botType=default/tmux：保留完整格式（[attachment] + 派生文本）
      const contentToHandle = text ? (attachmentText ? `${text}\n${attachmentText}` : text) : attachmentText;

      // 如果既没有文本也没有可处理的附件，跳过
      if (!contentToHandle.trim()) {
        shouldAdvanceCursor = true;
        return;
      }

      result = await withAcknowledgement(
        ctx.imsgClient,
        message.chatId,
        contentToHandle,
        () => handler.handle(contentToHandle, {
          botType,
          chatId: route.chatId,
          groupName: route.groupName,
          projectDir: route.projectDir,
          originalMessage: message,
          signal: ctx.signal,
        })
      );
    }

    // DEBUG: Handler 结果追踪（需 DEBUG_TRACE=1 启用）
    if (process.env.DEBUG_TRACE === "1") {
      logger.debug("Handler 结果", {
        module: "listener",
        success: result.success,
        responseLength: result.response?.length ?? 0,
        responseDigest: result.response
          ? crypto.createHash("sha256").update(result.response).digest("hex").slice(0, 12)
          : null,
        ...(process.env.DEBUG_TRACE_TEXT === "1"
          ? { textPreview: result.response?.slice(0, 50) ?? null }
          : {}),
        error: result.error ?? null,
      });
    }

    if (!result.success) {
      // P0: 允许被上游抢占（例如用户发 /status /stop 中断长任务）
      // 取消不应回错误消息，否则会刷屏。
      if (result.error === "__CANCELLED__") {
        logger.info("handler 已取消（被新命令抢占）", {
          module: "listener",
          chatId: message.chatId,
        });
        shouldAdvanceCursor = true;
        return;
      }
      logger.error("handler 处理失败", {
        module: "listener",
        chatId: message.chatId,
        botType: route.botType ?? "default",
        error: result.error || "unknown",
      });
      await sendText(
        ctx.imsgClient,
        message.chatId,
        result.error ? `错误: ${result.error}` : "错误: 处理失败"
      );
      shouldAdvanceCursor = true;
      return;
    }

    // 若 handler 需要发送附件，则优先发送附件（可附带文本）
    let didSend = false;
    if (result.file?.path) {
      const text = result.response ? result.response : "";
      await ctx.imsgClient.send({ chat_guid: message.chatId, text, file: result.file.path });
      didSend = true;
    } else if (result.response) {
      await sendText(ctx.imsgClient, message.chatId, result.response);
      didSend = true;
    }

    // Info: 给运维一个“闭环完成”的稳定锚点（否则 info 日志会停在“附件检查”看起来像挂起）
    // 注意：不输出原文，只输出长度/摘要 hash。
    {
      const elapsedMs = Date.now() - startedAtMs;
      const responseLen = result.response?.length ?? 0;
      const responseDigest = result.response
        ? crypto.createHash("sha256").update(result.response).digest("hex").slice(0, 12)
        : null;
      logger.info("消息处理完成", {
        module: "listener",
        chatId: message.chatId,
        botType: route.botType ?? "default",
        didSend,
        elapsedMs,
        responseLength: responseLen,
        responseDigest,
        responseText: result.response ?? null,
      });
    }

    // 非阻塞的延迟任务（例如 TTS）
    if (result.defer?.kind === "tts") {
      const deferText = (result.defer.text || "").trim();
      const projectDir = route.projectDir;
      if (deferText && projectDir) {
        // 不阻塞主流程：先让用户拿到即时回复，再后台生成语音附件。
        //
        // P0：自动语音回复必须“串行 + 最新覆盖”，否则会出现：
        // - 多条 TTS 并发 → IndexTTS worker 内存暴涨 / SIGKILL
        // - 音频乱序/重复发送（用户感知为“先发合并音频，再发分段音频”）
        const autoTimeoutMs = (() => {
          const raw = (process.env.TTS_AUTO_TIMEOUT_MS || "").trim();
          if (!raw) return 120_000;
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0) return 120_000;
          return Math.floor(n);
        })();

        getAutoTtsLane(ctx.imsgClient).enqueue({
          chatId: message.chatId,
          workspacePath: projectDir,
          text: deferText,
          createdAtMs: Date.now(),
          options: {
            timeoutMs: autoTimeoutMs,
            // P0: 不默认走 IndexTTS 内置 emo_text（慢且易抖）
            // 将风格作为情绪分析提示（emoAuto 由后端默认策略决定）
            instruct: result.defer?.options?.instruct,
            speed: result.defer?.options?.speed,
            temperature: result.defer?.options?.temperature,
          },
        });
      }
    }

    shouldAdvanceCursor = true;
    return;
  } catch (handlerError: unknown) {
    // DEBUG: Handler 异常追踪（需 DEBUG_TRACE=1 启用）
    if (process.env.DEBUG_TRACE === "1") {
      logger.debug("Handler 异常", {
        module: "listener",
        error: handlerError instanceof Error ? handlerError.message : String(handlerError),
        stack: handlerError instanceof Error ? handlerError.stack?.slice(0, 100) : null,
      });
    }

    await sendText(
      ctx.imsgClient,
      message.chatId,
      `Handler 异常: ${handlerError instanceof Error ? handlerError.message : String(handlerError)}`
    );
    shouldAdvanceCursor = true;
    return;
  }
  } finally {
    if (shouldAdvanceCursor) {
      updateCursor(message);
    }
  }
}

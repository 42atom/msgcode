/**
 * msgcode: Job Runner（统一执行器）
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/job_spec_v2.1.md
 *
 * 职责：
 * - executeJob(job, ctx): 统一执行入口，scheduler 和 msgcode job run 复用
 * - 支持 payload.kind === "tmuxMessage"
 * - 按 job.delivery.mode 决定是否回发到同聊天通道
 * - 按 job.delivery.maxChars 截断
 * - 错误码落盘：ROUTE_NOT_FOUND/ROUTE_INACTIVE/TMUX_SESSION_DEAD 等
 */

import type { CronJob, JobStatus } from "./types.js";
import type { RouteEntry } from "../routes/store.js";
import { getRouteByChatId } from "../routes/store.js";
import { handleTmuxSend } from "../tmux/responder.js";
import { stableGroupNameForChatId } from "../channels/chat-id.js";
import { beginRun, toRunErrorMessage } from "../runtime/run-store.js";

// ============================================
// 执行上下文
// ============================================

/**
 * Job 执行上下文
 */
export interface JobExecutionContext {
  /** 是否发送消息回当前聊天通道（false 用于 dry-run 或测试） */
  delivery?: boolean;
  /** 自定义回发函数（可选，用于 CLI 手动 run / daemon 主链注入） */
  sendReply?: (chatGuid: string, text: string) => Promise<void>;
}

// ============================================
// 执行结果
// ============================================

/**
 * Job 执行结果
 */
export interface JobExecutionResult {
  /** 执行状态 */
  status: JobStatus;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 错误信息（可选） */
  error?: string;
  /** 错误码（可选，业务逻辑错误） */
  errorCode?: string;
  /** 额外详情（可选） */
  details?: Record<string, unknown>;
}

// ============================================
// 统一执行入口
// ============================================

/**
 * 执行单个 job（统一入口，scheduler 和 CLI 复用）
 *
 * @param job 要执行的 CronJob
 * @param ctx 执行上下文
 * @returns 执行结果
 */
export async function executeJob(
  job: CronJob,
  ctx: JobExecutionContext = {}
): Promise<JobExecutionResult> {
  const run = beginRun({
    source: "schedule",
    kind: "light",
    chatId: job.route.chatGuid,
    triggerId: job.id,
  });

  try {
    const startTime = Date.now();

    // P5.7-R17: 支持 chatMessage payload（不走 tmux，直接发消息）
    if (job.payload.kind === "chatMessage") {
      return finalizeScheduleRun(run, await executeChatMessageJob(job, ctx, startTime));
    }

    // 仅支持 tmuxMessage payload
    if (job.payload.kind !== "tmuxMessage") {
      return finalizeScheduleRun(run, {
        status: "skipped",
        durationMs: Date.now() - startTime,
        error: "不支持的 payload.kind",
        errorCode: "PAYLOAD_EMPTY",
      });
    }

    const text = job.payload.text;
    if (!text) {
      return finalizeScheduleRun(run, {
        status: "skipped",
        durationMs: Date.now() - startTime,
        error: "payload.text 为空",
        errorCode: "PAYLOAD_EMPTY",
      });
    }

    // 1) 获取 route
    const route = getRouteByChatId(job.route.chatGuid);
    if (!route) {
      return finalizeScheduleRun(run, {
        status: "skipped",
        durationMs: Date.now() - startTime,
        error: `路由不存在: ${job.route.chatGuid}`,
        errorCode: "ROUTE_NOT_FOUND",
      });
    }

    if (route.status !== "active") {
      return finalizeScheduleRun(run, {
        status: "skipped",
        durationMs: Date.now() - startTime,
        error: `路由未激活: ${route.label} (${route.status})`,
        errorCode: "ROUTE_INACTIVE",
      });
    }

    // 2) 获取 tmux group name
    const groupName = stableGroupNameForChatId(job.route.chatGuid);

    // 3) 执行 tmux send
    const tmuxResult = await handleTmuxSend(groupName, text, {
      projectDir: route.workspacePath,
    });

    if (!tmuxResult.success) {
      // tmux 执行失败
      const errorMsg = tmuxResult.error || "未知错误";

      if (errorMsg.includes("tmux 会话未运行")) {
        return finalizeScheduleRun(run, {
          status: "error",
          durationMs: Date.now() - startTime,
          error: errorMsg,
          errorCode: "TMUX_SESSION_DEAD",
          details: { groupName },
        });
      }

      return finalizeScheduleRun(run, {
        status: "error",
        durationMs: Date.now() - startTime,
        error: errorMsg,
        errorCode: "TMUX_SESSION_START_FAILED",
        details: { groupName },
      });
    }

    // 4) 处理 delivery（回发到同聊天通道）
    const shouldDelivery = ctx.delivery !== false;
    let deliveryError: string | undefined;

    if (shouldDelivery && job.delivery.mode === "reply-to-same-chat") {
      let responseText = tmuxResult.response || "";

      // 按 maxChars 截断
      if (job.delivery.maxChars && responseText.length > job.delivery.maxChars) {
        responseText = responseText.slice(0, job.delivery.maxChars) + "...";
      }

      // 回发消息
      try {
        if (ctx.sendReply) {
          await ctx.sendReply(job.route.chatGuid, responseText);
        } else {
          deliveryError = "sendReply 未提供（daemon 模式需传入）";
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (job.delivery.bestEffort) {
          // bestEffort 模式：回发失败不影响任务状态
          deliveryError = msg;
        } else {
          // 非 bestEffort：回发失败算任务失败
          return finalizeScheduleRun(run, {
            status: "error",
            durationMs: Date.now() - startTime,
            error: `回发失败: ${msg}`,
            errorCode: "DELIVERY_FAILED",
            details: { originalResponse: tmuxResult.response },
          });
        }
      }
    }

    // 5) 返回成功结果
    const result: JobExecutionResult = {
      status: "ok",
      durationMs: Date.now() - startTime,
    };

    // 如果有回发错误（bestEffort 模式），写入 details
    if (deliveryError) {
      result.details = {
        deliveryError,
        originalResponse: tmuxResult.response,
      };
    }

    // 如果响应被截断，写入 details
    if (tmuxResult.response && job.delivery.maxChars && tmuxResult.response.length > job.delivery.maxChars) {
      result.details = result.details || {};
      result.details.truncated = true;
      result.details.originalLength = tmuxResult.response.length;
      result.details.truncatedLength = job.delivery.maxChars;
    }

    return finalizeScheduleRun(run, result);
  } catch (error) {
    run.finish({
      status: "failed",
      error: toRunErrorMessage(error),
    });
    throw error;
  }
}

function finalizeScheduleRun(run: import("../runtime/run-store.js").RunHandle, result: JobExecutionResult): JobExecutionResult {
  run.finish({
    status: result.status === "ok" ? "completed" : "failed",
    error: result.error,
  });
  return result;
}

/**
 * P5.7-R17: 执行 chatMessage 类型的 job（不走 tmux，直接发消息）
 *
 * @param job CronJob
 * @param ctx 执行上下文
 * @param startTime 开始时间
 * @returns 执行结果
 */
async function executeChatMessageJob(
  job: CronJob,
  ctx: JobExecutionContext,
  startTime: number
): Promise<JobExecutionResult> {
  const text = job.payload.text;
  if (!text) {
    return {
      status: "skipped",
      durationMs: Date.now() - startTime,
      error: "payload.text 为空",
      errorCode: "PAYLOAD_EMPTY",
    };
  }

  // 获取 route 验证
  const route = getRouteByChatId(job.route.chatGuid);
  if (!route) {
    return {
      status: "skipped",
      durationMs: Date.now() - startTime,
      error: `路由不存在: ${job.route.chatGuid}`,
      errorCode: "ROUTE_NOT_FOUND",
    };
  }

  if (route.status !== "active") {
    return {
      status: "skipped",
      durationMs: Date.now() - startTime,
      error: `路由未激活: ${route.label} (${route.status})`,
      errorCode: "ROUTE_INACTIVE",
    };
  }

  // 直接发送消息到聊天通道（不走 tmux）
  const shouldDelivery = ctx.delivery !== false;

  if (shouldDelivery && job.delivery.mode === "reply-to-same-chat") {
    let responseText = text;

    // 按 maxChars 截断
    if (job.delivery.maxChars && responseText.length > job.delivery.maxChars) {
      responseText = responseText.slice(0, job.delivery.maxChars) + "...";
    }

    // 发送消息
    try {
      if (ctx.sendReply) {
        await ctx.sendReply(job.route.chatGuid, responseText);
      } else {
        return {
          status: "error",
          durationMs: Date.now() - startTime,
          error: "sendReply 未提供",
          errorCode: "DELIVERY_FAILED",
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 非 bestEffort 模式：发送失败算任务失败
      if (!job.delivery.bestEffort) {
        return {
          status: "error",
          durationMs: Date.now() - startTime,
          error: `发送失败: ${msg}`,
          errorCode: "DELIVERY_FAILED",
        };
      }
      // bestEffort 模式：记录错误但继续
      return {
        status: "ok",
        durationMs: Date.now() - startTime,
        details: { deliveryError: msg },
      };
    }
  }

  // 成功
  return {
    status: "ok",
    durationMs: Date.now() - startTime,
  };
}

// ============================================
// Lane Queue（串行化同一 chatGuid 的执行）
// ============================================

/**
 * Lane Queue（按 laneId 串行化执行）
 *
 * 用途：确保同一 chatGuid 的用户消息处理与 job 注入串行执行
 *
 * @param laneId 队列标识（通常是 chatGuid）
 * @param fn 要执行的函数
 * @returns fn 的执行结果
 */
export async function enqueueLane<T>(laneId: string, fn: () => Promise<T>): Promise<T> {
  // 这个函数会在 commands.ts 中实现，因为需要访问 perChatQueue
  // 这里只是一个类型声明，实际实现在 commands.ts 中
  throw new Error("enqueueLane 需要在 commands.ts 中实现");
}

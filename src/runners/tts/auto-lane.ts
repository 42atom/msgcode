/**
 * msgcode: Auto TTS Lane (Background)
 *
 * 目标：
 * - 自动语音回复（handler.defer.kind==="tts"）不能并发，否则会：
 *   - 多条 TTS 同时跑 → IndexTTS worker 内存暴涨 / SIGKILL
 *   - 音频乱序/重复发送（用户感知为“先发合并音频，再发分段音频”）
 *   - 长延迟堆积导致体验不可用
 *
 * 设计：
 * - 全局单 lane（IndexTTS worker 也是单实例）
 * - per-chat 只保留“最新一条”（latest-wins），避免 backlog
 * - 如果一条自动 TTS 在跑，期间来了新任务：
 *   - 不中断当前推理（IndexTTS worker 目前不支持软取消）
 *   - 但“完成后不发送旧音频”（避免过期回复刷屏）
 */

import type { TtsOptions, TtsResult } from "./backends/types.js";

export type AutoTtsJob = {
  chatId: string;
  workspacePath: string;
  text: string;
  options?: Omit<TtsOptions, "workspacePath" | "text">;
  createdAtMs: number;
};

type SendTextFn = (chatId: string, text: string) => Promise<void>;
type SendFileFn = (chatId: string, filePath: string) => Promise<void>;
type RunTtsFn = (options: TtsOptions) => Promise<TtsResult>;

type ChatSeq = {
  latestSeq: number;
  runningSeq: number | null;
};

function pickOldestJob(pending: Map<string, AutoTtsJob & { seq: number }>): (AutoTtsJob & { seq: number }) | null {
  let best: (AutoTtsJob & { seq: number }) | null = null;
  for (const job of pending.values()) {
    if (!best || job.createdAtMs < best.createdAtMs) best = job;
  }
  return best;
}

export class AutoTtsLane {
  private pendingByChat = new Map<string, AutoTtsJob & { seq: number }>();
  private seqByChat = new Map<string, ChatSeq>();
  private pumping = false;

  constructor(
    private deps: {
      runTts: RunTtsFn;
      sendText: SendTextFn;
      sendFile: SendFileFn;
    }
  ) {}

  enqueue(job: AutoTtsJob): void {
    const prev = this.seqByChat.get(job.chatId) ?? { latestSeq: 0, runningSeq: null };
    const nextSeq = prev.latestSeq + 1;
    this.seqByChat.set(job.chatId, { ...prev, latestSeq: nextSeq });

    this.pendingByChat.set(job.chatId, { ...job, seq: nextSeq });

    if (!this.pumping) {
      this.pumping = true;
      void this.pump();
    }
  }

  private isLatest(job: { chatId: string; seq: number }): boolean {
    const st = this.seqByChat.get(job.chatId);
    if (!st) return false;
    return job.seq === st.latestSeq;
  }

  private async pump(): Promise<void> {
    while (this.pendingByChat.size > 0) {
      const job = pickOldestJob(this.pendingByChat);
      if (!job) break;
      this.pendingByChat.delete(job.chatId);

      // 任务在开始前已被更新替换 → 直接跳过
      if (!this.isLatest(job)) {
        continue;
      }

      const chatState = this.seqByChat.get(job.chatId) ?? { latestSeq: job.seq, runningSeq: null };
      this.seqByChat.set(job.chatId, { ...chatState, runningSeq: job.seq });

      try {
        const tts = await this.deps.runTts({
          workspacePath: job.workspacePath,
          text: job.text,
          ...(job.options ?? {}),
        });

        // 在执行期间来了更新任务 → 丢弃旧结果（不发送，不报错）
        if (!this.isLatest(job)) {
          continue;
        }

        if (!tts.success || !tts.audioPath) {
          const msg = tts.error ? `语音生成失败: ${tts.error}` : "语音生成失败";
          await this.deps.sendText(job.chatId, msg);
          continue;
        }

        await this.deps.sendFile(job.chatId, tts.audioPath);
      } catch (e) {
        if (!this.isLatest(job)) {
          continue;
        }
        await this.deps.sendText(
          job.chatId,
          `语音生成异常: ${e instanceof Error ? e.message : String(e)}`
        );
      } finally {
        const st = this.seqByChat.get(job.chatId);
        if (st && st.runningSeq === job.seq) {
          this.seqByChat.set(job.chatId, { ...st, runningSeq: null });
        }
      }
    }

    this.pumping = false;
  }
}


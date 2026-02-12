import { describe, it, expect } from "bun:test";
import { AutoTtsLane } from "../src/runners/tts/auto-lane.js";

function waitTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("AutoTtsLane", () => {
  it("per-chat latest-wins: 新任务会覆盖旧任务的发送", async () => {
    const sentTexts: string[] = [];
    const sentFiles: string[] = [];

    let resolveFirst: ((v: unknown) => void) | null = null;
    const firstStarted = { ok: false };

    const lane = new AutoTtsLane({
      runTts: async (opts) => {
        if (opts.text === "old") {
          firstStarted.ok = true;
          await new Promise((r) => { resolveFirst = r; });
          return { success: true, audioPath: "/tmp/old.m4a" };
        }
        return { success: true, audioPath: "/tmp/new.m4a" };
      },
      sendText: async (_chatId, text) => {
        sentTexts.push(text);
      },
      sendFile: async (_chatId, filePath) => {
        sentFiles.push(filePath);
      },
    });

    lane.enqueue({ chatId: "c1", workspacePath: "/w", text: "old", createdAtMs: 1 });
    await waitTick();
    expect(firstStarted.ok).toBe(true);

    // 在 old 还没跑完时，enqueue 新任务
    lane.enqueue({ chatId: "c1", workspacePath: "/w", text: "new", createdAtMs: 2 });

    // 放行 old
    resolveFirst?.(null);
    await waitTick();
    await waitTick();

    // 旧任务结果不应发送；只发送最新的新任务
    expect(sentTexts.length).toBe(0);
    expect(sentFiles).toEqual(["/tmp/new.m4a"]);
  });

  it("串行：不同 chat 的任务不会并发发送", async () => {
    const sentFiles: string[] = [];
    const runOrder: string[] = [];

    const lane = new AutoTtsLane({
      runTts: async (opts) => {
        runOrder.push(opts.text);
        return { success: true, audioPath: `/tmp/${opts.text}.m4a` };
      },
      sendText: async () => {},
      sendFile: async (_chatId, filePath) => {
        sentFiles.push(filePath);
      },
    });

    lane.enqueue({ chatId: "c1", workspacePath: "/w", text: "a", createdAtMs: 1 });
    lane.enqueue({ chatId: "c2", workspacePath: "/w", text: "b", createdAtMs: 2 });
    lane.enqueue({ chatId: "c1", workspacePath: "/w", text: "a2", createdAtMs: 3 }); // 覆盖 c1 的 a

    await waitTick();
    await waitTick();

    // c1 的 a 被覆盖：a 不发送；剩余按 createdAt 旧→新 执行（b → a2）
    expect(runOrder).toEqual(["a", "b", "a2"]);
    expect(sentFiles).toEqual(["/tmp/b.m4a", "/tmp/a2.m4a"]);
  });
});

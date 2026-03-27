import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveWritableThreadTarget,
  sendThreadInput,
  setThreadInputDispatcherForTest,
} from "../src/runtime/thread-input.js";
import { readWorkspaceThreadDetailSurface } from "../src/runtime/workspace-thread-surface.js";

async function makeTempWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-send-thread-input-"));
  const workspacePath = path.join(root, "family");
  const threadsDir = path.join(workspacePath, ".msgcode", "threads");
  await fs.mkdir(threadsDir, { recursive: true });
  await fs.writeFile(
    path.join(threadsDir, "2026-03-19_web-main.md"),
    [
      "---",
      "threadId: thread-web",
      "chatId: web:family-main",
      "title: 家庭网页线程",
      "transport: web",
      "---",
      "",
      "## Turn 1 - 2026-03-19T02:10:00.000Z",
      "",
      "### User",
      "今天为什么没有提醒我",
      "",
      "### Assistant",
      "我去查一下今天的定时任务情况。",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(threadsDir, "2026-03-20_feishu-main.md"),
    [
      "---",
      "threadId: thread-feishu",
      "chatId: feishu:oc_family",
      "title: 接娃主线",
      "transport: feishu",
      "---",
      "",
      "## Turn 1 - 2026-03-20T05:41:18.204Z",
      "",
      "### User",
      "我在门口准备好了",
      "",
      "### Assistant",
      "好的，去接小孩路上注意安全。",
      "",
    ].join("\n"),
    "utf8",
  );
  return workspacePath;
}

describe("sendThreadInput contract", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    setThreadInputDispatcherForTest(null);
    await Promise.all(workspaces.splice(0).map((workspacePath) => fs.rm(path.dirname(workspacePath), { recursive: true, force: true })));
  });

  it("resolves a writable web thread target", async () => {
    const workspacePath = await makeTempWorkspace();
    workspaces.push(workspacePath);

    const target = await resolveWritableThreadTarget(workspacePath, "thread-web");
    expect(target.threadId).toBe("thread-web");
    expect(target.chatId).toBe("web:family-main");
    expect(target.writable).toBe(true);
  });

  it("rejects readonly thread sources before runtime send", async () => {
    const workspacePath = await makeTempWorkspace();
    workspaces.push(workspacePath);

    await expect(resolveWritableThreadTarget(workspacePath, "thread-feishu")).rejects.toThrow(
      "sendThreadInput rejects readonly thread source: feishu",
    );
    await expect(
      sendThreadInput({
        workspacePath,
        threadId: "thread-feishu",
        text: "hello",
      }),
    ).rejects.toThrow("sendThreadInput rejects readonly thread source: feishu");
  });

  it("rejects empty composer text before dispatch", async () => {
    const workspacePath = await makeTempWorkspace();
    workspaces.push(workspacePath);

    await expect(
      sendThreadInput({
        workspacePath,
        threadId: "thread-web",
        text: "   ",
      }),
    ).rejects.toThrow("sendThreadInput requires non-empty text");
  });

  it("returns after persisting the user turn instead of waiting for background completion", async () => {
    const workspacePath = await makeTempWorkspace();
    workspaces.push(workspacePath);

    let releaseDispatcher: (() => void) | undefined;
    const dispatcherBlocked = new Promise<void>((resolve) => {
      releaseDispatcher = resolve;
    });
    setThreadInputDispatcherForTest(async () => {
      await dispatcherBlocked;
      return {
        success: true,
        response: "后台已继续处理",
      };
    });

    const result = await Promise.race([
      sendThreadInput({
        workspacePath,
        threadId: "thread-web",
        text: "桌面端先把我的输入落下来",
      }).then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(result).toBe("done");

    const detail = await readWorkspaceThreadDetailSurface(workspacePath, "thread-web");
    expect(detail.found).toBe(true);
    expect(detail.readable).toBe(true);
    expect(detail.data.thread?.messages[0]?.user).toBe("桌面端先把我的输入落下来");
    expect(detail.data.thread?.messages[0]?.assistant).toBe("");

    releaseDispatcher?.();
  });
});

import { describe, expect, it } from "bun:test";
import {
  bindThreadUpdatePush,
  buildRendererHtml,
  resolveElectronRuntimePaths,
  runSendThreadInput,
} from "../src/electron/main.js";
import { createThreadSurfaceIpcWhitelist } from "../src/electron/preload.js";
import {
  getReadonlySurfaceChannel,
  getSendThreadInputChannel,
  getThreadUpdateChannel,
} from "../src/electron/readonly-surface-bridge.js";
import { bootstrapThreadSurface } from "../src/electron/renderer.js";

describe("electron runtime bootstrap slice", () => {
  it("resolves preload and renderer entry from main module path", () => {
    const paths = resolveElectronRuntimePaths("file:///tmp/msgcode/dist/electron/main.js");
    expect(paths.preloadPath).toBe("/tmp/msgcode/dist/electron/preload.js");
    expect(paths.rendererEntryUrl).toBe("file:///tmp/msgcode/dist/electron/renderer.js");
  });

  it("builds a renderer shell that only loads a module entry", () => {
    const html = buildRendererHtml("file:///tmp/msgcode/dist/electron/renderer.js");
    expect(html).toContain('<div id="app-root"></div>');
    expect(html).toContain('<script type="module" src="file:///tmp/msgcode/dist/electron/renderer.js"></script>');
  });

  it("keeps the runtime shell free of business bridge assertions", () => {
    const html = buildRendererHtml("file:///tmp/msgcode/dist/electron/renderer.js");
    expect(html).not.toContain("workspace-tree");
    expect(html).not.toContain("thread-rail");
  });

  it("boots the readonly thread surface into a renderer document", () => {
    const writes: string[] = [];
    const documentLike = {
      open() {
        writes.push("<open>");
      },
      write(content: string) {
        writes.push(content);
      },
      close() {
        writes.push("<close>");
      },
    };

    bootstrapThreadSurface(documentLike);

    expect(writes[0]).toBe("<open>");
    expect(writes[2]).toBe("<close>");
    expect(writes[1]).toContain('data-surface-slot="workspace-tree"');
    expect(writes[1]).toContain('class="left-panel"');
    expect(writes[1]).toContain('class="middle-panel"');
    expect(writes[1]).toContain('class="right-panel"');
    expect(writes[1]).toContain('data-bridge-entry="window.msgcodeReadonlySurface.runCommand"');
    expect(writes[1]).toContain('href="#settings"');
  });

  it("persists user turn before spawning a detached thread-input child", async () => {
    const order: string[] = [];
    const spawned: Array<{
      command: string;
      args: string[];
      options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        stdio: "ignore";
        detached: true;
      };
    }> = [];

    await runSendThreadInput(
      {
        workspacePath: "/tmp/family",
        threadId: "thread-1",
        text: "hello desktop",
      },
      {
        persistUserTurn: async () => {
          order.push("persist");
        },
        spawnChild: (command, args, options) => {
          order.push("spawn");
          spawned.push({ command, args, options });
          return {
            unref() {
              order.push("unref");
            },
          };
        },
        env: { MSGCODE_CLI_ENTRY: "/tmp/msgcode/dist/cli.js" },
        nodePath: "/usr/local/bin/node",
      },
    );

    expect(order).toEqual(["persist", "spawn", "unref"]);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.command).toBe("/usr/local/bin/node");
    expect(spawned[0]?.args.slice(-8)).toEqual([
      "appliance",
      "thread-input-run",
      "--workspace",
      "/tmp/family",
      "--thread-id",
      "thread-1",
      "--text",
      "hello desktop",
    ]);
    expect(spawned[0]?.options.detached).toBe(true);
    expect(spawned[0]?.options.stdio).toBe("ignore");
  });

  it("pushes thread updates from thread file changes before child close", () => {
    const listeners = new Map<string, () => void>();
    const events: Array<{ workspacePath: string; threadId: string }> = [];
    let closed = false;
    let watchListener: ((eventType: string) => void) | undefined;

    bindThreadUpdatePush(
      {
        unref() {},
        once(event, listener) {
          listeners.set(event, listener as () => void);
          return this;
        },
      },
      {
        workspacePath: "/tmp/family",
        threadId: "thread-1",
        threadFilePath: "/tmp/family/.msgcode/threads/2026-03-28_thread.md",
      },
      {
        notify(payload) {
          events.push(payload);
        },
        watchFile(_filePath, listener) {
          watchListener = listener;
          return {
            close() {
              closed = true;
            },
          };
        },
      },
    );

    watchListener?.("change");
    listeners.get("close")?.();

    expect(events).toEqual([
      { workspacePath: "/tmp/family", threadId: "thread-1" },
      { workspacePath: "/tmp/family", threadId: "thread-1" },
    ]);
    expect(closed).toBe(true);
  });

  it("falls back to close notify when thread file watching cannot start", () => {
    const listeners = new Map<string, () => void>();
    const events: Array<{ workspacePath: string; threadId: string }> = [];

    bindThreadUpdatePush(
      {
        unref() {},
        once(event, listener) {
          listeners.set(event, listener as () => void);
          return this;
        },
      },
      {
        workspacePath: "/tmp/family",
        threadId: "thread-1",
        threadFilePath: "/tmp/family/.msgcode/threads/2026-03-28_thread.md",
      },
      {
        notify(payload) {
          events.push(payload);
        },
        watchFile() {
          throw new Error("watch failed");
        },
      },
    );

    listeners.get("close")?.();

    expect(events).toEqual([{ workspacePath: "/tmp/family", threadId: "thread-1" }]);
  });

  it("whitelists preload ipc channels for the thread surface bridge", async () => {
    const calls: string[] = [];
    const whitelist = createThreadSurfaceIpcWhitelist({
      async invoke(channel: string) {
        calls.push(`invoke:${channel}`);
        return null;
      },
      on(channel: string) {
        calls.push(`on:${channel}`);
      },
      off(channel: string) {
        calls.push(`off:${channel}`);
      },
    });

    await whitelist.invoke(getReadonlySurfaceChannel(), {});
    await whitelist.invoke(getSendThreadInputChannel(), {});
    whitelist.on(getThreadUpdateChannel(), () => {});
    whitelist.off(getThreadUpdateChannel(), () => {});

    await expect(whitelist.invoke("msgcode:anything-else", {})).rejects.toThrow(
      "Readonly preload bridge rejected invoke channel",
    );
    expect(() => whitelist.on("msgcode:anything-else", () => {})).toThrow(
      "Readonly preload bridge rejected subscribe channel",
    );
    expect(() => whitelist.off("msgcode:anything-else", () => {})).toThrow(
      "Readonly preload bridge rejected unsubscribe channel",
    );
    expect(calls).toEqual([
      `invoke:${getReadonlySurfaceChannel()}`,
      `invoke:${getSendThreadInputChannel()}`,
      `on:${getThreadUpdateChannel()}`,
      `off:${getThreadUpdateChannel()}`,
    ]);
  });
});

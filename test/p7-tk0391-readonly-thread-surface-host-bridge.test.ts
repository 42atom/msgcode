import { describe, expect, it } from "bun:test";
import { buildThreadSurfaceCliCommand, buildSendThreadInputCliCommand } from "../src/electron/main.js";
import {
  createThreadSurfaceBridge,
  getThreadSurfaceReadChannel,
  getSendThreadInputChannel,
  getThreadUpdateChannel,
} from "../src/electron/thread-surface-bridge.js";
import {
  bindThreadSurfaceNav,
  bindThreadComposer,
  bindThreadSurfaceSelection,
  startThreadSurface,
} from "../src/electron/renderer.js";

describe("readonly thread surface host bridge slice", () => {
  it("invokes the shared readonly channel through the preload bridge", async () => {
    const ipcRenderer = {
      async invoke(channel: string, request: unknown) {
        return { channel, request };
      },
    };
    const bridge = createThreadSurfaceBridge(
      ipcRenderer as never,
      getThreadSurfaceReadChannel(),
      getSendThreadInputChannel(),
    );
    expect(bridge.mode).toBe("live");
    await expect(bridge.runCommand({ command: "workspace-tree" })).resolves.toEqual({
      channel: "msgcode:thread-surface-run-command",
      request: { command: "workspace-tree" },
    });
    await expect(
      bridge.sendThreadInput({
        workspacePath: "/tmp/family",
        threadId: "thread-1",
        text: "hello",
      }),
    ).resolves.toBeUndefined();
  });

  it("subscribes thread updates through the preload bridge", () => {
    const listeners = new Map<string, (_event: unknown, payload: unknown) => void>();
    const removed: string[] = [];
    const bridge = createThreadSurfaceBridge(
      {
        async invoke() {
          return null;
        },
        on(channel, listener) {
          listeners.set(channel, listener);
        },
        off(channel) {
          removed.push(channel);
        },
      },
      getThreadSurfaceReadChannel(),
      getSendThreadInputChannel(),
      getThreadUpdateChannel(),
    );

    const events: Array<{ workspacePath: string; threadId: string }> = [];
    const dispose = bridge.onThreadUpdate((event) => {
      events.push(event);
    });

    listeners.get(getThreadUpdateChannel())?.({}, {
      workspacePath: "/tmp/family",
      threadId: "thread-1",
    });
    dispose();

    expect(events).toEqual([{ workspacePath: "/tmp/family", threadId: "thread-1" }]);
    expect(removed).toEqual([getThreadUpdateChannel()]);
  });

  it("builds readonly surface cli invocations from the shared runtime entry", () => {
    const workspaceTree = buildThreadSurfaceCliCommand(
      { command: "workspace-tree" },
      {
        env: { MSGCODE_CLI_ENTRY: "/tmp/msgcode/dist/cli.js" },
        nodePath: "/usr/local/bin/node",
      },
    );
    expect(workspaceTree.command).toBe("/usr/local/bin/node");
    expect(workspaceTree.args.slice(-3)).toEqual(["appliance", "workspace-tree", "--json"]);
    expect(workspaceTree.cwd).toBe("/Users/admin/GitProjects/msgcode");

    const thread = buildThreadSurfaceCliCommand(
      { command: "thread", workspace: "family", threadId: "thread-1" },
      {
        env: { MSGCODE_CLI_ENTRY: "/tmp/msgcode/dist/cli.js" },
        nodePath: "/usr/local/bin/node",
      },
    );
    expect(thread.command).toBe("/usr/local/bin/node");
    expect(thread.args.slice(-7)).toEqual([
      "appliance",
      "thread",
      "--workspace",
      "family",
      "--thread-id",
      "thread-1",
      "--json",
    ]);

    const profile = buildThreadSurfaceCliCommand(
      { command: "profile", workspace: "/tmp/family" },
      {
        env: { MSGCODE_CLI_ENTRY: "/tmp/msgcode/dist/cli.js" },
        nodePath: "/usr/local/bin/node",
      },
    );
    expect(profile.args.slice(-5)).toEqual([
      "appliance",
      "profile",
      "--workspace",
      "/tmp/family",
      "--json",
    ]);

    const capabilities = buildThreadSurfaceCliCommand(
      { command: "capabilities", workspace: "/tmp/family" },
      {
        env: { MSGCODE_CLI_ENTRY: "/tmp/msgcode/dist/cli.js" },
        nodePath: "/usr/local/bin/node",
      },
    );
    expect(capabilities.args.slice(-5)).toEqual([
      "appliance",
      "capabilities",
      "--workspace",
      "/tmp/family",
      "--json",
    ]);

    const hall = buildThreadSurfaceCliCommand(
      { command: "hall", workspace: "/tmp/family" },
      {
        env: { MSGCODE_CLI_ENTRY: "/tmp/msgcode/dist/cli.js" },
        nodePath: "/usr/local/bin/node",
      },
    );
    expect(hall.args.slice(-5)).toEqual([
      "appliance",
      "hall",
      "--workspace",
      "/tmp/family",
      "--json",
    ]);

    const neighbor = buildThreadSurfaceCliCommand(
      { command: "neighbor", workspace: "/tmp/family" },
      {
        env: { MSGCODE_CLI_ENTRY: "/tmp/msgcode/dist/cli.js" },
        nodePath: "/usr/local/bin/node",
      },
    );
    expect(neighbor.args.slice(-5)).toEqual([
      "appliance",
      "neighbor",
      "--workspace",
      "/tmp/family",
      "--json",
    ]);
  });

  it("builds detached thread-input cli invocations from the shared runtime entry", () => {
    const write = buildSendThreadInputCliCommand(
      {
        workspacePath: "/tmp/family",
        threadId: "thread-1",
        text: "hello desktop",
      },
      {
        env: { MSGCODE_CLI_ENTRY: "/tmp/msgcode/dist/cli.js" },
        nodePath: "/usr/local/bin/node",
      },
    );

    expect(write.command).toBe("/usr/local/bin/node");
    expect(write.args.slice(-8)).toEqual([
      "appliance",
      "thread-input-run",
      "--workspace",
      "/tmp/family",
      "--thread-id",
      "thread-1",
      "--text",
      "hello desktop",
    ]);
  });

  it("loads workspace-tree and thread through the live bridge", async () => {
    const writes: string[] = [];
    const panels = new Map<string, { textContent: string | null; innerHTML: string }>();
    const documentLike = {
      open() {
        writes.push("<open>");
      },
      write(content: string) {
        writes.push(content);
        panels.set('[data-surface-slot="workspace-tree"]', { textContent: null, innerHTML: "" });
        panels.set('[data-surface-slot="thread"]', { textContent: null, innerHTML: "" });
        panels.set('[data-surface-slot="thread-rail"]', { textContent: null, innerHTML: "" });
      },
      close() {
        writes.push("<close>");
      },
      querySelector(selector: string) {
        return panels.get(selector) ?? null;
      },
    };
    const bridge = {
      mode: "live" as const,
      onThreadUpdate() {
        return () => {};
      },
      async sendThreadInput() {},
      async runCommand(request: { command: string }) {
        if (request.command === "workspace-tree") {
          return {
            data: {
              workspaces: [{ name: "family", path: "/tmp/family", threads: [{ threadId: "thread-1", title: "hello" }] }],
            },
          };
        }
        if (request.command === "profile") {
          return {
            data: {
              memory: { enabled: true, topK: 5, maxChars: 2000 },
              soul: { path: "/tmp/family/.msgcode/SOUL.md", exists: true, content: "" },
            },
          };
        }
        if (request.command === "capabilities") {
          return {
            data: {
              capabilities: [{ id: "brain", model: "gpt-5.4", note: "api:openai", configured: true }],
            },
          };
        }
        if (request.command === "hall") {
          return {
            data: {
              org: { name: "msgcode", taxRegion: "SG", uscc: "UEN-1" },
              runtime: {
                appVersion: "1.0.0",
                logPath: "/tmp/family/.msgcode/log",
                summary: { status: "pass", warnings: 0, errors: 0 },
              },
              packs: {
                builtin: [{ id: "core", name: "Core", version: "1.0.0", enabled: true }],
                user: [],
              },
              sites: [{ id: "admin", title: "Admin", kind: "sidecar" }],
            },
          };
        }
        if (request.command === "neighbor") {
          return {
            data: {
              enabled: true,
              self: { nodeId: "self-node", publicIdentity: "self" },
              summary: { unreadCount: 1, lastMessageAt: "2026-03-28T10:00:00.000Z", lastProbeAt: "", reachableCount: 1 },
              neighbors: [{ nodeId: "neighbor-1", displayName: "邻居01", unreadCount: 1, state: "contact" }],
              mailbox: { updatedAt: "", entries: [] },
            },
          };
        }
        return {
          data: {
            thread: {
              title: "hello",
              writable: true,
              messages: [{ user: "u1", assistant: "a1" }],
            },
            schedules: [{ id: "s1" }],
            workStatus: { recentEntries: [{ id: "w1" }] },
          },
        };
      },
    };

    await startThreadSurface(documentLike, bridge);

    expect(panels.get('[data-surface-slot="workspace-tree"]')?.innerHTML).toContain("family");
    expect(panels.get('[data-surface-slot="workspace-tree"]')?.innerHTML).toContain("sidebar-top-nav");
    expect(panels.get('[data-surface-slot="workspace-tree"]')?.innerHTML).toContain("sidebar-footer");
    expect(panels.get('[data-surface-slot="workspace-tree"]')?.innerHTML).toContain('data-surface-nav="base"');
    expect(panels.get('[data-surface-slot="workspace-tree"]')?.innerHTML).toContain('data-surface-nav="neighbor"');
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("<h2>hello</h2>");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("chat-stage");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("composer-dock");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("message-list-stack");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("message-row--user");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("bubble--user");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain('data-thread-composer="true"');
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("大脑模型");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("observer-body");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("observer-row__value--path");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("switch-indicator is-on");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("gpt-5.4");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("记忆");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("已启用");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("定时任务");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain(">1<");
  });

  it("refreshes the active thread when a pushed thread update arrives", async () => {
    const panels = new Map<string, { textContent: string | null; innerHTML: string }>();
    let updateListener: ((event: { workspacePath: string; threadId: string }) => void) | null = null;
    let threadReads = 0;
    const documentLike = {
      open() {},
      write() {
        panels.set('[data-surface-slot="workspace-tree"]', { textContent: null, innerHTML: "" });
        panels.set('[data-surface-slot="thread"]', { textContent: null, innerHTML: "" });
        panels.set('[data-surface-slot="thread-rail"]', { textContent: null, innerHTML: "" });
      },
      close() {},
      querySelector(selector: string) {
        return panels.get(selector) ?? null;
      },
    };
    const bridge = {
      mode: "live" as const,
      onThreadUpdate(listener: (event: { workspacePath: string; threadId: string }) => void) {
        updateListener = listener;
        return () => {
          updateListener = null;
        };
      },
      async sendThreadInput() {},
      async runCommand(request: { command: string }) {
        if (request.command === "workspace-tree") {
          return {
            data: {
              workspaces: [{ name: "family", path: "/tmp/family", threads: [{ threadId: "thread-1", title: "hello" }] }],
            },
          };
        }
        if (request.command === "profile") {
          return {
            data: {
              memory: { enabled: false, topK: 0, maxChars: 0 },
              soul: { path: "", exists: false, content: "" },
            },
          };
        }
        if (request.command === "capabilities") {
          return {
            data: {
              capabilities: [],
            },
          };
        }
        if (request.command === "hall") {
          return {
            data: {
              org: { name: "msgcode" },
              runtime: { summary: { status: "pass", warnings: 0, errors: 0 } },
              packs: { builtin: [], user: [] },
              sites: [],
            },
          };
        }
        if (request.command === "neighbor") {
          return {
            data: {
              enabled: false,
              self: { nodeId: "self-node", publicIdentity: "self" },
              summary: { unreadCount: 0, lastMessageAt: "", lastProbeAt: "", reachableCount: 0 },
              neighbors: [],
              mailbox: { updatedAt: "", entries: [] },
            },
          };
        }
        threadReads += 1;
        if (threadReads === 1) {
          return {
            data: {
              thread: {
                title: "hello",
                writable: true,
                lastTurnAt: "2026-03-28T10:00:00.000Z",
                messages: [{ user: "u1", assistant: "" }],
              },
              schedules: [],
              workStatus: { recentEntries: [] },
            },
          };
        }
        return {
          data: {
            thread: {
              title: "hello",
              writable: true,
              lastTurnAt: "2026-03-28T10:00:05.000Z",
              messages: [{ user: "u1", assistant: "a1" }],
            },
            schedules: [],
            workStatus: { recentEntries: [] },
          },
        };
      },
    };

    await startThreadSurface(documentLike, bridge);
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).not.toContain("a1");

    updateListener?.({
      workspacePath: "/tmp/family",
      threadId: "thread-1",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(threadReads).toBe(2);
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("a1");
  });

  it("clears composer input on success and keeps it on failure", async () => {
    const listeners = new Map<string, (event: { key?: string; shiftKey?: boolean; preventDefault?: () => void }) => void>();
    const requests: Array<{ kind: "read" | "write"; request: unknown }> = [];
    const input = {
      textContent: null,
      innerHTML: "",
      value: "hello desktop",
      disabled: false,
      addEventListener(type: string, listener: (event: { key?: string; shiftKey?: boolean; preventDefault?: () => void }) => void) {
        listeners.set(`input:${type}`, listener);
      },
    };
    const button = {
      textContent: null,
      innerHTML: "",
      disabled: false,
      addEventListener(type: string, listener: (event: { key?: string; shiftKey?: boolean; preventDefault?: () => void }) => void) {
        listeners.set(`button:${type}`, listener);
      },
    };
    const error = {
      textContent: "",
      innerHTML: "",
    };
    const documentLike = {
      open() {},
      write() {},
      close() {},
      querySelector(selector: string) {
        if (selector === '[data-thread-composer-input="true"]') return input;
        if (selector === '[data-thread-composer-send="true"]') return button;
        if (selector === '[data-thread-composer-error="true"]') return error;
        return null;
      },
    };

    const sent: Array<{ workspacePath: string; threadId: string; text: string }> = [];
    bindThreadComposer(documentLike, {
      mode: "live",
      onThreadUpdate() {
        return () => {};
      },
      async runCommand(request: unknown) {
        requests.push({ kind: "read", request });
        return {
          data: {
            thread: {
              writable: true,
              title: "hello",
              lastTurnAt: "2026-03-28T10:00:00.000Z",
              messages: [{ user: "hello desktop", assistant: "" }],
            },
          },
        };
      },
      async sendThreadInput(request) {
        requests.push({ kind: "write", request });
        sent.push(request);
      },
    }, {
      selectedSection: "workspace",
      selectedWorkspace: "family",
      selectedWorkspacePath: "/tmp/family",
      selectedThreadId: "thread-web",
      workspaceTree: {},
      thread: {
        data: {
          thread: {
            writable: true,
          },
        },
      },
      profile: null,
      capabilities: null,
      hall: null,
      neighbor: null,
      loadingError: null,
    });

    await listeners.get("input:keydown")?.({
      key: "Enter",
      shiftKey: false,
      preventDefault() {},
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toEqual([{ workspacePath: "/tmp/family", threadId: "thread-web", text: "hello desktop" }]);
    expect(input.value).toBe("");
    expect(input.disabled).toBe(true);
    expect(button.disabled).toBe(true);
    expect(requests).toContainEqual({
      kind: "read",
      request: { command: "thread", workspace: "family", threadId: "thread-web" },
    });

    input.value = "keep me";
    const failingBridge = {
      mode: "live" as const,
      onThreadUpdate() {
        return () => {};
      },
      async runCommand() {
        return {};
      },
      async sendThreadInput() {
        throw new Error("write failed");
      },
    };
    bindThreadComposer(documentLike, failingBridge, {
      selectedSection: "workspace",
      selectedWorkspace: "family",
      selectedWorkspacePath: "/tmp/family",
      selectedThreadId: "thread-web-2",
      workspaceTree: {},
      thread: {
        data: {
          thread: {
            writable: true,
          },
        },
      },
      profile: null,
      capabilities: null,
      hall: null,
      neighbor: null,
      loadingError: null,
    });

    await listeners.get("button:click")?.({
      preventDefault() {},
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(input.value).toBe("keep me");
    expect(error.textContent).toBe("write failed");
  });

  it("reloads thread surface when workspace or thread selection changes", async () => {
    const panels = new Map<string, { textContent: string | null; innerHTML: string }>([
      ['[data-surface-slot="workspace-tree"]', { textContent: null, innerHTML: "" }],
      ['[data-surface-slot="thread"]', { textContent: null, innerHTML: "" }],
      ['[data-surface-slot="thread-rail"]', { textContent: null, innerHTML: "" }],
    ]);
    const makeButton = (attrs: Record<string, string>) => {
      const listeners = new Map<string, (event: { preventDefault?: () => void }) => void>();
      return {
        textContent: null,
        innerHTML: "",
        getAttribute(name: string) {
          return attrs[name] ?? null;
        },
        addEventListener(type: string, listener: (event: { preventDefault?: () => void }) => void) {
          listeners.set(type, listener);
        },
        async click() {
          await listeners.get("click")?.({ preventDefault() {} });
        },
      };
    };
    const workspaceButton = makeButton({
      "data-workspace-name": "other",
      "data-workspace-path": "/tmp/other",
    });
    const threadButton = makeButton({
      "data-workspace-name": "family",
      "data-workspace-path": "/tmp/family",
      "data-thread-id": "thread-2",
    });
    const documentLike = {
      open() {},
      write() {},
      close() {},
      querySelector(selector: string) {
        return panels.get(selector) ?? null;
      },
      querySelectorAll(selector: string) {
        if (selector === '[data-workspace-select="true"]') return [workspaceButton];
        if (selector === '[data-thread-select="true"]') return [threadButton];
        return [];
      },
    };
    const requests: Array<{ command: string; workspace?: string; threadId?: string }> = [];
    const bridge = {
      mode: "live" as const,
      onThreadUpdate() {
        return () => {};
      },
      async sendThreadInput() {},
      async runCommand(request: { command: string; workspace?: string; threadId?: string }) {
        requests.push(request);
        if (request.command === "profile") {
          return {
            data: {
              memory: { enabled: true, topK: 5, maxChars: 2000 },
              soul: { path: `${request.workspace}/.msgcode/SOUL.md`, exists: true, content: "" },
            },
          };
        }
        if (request.command === "capabilities") {
          return {
            data: {
              capabilities: [{ id: "brain", model: "gpt-5.4", note: "api:openai", configured: true }],
            },
          };
        }
        if (request.command === "hall") {
          return {
            data: {
              org: { name: "msgcode" },
              runtime: { summary: { status: "pass", warnings: 0, errors: 0 }, logPath: "/tmp/other/log" },
              packs: { builtin: [], user: [] },
              sites: [],
            },
          };
        }
        if (request.command === "neighbor") {
          return {
            data: {
              enabled: true,
              self: { nodeId: "self-node", publicIdentity: "self" },
              summary: { unreadCount: 0, lastMessageAt: "", lastProbeAt: "", reachableCount: 0 },
              neighbors: [],
              mailbox: { updatedAt: "", entries: [] },
            },
          };
        }
        if (request.workspace === "other") {
          return {
            data: {
              thread: {
                title: "other thread",
                writable: false,
                messages: [{ assistant: "from other" }],
              },
              schedules: [],
              workStatus: { recentEntries: [] },
            },
          };
        }
        return {
          data: {
            thread: {
              title: "family thread 2",
              writable: true,
              messages: [{ user: "from family" }],
            },
            schedules: [],
            workStatus: { recentEntries: [] },
          },
        };
      },
    };

    bindThreadSurfaceSelection(
      documentLike,
      bridge,
      {
        selectedSection: "workspace",
        selectedWorkspace: "family",
        selectedWorkspacePath: "/tmp/family",
        selectedThreadId: "thread-1",
        workspaceTree: {
          data: {
            workspaces: [
              {
                name: "family",
                path: "/tmp/family",
                threads: [
                  { threadId: "thread-1", title: "family thread 1" },
                  { threadId: "thread-2", title: "family thread 2" },
                ],
              },
              {
                name: "other",
                path: "/tmp/other",
                threads: [{ threadId: "other-thread-1", title: "other thread" }],
              },
            ],
          },
        },
        thread: null,
        profile: null,
        capabilities: null,
        hall: null,
        neighbor: null,
        loadingError: null,
      },
    );

    await workspaceButton.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toContainEqual({
      command: "thread",
      workspace: "other",
      threadId: "other-thread-1",
    });
    expect(requests).toContainEqual({
      command: "profile",
      workspace: "/tmp/other",
    });
    expect(requests).toContainEqual({
      command: "capabilities",
      workspace: "/tmp/other",
    });
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("<h2>other thread</h2>");

    await threadButton.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toContainEqual({
      command: "thread",
      workspace: "family",
      threadId: "thread-2",
    });
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("<h2>family thread 2</h2>");
  });

  it("switches top nav sections without losing the active workspace", async () => {
    const panels = new Map<string, { textContent: string | null; innerHTML: string }>([
      ['[data-surface-slot="workspace-tree"]', { textContent: null, innerHTML: "" }],
      ['[data-surface-slot="thread"]', { textContent: null, innerHTML: "" }],
      ['[data-surface-slot="thread-rail"]', { textContent: null, innerHTML: "" }],
    ]);
    const makeButton = (attrs: Record<string, string>) => {
      const listeners = new Map<string, (event: { preventDefault?: () => void }) => void>();
      return {
        textContent: null,
        innerHTML: "",
        getAttribute(name: string) {
          return attrs[name] ?? null;
        },
        addEventListener(type: string, listener: (event: { preventDefault?: () => void }) => void) {
          listeners.set(type, listener);
        },
        async click() {
          await listeners.get("click")?.({ preventDefault() {} });
        },
      };
    };
    const baseButton = makeButton({ "data-surface-nav": "base" });
    const neighborButton = makeButton({ "data-surface-nav": "neighbor" });
    const documentLike = {
      open() {},
      write() {},
      close() {},
      querySelector(selector: string) {
        return panels.get(selector) ?? null;
      },
      querySelectorAll(selector: string) {
        if (selector === '[data-surface-nav-select="true"]') return [baseButton, neighborButton];
        return [];
      },
    };

    bindThreadSurfaceNav(documentLike, {
      mode: "live",
      onThreadUpdate() {
        return () => {};
      },
      async sendThreadInput() {},
      async runCommand() {
        return {};
      },
    }, {
      selectedSection: "workspace",
      selectedWorkspace: "family",
      selectedWorkspacePath: "/tmp/family",
      selectedThreadId: "thread-1",
      workspaceTree: { data: { workspaces: [] } },
      thread: null,
      profile: null,
      capabilities: null,
      hall: {
        data: {
          org: { name: "msgcode", taxRegion: "SG", uscc: "UEN-1" },
          runtime: { summary: { status: "pass", warnings: 0, errors: 0 } },
          packs: { builtin: [], user: [] },
          sites: [],
        },
      },
      neighbor: {
        data: {
          enabled: true,
          self: { nodeId: "self-node", publicIdentity: "self" },
          summary: { unreadCount: 0, lastMessageAt: "", lastProbeAt: "", reachableCount: 0 },
          neighbors: [{ nodeId: "neighbor-1", displayName: "邻居01", unreadCount: 0, state: "contact" }],
          mailbox: { updatedAt: "", entries: [] },
        },
      },
      loadingError: null,
    });

    await baseButton.click();
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("基座总览");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("Base Rail");

    await neighborButton.click();
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("邻居邮箱");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("Neighbor Rail");
  });
});

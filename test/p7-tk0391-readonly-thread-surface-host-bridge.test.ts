import { describe, expect, it } from "bun:test";
import { buildReadonlySurfaceCliCommand } from "../src/electron/main.js";
import {
  createReadonlySurfaceBridge,
  getReadonlySurfaceChannel,
  getSendThreadInputChannel,
} from "../src/electron/readonly-surface-bridge.js";
import {
  bindReadonlyThreadComposer,
  bindReadonlyThreadSurfaceSelection,
  startReadonlyThreadSurface,
} from "../src/electron/renderer.js";

describe("readonly thread surface host bridge slice", () => {
  it("invokes the shared readonly channel through the preload bridge", async () => {
    const ipcRenderer = {
      async invoke(channel: string, request: unknown) {
        return { channel, request };
      },
    };
    const bridge = createReadonlySurfaceBridge(
      ipcRenderer as never,
      getReadonlySurfaceChannel(),
      getSendThreadInputChannel(),
    );
    expect(bridge.mode).toBe("live");
    await expect(bridge.runCommand({ command: "workspace-tree" })).resolves.toEqual({
      channel: "msgcode:readonly-run-command",
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

  it("builds readonly surface cli invocations from the shared runtime entry", () => {
    const workspaceTree = buildReadonlySurfaceCliCommand(
      { command: "workspace-tree" },
      {
        env: { MSGCODE_CLI_ENTRY: "/tmp/msgcode/dist/cli.js" },
        nodePath: "/usr/local/bin/node",
      },
    );
    expect(workspaceTree.command).toBe("/usr/local/bin/node");
    expect(workspaceTree.args.slice(-3)).toEqual(["appliance", "workspace-tree", "--json"]);
    expect(workspaceTree.cwd).toBe("/Users/admin/GitProjects/msgcode");

    const thread = buildReadonlySurfaceCliCommand(
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
      async sendThreadInput() {},
      async runCommand(request: { command: string }) {
        if (request.command === "workspace-tree") {
          return {
            data: {
              workspaces: [{ name: "family", path: "/tmp/family", threads: [{ threadId: "thread-1", title: "hello" }] }],
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

    await startReadonlyThreadSurface(documentLike, bridge);

    expect(panels.get('[data-surface-slot="workspace-tree"]')?.innerHTML).toContain("family");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("<h2>hello</h2>");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("message-list-stack");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("message-row--user");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("bubble--user");
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain('data-thread-composer="true"');
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("定时任务");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain(">1<");
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
    bindReadonlyThreadComposer(documentLike, {
      mode: "live",
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
      async runCommand() {
        return {};
      },
      async sendThreadInput() {
        throw new Error("write failed");
      },
    };
    bindReadonlyThreadComposer(documentLike, failingBridge, {
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
      async sendThreadInput() {},
      async runCommand(request: { command: string; workspace?: string; threadId?: string }) {
        requests.push(request);
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

    bindReadonlyThreadSurfaceSelection(
      documentLike,
      bridge,
      {
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
        loadingError: null,
      },
    );

    await workspaceButton.click();
    await Promise.resolve();
    expect(requests).toContainEqual({
      command: "thread",
      workspace: "other",
      threadId: "other-thread-1",
    });
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("<h2>other thread</h2>");

    await threadButton.click();
    await Promise.resolve();
    expect(requests).toContainEqual({
      command: "thread",
      workspace: "family",
      threadId: "thread-2",
    });
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("<h2>family thread 2</h2>");
  });
});

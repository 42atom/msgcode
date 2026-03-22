import { describe, expect, it } from "bun:test";
import { buildReadonlySurfaceCliCommand } from "../src/electron/main.js";
import { createReadonlySurfaceBridge, getReadonlySurfaceChannel } from "../src/electron/readonly-surface-bridge.js";
import { startReadonlyThreadSurface } from "../src/electron/renderer.js";

describe("readonly thread surface host bridge slice", () => {
  it("invokes the shared readonly channel through the preload bridge", async () => {
    const ipcRenderer = {
      async invoke(channel: string, request: unknown) {
        return { channel, request };
      },
    };
    const bridge = createReadonlySurfaceBridge(ipcRenderer as never, getReadonlySurfaceChannel());
    expect(bridge.mode).toBe("live");
    await expect(bridge.runCommand({ command: "workspace-tree" })).resolves.toEqual({
      channel: "msgcode:readonly-run-command",
      request: { command: "workspace-tree" },
    });
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
    expect(panels.get('[data-surface-slot="thread"]')?.innerHTML).toContain("title: hello");
    expect(panels.get('[data-surface-slot="thread-rail"]')?.innerHTML).toContain("schedules: 1");
  });
});

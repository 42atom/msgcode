import { describe, expect, it } from "bun:test";
import {
  buildThreadSurfaceChrome,
  renderThreadSurfaceMarkup,
} from "../src/ui/main-window/readonly-thread-surface.js";

describe("readonly thread surface src implementation", () => {
  it("keeps the first cut to three columns, settings affordance, and a bridge slot", () => {
    const chrome = buildThreadSurfaceChrome({
      selectedWorkspace: "family",
      selectedThreadId: "thread-feishu",
      loadingError: null,
    });

    expect(chrome.kind).toBe("thread-surface");
    expect(chrome.transientStateKeys).toEqual([
      "selectedWorkspace",
      "selectedThreadId",
      "loadingError",
    ]);
    expect(chrome.dataFeeds).toEqual(["workspace-tree", "thread"]);
    expect(chrome.columns.map((column) => column.id)).toEqual([
      "workspace-tree",
      "thread",
      "thread-rail",
    ]);
    expect(chrome.settingsAffordance).toEqual({
      id: "settings",
      label: "Settings",
      href: "#settings",
    });
    expect(chrome.bridgeSlot).toEqual({
      id: "host-bridge",
      entryPoint: "window.msgcodeThreadSurface.runCommand",
      purpose: "future-host-bridge",
    });
    expect(chrome.blockedActions).toEqual(["archive", "new chat"]);
    expect(Object.keys(chrome.state).sort()).toEqual([
      "loadingError",
      "selectedThreadId",
      "selectedWorkspace",
    ]);

    const markup = renderThreadSurfaceMarkup(chrome);
    expect(markup).toContain('class="left-panel"');
    expect(markup).toContain('class="middle-panel"');
    expect(markup).toContain('class="right-panel"');
    expect(markup).toContain('data-surface-slot="workspace-tree"');
    expect(markup).toContain('data-surface-slot="thread"');
    expect(markup).toContain('data-surface-slot="thread-rail"');
    expect(markup).toContain('data-bridge-slot="host-bridge"');
    expect(markup).toContain('data-bridge-entry="window.msgcodeThreadSurface.runCommand"');
    expect(markup).toContain('href="#settings"');
    expect(markup).toContain('--theme-brand: #3b82f6;');
    expect(markup).toContain('--theme-selected: #e5e5e5;');
    expect(markup).toContain('--font-family-ui: "Maple Mono NF CN", "Maple Mono", ui-monospace, monospace;');
    expect(markup).toContain('letter-spacing: var(--font-ui-dense-tracking);');
    expect(markup).toContain('.thread-row.is-selected { background: var(--theme-selected); }');
    expect(markup).toContain('.thread-composer__send { min-width: 72px; min-height: 34px; border: 0; border-radius: 10px; background: var(--theme-brand); color: var(--theme-bg); font: inherit; }');
    expect(markup).not.toContain("archive");
    expect(markup).not.toContain("new chat");
  });
});

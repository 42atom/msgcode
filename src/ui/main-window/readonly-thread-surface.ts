export interface ReadonlyThreadSurfaceState {
  selectedWorkspace: string;
  selectedThreadId: string;
  loadingError: string | null;
}

export type ReadonlyThreadSurfaceColumnId = "workspace-tree" | "thread" | "thread-rail";

export interface ReadonlyThreadSurfaceColumn {
  id: ReadonlyThreadSurfaceColumnId;
  label: string;
  slot: ReadonlyThreadSurfaceColumnId;
}

export interface ReadonlyThreadSurfaceSettingsAffordance {
  id: "settings";
  label: "Settings";
  href: "#settings";
}

export interface ReadonlyThreadSurfaceBridgeSlot {
  id: "host-bridge";
  entryPoint: "window.msgcodeReadonlySurface.runCommand";
  purpose: "future-host-bridge";
}

export interface ReadonlyThreadSurfaceChrome {
  kind: "readonly-thread-surface";
  state: ReadonlyThreadSurfaceState;
  transientStateKeys: readonly ["selectedWorkspace", "selectedThreadId", "loadingError"];
  dataFeeds: readonly ["workspace-tree", "thread"];
  columns: readonly ReadonlyThreadSurfaceColumn[];
  settingsAffordance: ReadonlyThreadSurfaceSettingsAffordance;
  bridgeSlot: ReadonlyThreadSurfaceBridgeSlot;
  blockedActions: readonly ["archive", "new chat", "composer", "send"];
}

export function buildReadonlyThreadSurfaceChrome(
  state: ReadonlyThreadSurfaceState,
): ReadonlyThreadSurfaceChrome {
  return {
    kind: "readonly-thread-surface",
    state: {
      selectedWorkspace: state.selectedWorkspace,
      selectedThreadId: state.selectedThreadId,
      loadingError: state.loadingError,
    },
    transientStateKeys: ["selectedWorkspace", "selectedThreadId", "loadingError"],
    dataFeeds: ["workspace-tree", "thread"],
    columns: [
      { id: "workspace-tree", label: "Workspace Tree", slot: "workspace-tree" },
      { id: "thread", label: "Thread", slot: "thread" },
      { id: "thread-rail", label: "Thread Rail", slot: "thread-rail" },
    ],
    settingsAffordance: {
      id: "settings",
      label: "Settings",
      href: "#settings",
    },
    bridgeSlot: {
      id: "host-bridge",
      entryPoint: "window.msgcodeReadonlySurface.runCommand",
      purpose: "future-host-bridge",
    },
    blockedActions: ["archive", "new chat", "composer", "send"],
  };
}

export function renderReadonlyThreadSurfaceMarkup(chrome: ReadonlyThreadSurfaceChrome): string {
  const errorText = chrome.state.loadingError?.trim() || "No loading error";
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>msgcode main window</title>",
    "  </head>",
    `  <body data-surface="${escapeHtml(chrome.kind)}">`,
    '    <header class="topbar" data-surface-slot="topbar">',
    '      <div class="topbar__brand" aria-label="msgcode">',
    '        <h1>msgcode</h1>',
    "      </div>",
    '      <nav class="topbar__status" aria-label="surface status">',
    '        <span class="status-pill">workspace-tree</span>',
    '        <span class="status-pill">thread</span>',
    `        <a class="settings-entry" href="${escapeHtml(chrome.settingsAffordance.href)}" aria-label="Open settings">${escapeHtml(chrome.settingsAffordance.label)}</a>`,
    "      </nav>",
    "    </header>",
    '    <main class="three-column" aria-label="readonly thread surface">',
    renderColumn("workspace-tree", chrome.columns[0]?.label ?? "Workspace Tree", [
      "Workspace Tree",
      "workspace-tree",
    ]),
    renderColumn("thread", chrome.columns[1]?.label ?? "Thread", [
      "Thread",
      `selectedWorkspace: ${chrome.state.selectedWorkspace || "-"}`,
      `selectedThreadId: ${chrome.state.selectedThreadId || "-"}`,
      `loadingError: ${errorText}`,
    ]),
    renderColumn("thread-rail", chrome.columns[2]?.label ?? "Thread Rail", [
      "Thread Rail",
      "settings entry only",
    ]),
    "    </main>",
    `    <template data-bridge-slot="${escapeHtml(chrome.bridgeSlot.id)}" data-bridge-entry="${escapeHtml(chrome.bridgeSlot.entryPoint)}"></template>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function renderColumn(
  slot: ReadonlyThreadSurfaceColumnId,
  title: string,
  lines: string[],
): string {
  return [
    `      <section class="panel panel--${escapeHtml(slot)}" data-surface-slot="${escapeHtml(slot)}">`,
    `        <h2>${escapeHtml(title)}</h2>`,
    ...lines.map((line) => `        <p>${escapeHtml(line)}</p>`),
    "      </section>",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


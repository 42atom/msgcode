export interface ThreadSurfaceState {
  selectedWorkspace: string;
  selectedThreadId: string;
  loadingError: string | null;
}

export type ThreadSurfaceColumnId = "workspace-tree" | "thread" | "thread-rail";

export interface ThreadSurfaceColumn {
  id: ThreadSurfaceColumnId;
  label: string;
  slot: ThreadSurfaceColumnId;
}

export interface ThreadSurfaceSettingsAffordance {
  id: "settings";
  label: "Settings";
  href: "#settings";
}

export interface ThreadSurfaceBridgeSlot {
  id: "host-bridge";
  entryPoint: "window.msgcodeReadonlySurface.runCommand";
  purpose: "future-host-bridge";
}

export interface ThreadSurfaceChrome {
  kind: "thread-surface";
  state: ThreadSurfaceState;
  transientStateKeys: readonly ["selectedWorkspace", "selectedThreadId", "loadingError"];
  dataFeeds: readonly ["workspace-tree", "thread"];
  columns: readonly ThreadSurfaceColumn[];
  settingsAffordance: ThreadSurfaceSettingsAffordance;
  bridgeSlot: ThreadSurfaceBridgeSlot;
  blockedActions: readonly ["archive", "new chat"];
}

export function buildThreadSurfaceChrome(
  state: ThreadSurfaceState,
): ThreadSurfaceChrome {
  return {
    kind: "thread-surface",
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
    blockedActions: ["archive", "new chat"],
  };
}

export function renderThreadSurfaceMarkup(chrome: ThreadSurfaceChrome): string {
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>msgcode main window</title>",
    "    <style>",
    renderThreadSurfaceStyles(),
    "    </style>",
    "  </head>",
    `  <body data-surface="${escapeHtml(chrome.kind)}">`,
    '    <header class="app-topbar" data-surface-slot="topbar">',
    '      <div class="app-topbar__brand" aria-label="msgcode">',
    '        <span class="app-topbar__eyebrow">Main Window</span>',
    "        <h1>msgcode</h1>",
    "      </div>",
    '      <nav class="app-topbar__status" aria-label="surface status">',
    '        <span class="status-pill">workspace</span>',
    '        <span class="status-pill">thread</span>',
    '        <span class="status-pill">rail</span>',
    `        <a class="settings-entry" href="${escapeHtml(chrome.settingsAffordance.href)}" aria-label="Open settings">${escapeHtml(chrome.settingsAffordance.label)}</a>`,
    "      </nav>",
    "    </header>",
    '    <main class="app-main" aria-label="thread surface">',
    '      <section class="left-panel">',
    renderPanelShell("workspace-tree", chrome.columns[0]?.label ?? "Workspace Tree", "Workspaces"),
    "      </section>",
    '      <section class="middle-panel">',
    renderPanelShell("thread", chrome.columns[1]?.label ?? "Thread", "Thread"),
    "      </section>",
    '      <section class="right-panel">',
    renderPanelShell("thread-rail", chrome.columns[2]?.label ?? "Thread Rail", "Thread Rail"),
    "      </section>",
    "    </main>",
    `    <template data-bridge-slot="${escapeHtml(chrome.bridgeSlot.id)}" data-bridge-entry="${escapeHtml(chrome.bridgeSlot.entryPoint)}"></template>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function renderPanelShell(
  slot: ThreadSurfaceColumnId,
  title: string,
  eyebrow: string,
): string {
  return [
    `        <section class="surface-panel surface-panel--${escapeHtml(slot)}" data-surface-slot="${escapeHtml(slot)}">`,
    '          <header class="surface-panel__header">',
    `            <p class="surface-panel__eyebrow">${escapeHtml(eyebrow)}</p>`,
    `            <h2>${escapeHtml(title)}</h2>`,
    "          </header>",
    '          <div class="surface-panel__body">',
    "          </div>",
    "        </section>",
  ].join("\n");
}

function renderThreadSurfaceStyles(): string {
  return [
    ":root {",
    "  color-scheme: light;",
    '  --theme-brand: #3b82f6;',
    '  --theme-text: #000000;',
    '  --theme-bg: #ffffff;',
    '  --theme-surface: #f3f3f4;',
    '  --theme-selected: #e5e5e5;',
    '  --font-family-ui: "Maple Mono NF CN", "Maple Mono", ui-monospace, monospace;',
    '  --font-ui-sm-size: 11px;',
    '  --font-ui-sm-line: 16px;',
    '  --font-ui-md-size: 13px;',
    '  --font-ui-md-line: 20px;',
    '  --font-ui-lg-size: 17px;',
    '  --font-ui-lg-line: 24px;',
    '  --font-ui-dense-tracking: -1px;',
    '  --opacity-subtle: 0.6;',
    '  --opacity-muted: 0.4;',
    "  background: var(--theme-bg);",
    "  color: var(--theme-text);",
    "}",
    "* { box-sizing: border-box; }",
    "html, body { height: 100%; margin: 0; }",
    "body { background: var(--theme-bg); color: var(--theme-text); font-family: var(--font-family-ui); }",
    ".app-topbar {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  gap: 12px;",
    "  height: 48px;",
    "  padding: 8px 14px;",
    "  border-bottom: 1px solid rgba(0,0,0,0.08);",
    "}",
    ".app-topbar__brand h1 { margin: 0; font-size: var(--font-ui-lg-size); line-height: var(--font-ui-lg-line); font-weight: 500; }",
    ".app-topbar__eyebrow { display: block; font-size: var(--font-ui-sm-size); line-height: var(--font-ui-sm-line); opacity: var(--opacity-subtle); margin-bottom: 4px; }",
    ".app-topbar__status { display: flex; align-items: center; gap: 8px; }",
    ".status-pill, .settings-entry {",
    "  display: inline-flex;",
    "  align-items: center;",
    "  min-height: 24px;",
    "  padding: 0 8px;",
    "  border-radius: 10px;",
    "  background: var(--theme-surface);",
    "  font-size: var(--font-ui-sm-size);",
    "  line-height: var(--font-ui-sm-line);",
    "  color: inherit;",
    "  text-decoration: none;",
    "}",
    ".app-main {",
    "  display: grid;",
    "  grid-template-columns: 248px minmax(0, 1fr) 292px;",
    "  gap: 10px;",
    "  height: calc(100% - 48px);",
    "  padding: 10px;",
    "}",
    ".left-panel, .middle-panel, .right-panel { min-width: 0; min-height: 0; }",
    ".surface-panel {",
    "  display: flex;",
    "  flex-direction: column;",
    "  width: 100%;",
    "  height: 100%;",
    "  min-height: 0;",
    "  background: var(--theme-bg);",
    "  border: 1px solid rgba(0,0,0,0.08);",
    "  border-radius: 12px;",
    "  overflow: hidden;",
    "}",
    ".surface-panel__header {",
    "  display: flex;",
    "  flex-direction: column;",
    "  gap: 2px;",
    "  padding: 10px 12px 8px;",
    "  border-bottom: 1px solid rgba(0,0,0,0.06);",
    "}",
    ".surface-panel__eyebrow { margin: 0; font-size: var(--font-ui-sm-size); line-height: var(--font-ui-sm-line); opacity: var(--opacity-subtle); }",
    ".surface-panel__header h2 { margin: 0; font-size: var(--font-ui-md-size); line-height: var(--font-ui-md-line); font-weight: 500; }",
    ".surface-panel__body {",
    "  flex: 1;",
    "  min-height: 0;",
    "  padding: 10px 12px;",
    "  overflow: auto;",
    "}",
    ".workspace-list, .observer-stack { display: flex; flex-direction: column; gap: 10px; }",
    ".workspace-group { display: flex; flex-direction: column; gap: 4px; }",
    ".workspace-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 24px; padding: 0; border: 0; background: transparent; text-align: left; color: inherit; font: inherit; }",
    ".workspace-row:hover { opacity: 0.88; }",
    ".workspace-row.is-selected { opacity: 1; }",
    ".workspace-row__title { font-size: var(--font-ui-md-size); line-height: var(--font-ui-md-line); font-weight: 500; }",
    ".workspace-row__meta { font-size: var(--font-ui-sm-size); line-height: var(--font-ui-sm-line); opacity: var(--opacity-subtle); }",
    ".thread-list { display: flex; flex-direction: column; gap: 2px; }",
    ".thread-row { width: 100%; min-height: 24px; padding: 0 8px 0 16px; display: flex; align-items: center; border: 0; border-radius: 10px; background: transparent; text-align: left; color: inherit; font: inherit; }",
    ".thread-row.is-selected { background: var(--theme-selected); }",
    ".thread-row.is-selected .thread-row__title { color: var(--theme-brand); }",
    ".thread-row__title { font-size: var(--font-ui-md-size); line-height: var(--font-ui-md-line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: var(--font-ui-dense-tracking); }",
    ".thread-stage { display: flex; flex-direction: column; gap: 10px; }",
    ".thread-head-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }",
    ".inline-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 10px; background: var(--theme-surface); font-size: var(--font-ui-sm-size); line-height: var(--font-ui-sm-line); }",
    ".inline-chip--muted { opacity: var(--opacity-subtle); }",
    ".message-list-host { display: flex; min-height: 0; }",
    ".message-list-stack { display: flex; flex-direction: column; gap: 8px; width: 100%; min-height: 0; }",
    ".message-row { display: flex; width: 100%; }",
    ".message-row--user { justify-content: flex-end; }",
    ".message-row--agent, .message-row--empty, .message-row--error { justify-content: flex-start; }",
    ".bubble { max-width: 82%; padding: 8px 10px; border-radius: 12px; font-size: var(--font-ui-md-size); line-height: var(--font-ui-md-line); white-space: pre-wrap; overflow-wrap: anywhere; }",
    ".bubble--user { margin-left: auto; background: var(--theme-surface); }",
    ".bubble--agent { background: transparent; padding-left: 0; }",
    ".thread-composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding-top: 6px; border-top: 1px solid rgba(0,0,0,0.06); }",
    ".thread-composer__input { width: 100%; min-height: 34px; border: 1px solid rgba(0,0,0,0.08); border-radius: 10px; padding: 0 10px; background: var(--theme-bg); color: var(--theme-text); font: inherit; }",
    ".thread-composer__send { min-width: 72px; min-height: 34px; border: 0; border-radius: 10px; background: var(--theme-brand); color: var(--theme-bg); font: inherit; }",
    ".thread-composer__error { grid-column: 1 / -1; margin: 0; font-size: var(--font-ui-sm-size); line-height: var(--font-ui-sm-line); color: #b42318; }",
    ".observer-section { display: flex; flex-direction: column; gap: 6px; }",
    ".observer-section__header h3 { margin: 0; font-size: var(--font-ui-sm-size); line-height: var(--font-ui-sm-line); opacity: var(--opacity-subtle); font-weight: 500; }",
    ".observer-rows { display: flex; flex-direction: column; gap: 6px; }",
    ".observer-row { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 8px; align-items: start; }",
    ".observer-row__label { font-size: var(--font-ui-sm-size); line-height: var(--font-ui-sm-line); opacity: var(--opacity-subtle); }",
    ".observer-row__value { font-size: var(--font-ui-md-size); line-height: var(--font-ui-md-line); overflow-wrap: anywhere; }",
    ".empty-state { margin: 0; font-size: var(--font-ui-sm-size); line-height: var(--font-ui-sm-line); opacity: var(--opacity-subtle); }",
    ".thread-error { margin: 0; font-size: var(--font-ui-sm-size); line-height: var(--font-ui-sm-line); color: #b42318; }",
  ].join("\n");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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
  blockedActions: readonly ["archive", "new chat"];
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
    blockedActions: ["archive", "new chat"],
  };
}

export function renderReadonlyThreadSurfaceMarkup(chrome: ReadonlyThreadSurfaceChrome): string {
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>msgcode main window</title>",
    "    <style>",
    renderReadonlyThreadSurfaceStyles(),
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
    '    <main class="app-main" aria-label="readonly thread surface">',
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
  slot: ReadonlyThreadSurfaceColumnId,
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

function renderReadonlyThreadSurfaceStyles(): string {
  return [
    ":root {",
    "  color-scheme: light;",
    '  font-family: "Maple Mono NF CN", "Maple Mono", ui-monospace, monospace;',
    "  background: #ffffff;",
    "  color: #000000;",
    "}",
    "* { box-sizing: border-box; }",
    "html, body { height: 100%; margin: 0; }",
    "body { background: #ffffff; color: #000000; }",
    ".app-topbar {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  gap: 12px;",
    "  height: 48px;",
    "  padding: 8px 14px;",
    "  border-bottom: 1px solid rgba(0,0,0,0.08);",
    "}",
    ".app-topbar__brand h1 { margin: 0; font-size: 17px; line-height: 1; }",
    ".app-topbar__eyebrow { display: block; font-size: 11px; line-height: 1; opacity: 0.6; margin-bottom: 4px; }",
    ".app-topbar__status { display: flex; align-items: center; gap: 8px; }",
    ".status-pill, .settings-entry {",
    "  display: inline-flex;",
    "  align-items: center;",
    "  min-height: 24px;",
    "  padding: 0 8px;",
    "  border-radius: 10px;",
    "  background: #f3f3f4;",
    "  font-size: 11px;",
    "  line-height: 1;",
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
    "  background: #ffffff;",
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
    ".surface-panel__eyebrow { margin: 0; font-size: 11px; line-height: 1; opacity: 0.6; }",
    ".surface-panel__header h2 { margin: 0; font-size: 13px; line-height: 1; }",
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
    ".workspace-row__title { font-size: 13px; line-height: 1; font-weight: 500; }",
    ".workspace-row__meta { font-size: 11px; line-height: 1; opacity: 0.6; }",
    ".thread-list { display: flex; flex-direction: column; gap: 2px; }",
    ".thread-row { width: 100%; min-height: 24px; padding: 0 8px 0 16px; display: flex; align-items: center; border: 0; border-radius: 10px; background: transparent; text-align: left; color: inherit; font: inherit; }",
    ".thread-row.is-selected { background: #f3f3f4; }",
    ".thread-row__title { font-size: 13px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; }",
    ".thread-stage { display: flex; flex-direction: column; gap: 10px; }",
    ".thread-head-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }",
    ".inline-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 10px; background: #f3f3f4; font-size: 11px; line-height: 1; }",
    ".inline-chip--muted { opacity: 0.6; }",
    ".message-list-host { display: flex; flex-direction: column; gap: 8px; min-height: 0; }",
    ".bubble { max-width: 82%; padding: 8px 10px; border-radius: 12px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }",
    ".bubble--user { margin-left: auto; background: #f3f3f4; }",
    ".bubble--agent { background: transparent; padding-left: 0; }",
    ".thread-composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding-top: 6px; border-top: 1px solid rgba(0,0,0,0.06); }",
    ".thread-composer__input { width: 100%; min-height: 34px; border: 1px solid rgba(0,0,0,0.08); border-radius: 10px; padding: 0 10px; font: inherit; }",
    ".thread-composer__send { min-width: 72px; min-height: 34px; border: 0; border-radius: 10px; background: #3b82f6; color: #fff; font: inherit; }",
    ".thread-composer__error { grid-column: 1 / -1; margin: 0; font-size: 11px; line-height: 1.2; color: #b42318; }",
    ".observer-section { display: flex; flex-direction: column; gap: 6px; }",
    ".observer-section__header h3 { margin: 0; font-size: 11px; line-height: 1; opacity: 0.6; font-weight: 500; }",
    ".observer-rows { display: flex; flex-direction: column; gap: 6px; }",
    ".observer-row { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 8px; align-items: start; }",
    ".observer-row__label { font-size: 11px; line-height: 1.2; opacity: 0.6; }",
    ".observer-row__value { font-size: 13px; line-height: 1.3; overflow-wrap: anywhere; }",
    ".empty-state { margin: 0; font-size: 11px; line-height: 1.2; opacity: 0.6; }",
    ".thread-error { margin: 0; font-size: 11px; line-height: 1.2; color: #b42318; }",
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

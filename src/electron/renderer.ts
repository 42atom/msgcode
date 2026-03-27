import {
  buildReadonlyThreadSurfaceChrome,
  renderReadonlyThreadSurfaceMarkup,
} from "../ui/main-window/readonly-thread-surface.js";
import type { ReadonlySurfaceBridge, ReadonlySurfaceRunCommandRequest } from "./readonly-surface-bridge.js";

export interface HtmlDocumentLike {
  open(): void;
  write(content: string): void;
  close(): void;
  querySelector(selector: string): ElementLike | null;
  querySelectorAll?(selector: string): ArrayLike<ElementLike>;
}

export interface ElementLike {
  textContent: string | null;
  innerHTML: string;
  getAttribute?(name: string): string | null;
}

declare const document: HtmlDocumentLike;

declare global {
  interface Window {
    msgcodeReadonlySurface?: ReadonlySurfaceBridge;
  }
}

interface WorkspaceTreeItem {
  name: string;
  path: string;
  threads: Array<{ threadId: string; title: string }>;
}

interface WorkspaceTreeEnvelope {
  data?: {
    workspaces?: WorkspaceTreeItem[];
  };
}

interface ThreadEnvelope {
  data?: {
    threadId?: string;
    thread?: {
      title?: string;
      writable?: boolean;
      messages?: Array<{ user?: string; assistant?: string }>;
    } | null;
    workStatus?: {
      recentEntries?: unknown[];
    };
    schedules?: unknown[];
  };
}

interface ReadonlyThreadSurfaceViewData {
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  selectedThreadId: string;
  workspaceTree: WorkspaceTreeEnvelope;
  thread: ThreadEnvelope | null;
  loadingError: string | null;
}

export function bootstrapReadonlyThreadSurface(documentLike: HtmlDocumentLike): void {
  const chrome = buildReadonlyThreadSurfaceChrome({
    selectedWorkspace: "",
    selectedThreadId: "",
    loadingError: null,
  });
  const markup = renderReadonlyThreadSurfaceMarkup(chrome);
  documentLike.open();
  documentLike.write(markup);
  documentLike.close();
}

export async function loadReadonlyThreadSurface(
  bridge: ReadonlySurfaceBridge,
): Promise<{
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  selectedThreadId: string;
  workspaceTree: WorkspaceTreeEnvelope;
  thread: ThreadEnvelope | null;
}> {
  const workspaceTree = (await bridge.runCommand({
    command: "workspace-tree",
  } satisfies ReadonlySurfaceRunCommandRequest)) as WorkspaceTreeEnvelope;

  const workspaces = workspaceTree.data?.workspaces ?? [];
  const selectedWorkspaceItem = workspaces.find((item) => item.threads.length > 0) ?? workspaces[0] ?? null;
  const selectedThreadId = selectedWorkspaceItem?.threads[0]?.threadId ?? "";

  if (!selectedWorkspaceItem || !selectedThreadId) {
    return {
      selectedWorkspace: selectedWorkspaceItem?.name ?? "",
      selectedWorkspacePath: selectedWorkspaceItem?.path ?? "",
      selectedThreadId,
      workspaceTree,
      thread: null,
    };
  }

  const thread = (await bridge.runCommand({
    command: "thread",
    workspace: selectedWorkspaceItem.name,
    threadId: selectedThreadId,
  } satisfies ReadonlySurfaceRunCommandRequest)) as ThreadEnvelope;

  return {
    selectedWorkspace: selectedWorkspaceItem.name,
    selectedWorkspacePath: selectedWorkspaceItem.path,
    selectedThreadId,
    workspaceTree,
    thread,
  };
}

export function applyReadonlyThreadSurfaceData(
  documentLike: HtmlDocumentLike,
  data: ReadonlyThreadSurfaceViewData,
): void {
  const workspacePanel = documentLike.querySelector('[data-surface-slot="workspace-tree"]');
  if (workspacePanel) {
    const workspaces = data.workspaceTree.data?.workspaces ?? [];
    workspacePanel.innerHTML = renderWorkspacePanel({
      selectedWorkspace: data.selectedWorkspace,
      selectedThreadId: data.selectedThreadId,
      workspaces,
    });
  }

  const threadPanel = documentLike.querySelector('[data-surface-slot="thread"]');
  if (threadPanel) {
    threadPanel.innerHTML = renderThreadPanel(data);
  }

  const railPanel = documentLike.querySelector('[data-surface-slot="thread-rail"]');
  if (railPanel) {
    const scheduleCount = data.thread?.data?.schedules?.length ?? 0;
    const recentStatusCount = data.thread?.data?.workStatus?.recentEntries?.length ?? 0;
    railPanel.innerHTML = renderRailPanel({
      selectedWorkspace: data.selectedWorkspace,
      selectedWorkspacePath: data.selectedWorkspacePath,
      loadingError: data.loadingError,
      scheduleCount,
      recentStatusCount,
      writable: data.thread?.data?.thread?.writable === true,
    });
  }
}

function renderWorkspacePanel(params: {
  selectedWorkspace: string;
  selectedThreadId: string;
  workspaces: WorkspaceTreeItem[];
}): string {
  return [
    '<header class="surface-panel__header">',
    '<p class="surface-panel__eyebrow">Workspaces</p>',
    "<h2>Workspace Tree</h2>",
    "</header>",
    '<div class="surface-panel__body workspace-list">',
    ...(params.workspaces.length === 0
      ? ['<p class="empty-state">No workspace yet.</p>']
      : params.workspaces.map((workspace) =>
          renderWorkspaceGroup(
            workspace,
            workspace.name === params.selectedWorkspace,
            params.selectedThreadId,
          ),
        )),
    "</div>",
  ].join("");
}

function renderWorkspaceGroup(
  workspace: WorkspaceTreeItem,
  selected: boolean,
  selectedThreadId: string,
): string {
  return [
    `<section class="workspace-group${selected ? " is-selected" : ""}">`,
    `<button type="button" class="workspace-row${selected ? " is-selected" : ""}" data-workspace-select="true" data-workspace-name="${escapeHtml(workspace.name)}" data-workspace-path="${escapeHtml(workspace.path)}">`,
    `<span class="workspace-row__title">${escapeHtml(workspace.name)}</span>`,
    `<span class="workspace-row__meta">${workspace.threads.length} thread${workspace.threads.length === 1 ? "" : "s"}</span>`,
    "</button>",
    ...(workspace.threads.length > 0
      ? [
          '<div class="thread-list">',
          ...workspace.threads.map((thread) => {
            const classes = ["thread-row"];
            if (selected && thread.threadId === selectedThreadId) {
              classes.push("is-selected");
            }
            return [
              `<button type="button" class="${classes.join(" ")}" data-thread-select="true" data-workspace-name="${escapeHtml(workspace.name)}" data-workspace-path="${escapeHtml(workspace.path)}" data-thread-id="${escapeHtml(thread.threadId)}">`,
              `<span class="thread-row__title">${escapeHtml(thread.title)}</span>`,
              "</button>",
            ].join("");
          }),
          "</div>",
        ]
      : []),
    "</section>",
  ].join("");
}

function renderThreadPanel(data: {
  selectedWorkspace: string;
  selectedThreadId: string;
  thread: ThreadEnvelope | null;
  loadingError: string | null;
}): string {
  const title = data.thread?.data?.thread?.title ?? "No thread selected";
  const writable = data.thread?.data?.thread?.writable === true;
  const messages = [...(data.thread?.data?.thread?.messages ?? [])].reverse();

  return [
    '<header class="surface-panel__header">',
    '<p class="surface-panel__eyebrow">Current Thread</p>',
    `<h2>${escapeHtml(title)}</h2>`,
    '<div class="thread-head-meta">',
    `<span class="inline-chip">${escapeHtml(data.selectedWorkspace || "-")}</span>`,
    `<span class="inline-chip${writable ? "" : " inline-chip--muted"}">${writable ? "writable" : "readonly"}</span>`,
    `<span class="inline-chip inline-chip--muted">${escapeHtml(data.selectedThreadId || "-")}</span>`,
    "</div>",
    "</header>",
    '<div class="surface-panel__body thread-stage">',
    '<div class="message-list-host">',
    '<div class="message-list-stack">',
    ...(messages.length === 0
      ? ['<div class="message-row message-row--empty"><p class="empty-state">No messages yet.</p></div>']
      : messages.flatMap((message) => {
          const rows: string[] = [];
          if ((message.user || "").trim()) {
            rows.push(
              '<div class="message-row message-row--user">' +
                `<article class="bubble bubble--user">${escapeHtml(message.user || "")}</article>` +
              "</div>",
            );
          }
          if ((message.assistant || "").trim()) {
            rows.push(
              '<div class="message-row message-row--agent">' +
                `<article class="bubble bubble--agent">${escapeHtml(message.assistant || "")}</article>` +
              "</div>",
            );
          }
          return rows;
        })),
    ...(data.loadingError
      ? [`<div class="message-row message-row--error"><p class="thread-error">Loading error: ${escapeHtml(data.loadingError)}</p></div>`]
      : []),
    "</div>",
    "</div>",
    ...(writable
      ? [
          '<div class="thread-composer" data-thread-composer="true">',
          '  <input type="text" class="thread-composer__input" data-thread-composer-input="true" placeholder="Ask msgcode" />',
          '  <button type="button" class="thread-composer__send" data-thread-composer-send="true">Send</button>',
          '  <p class="thread-composer__error" data-thread-composer-error="true"></p>',
          "</div>",
        ]
      : []),
    "</div>",
  ].join("");
}

function renderRailPanel(params: {
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  loadingError: string | null;
  scheduleCount: number;
  recentStatusCount: number;
  writable: boolean;
}): string {
  return [
    '<header class="surface-panel__header">',
    '<p class="surface-panel__eyebrow">Observer</p>',
    "<h2>Thread Rail</h2>",
    "</header>",
    '<div class="surface-panel__body observer-stack">',
    '<section class="observer-section">',
    '<div class="observer-section__header"><h3>This Thread</h3></div>',
    '<div class="observer-rows">',
    renderObserverRow("状态", params.writable ? "可写" : "只读"),
    renderObserverRow("最近事件", `${params.recentStatusCount}`),
    ...(params.loadingError ? [renderObserverRow("异常", params.loadingError)] : []),
    "</div>",
    "</section>",
    '<section class="observer-section">',
    '<div class="observer-section__header"><h3>Shared</h3></div>',
    '<div class="observer-rows">',
    renderObserverRow("工作区", params.selectedWorkspace || "-"),
    renderObserverRow("路径", params.selectedWorkspacePath || "-"),
    renderObserverRow("定时任务", `${params.scheduleCount}`),
    "</div>",
    "</section>",
    "</div>",
  ].join("");
}

function renderObserverRow(label: string, value: string): string {
  return [
    '<div class="observer-row">',
    `<span class="observer-row__label">${escapeHtml(label)}</span>`,
    `<span class="observer-row__value">${escapeHtml(value)}</span>`,
    "</div>",
  ].join("");
}

async function loadThreadEnvelope(
  bridge: ReadonlySurfaceBridge,
  workspace: string,
  threadId: string,
): Promise<ThreadEnvelope> {
  return (await bridge.runCommand({
    command: "thread",
    workspace,
    threadId,
  } satisfies ReadonlySurfaceRunCommandRequest)) as ThreadEnvelope;
}

function renderReadonlyThreadSurface(
  documentLike: HtmlDocumentLike,
  bridge: ReadonlySurfaceBridge,
  data: ReadonlyThreadSurfaceViewData,
): void {
  applyReadonlyThreadSurfaceData(documentLike, data);
  bindReadonlyThreadSurfaceSelection(documentLike, bridge, data);
  bindReadonlyThreadComposer(documentLike, bridge, data);
}

export function bindReadonlyThreadSurfaceSelection(
  documentLike: HtmlDocumentLike,
  bridge: ReadonlySurfaceBridge,
  data: ReadonlyThreadSurfaceViewData,
): void {
  const workspaceButtons = Array.from(documentLike.querySelectorAll?.('[data-workspace-select="true"]') ?? []);
  const threadButtons = Array.from(documentLike.querySelectorAll?.('[data-thread-select="true"]') ?? []);

  for (const button of workspaceButtons) {
    const target = button as EventfulElementLike;
    if (!target.addEventListener) continue;
    target.addEventListener("click", (event) => {
      event.preventDefault?.();
      const workspaceName = target.getAttribute?.("data-workspace-name") ?? "";
      const workspacePath = target.getAttribute?.("data-workspace-path") ?? "";
      void handleWorkspaceSelection(documentLike, bridge, data, workspaceName, workspacePath);
    });
  }

  for (const button of threadButtons) {
    const target = button as EventfulElementLike;
    if (!target.addEventListener) continue;
    target.addEventListener("click", (event) => {
      event.preventDefault?.();
      const workspaceName = target.getAttribute?.("data-workspace-name") ?? "";
      const workspacePath = target.getAttribute?.("data-workspace-path") ?? "";
      const threadId = target.getAttribute?.("data-thread-id") ?? "";
      void handleThreadSelection(documentLike, bridge, data, workspaceName, workspacePath, threadId);
    });
  }
}

async function handleWorkspaceSelection(
  documentLike: HtmlDocumentLike,
  bridge: ReadonlySurfaceBridge,
  data: ReadonlyThreadSurfaceViewData,
  workspaceName: string,
  workspacePath: string,
): Promise<void> {
  const workspace = (data.workspaceTree.data?.workspaces ?? []).find(
    (item) => item.name === workspaceName && item.path === workspacePath,
  );
  const nextThreadId = workspace?.threads[0]?.threadId ?? "";
  const nextData: ReadonlyThreadSurfaceViewData = {
    ...data,
    selectedWorkspace: workspaceName,
    selectedWorkspacePath: workspacePath,
    selectedThreadId: nextThreadId,
    loadingError: null,
    thread: null,
  };
  try {
    nextData.thread = nextThreadId ? await loadThreadEnvelope(bridge, workspaceName, nextThreadId) : null;
  } catch (error) {
    nextData.loadingError = error instanceof Error ? error.message : String(error);
  }
  renderReadonlyThreadSurface(documentLike, bridge, nextData);
}

async function handleThreadSelection(
  documentLike: HtmlDocumentLike,
  bridge: ReadonlySurfaceBridge,
  data: ReadonlyThreadSurfaceViewData,
  workspaceName: string,
  workspacePath: string,
  threadId: string,
): Promise<void> {
  const nextData: ReadonlyThreadSurfaceViewData = {
    ...data,
    selectedWorkspace: workspaceName,
    selectedWorkspacePath: workspacePath,
    selectedThreadId: threadId,
    loadingError: null,
    thread: null,
  };
  try {
    nextData.thread = threadId ? await loadThreadEnvelope(bridge, workspaceName, threadId) : null;
  } catch (error) {
    nextData.loadingError = error instanceof Error ? error.message : String(error);
  }
  renderReadonlyThreadSurface(documentLike, bridge, nextData);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function startReadonlyThreadSurface(
  documentLike: HtmlDocumentLike,
  bridge: ReadonlySurfaceBridge,
): Promise<void> {
  bootstrapReadonlyThreadSurface(documentLike);
  try {
    const data = await loadReadonlyThreadSurface(bridge);
    renderReadonlyThreadSurface(documentLike, bridge, {
      ...data,
      loadingError: null,
    });
  } catch (error) {
    renderReadonlyThreadSurface(documentLike, bridge, {
      selectedWorkspace: "",
      selectedWorkspacePath: "",
      selectedThreadId: "",
      workspaceTree: {},
      thread: null,
      loadingError: error instanceof Error ? error.message : String(error),
    });
  }
}

interface EventfulElementLike extends ElementLike {
  value?: string;
  disabled?: boolean;
  addEventListener?: (type: string, listener: (event: { key?: string; shiftKey?: boolean; preventDefault?: () => void }) => void) => void;
}

export function bindReadonlyThreadComposer(
  documentLike: HtmlDocumentLike,
  bridge: ReadonlySurfaceBridge,
  data: ReadonlyThreadSurfaceViewData,
): void {
  if (data.thread?.data?.thread?.writable !== true) {
    return;
  }

  const input = documentLike.querySelector('[data-thread-composer-input="true"]') as EventfulElementLike | null;
  const button = documentLike.querySelector('[data-thread-composer-send="true"]') as EventfulElementLike | null;
  const error = documentLike.querySelector('[data-thread-composer-error="true"]');
  if (!input?.addEventListener || !button?.addEventListener) {
    return;
  }

  let sending = false;
  const submit = async (): Promise<void> => {
    if (sending) return;
    const text = String(input.value ?? "").trim();
    if (!text) return;
    sending = true;
    input.disabled = true;
    button.disabled = true;
    if (error) {
      error.textContent = "";
    }
    try {
      await bridge.sendThreadInput({
        workspacePath: data.selectedWorkspacePath,
        threadId: data.selectedThreadId,
        text,
      });
      input.value = "";
      const refreshedThread = await loadThreadEnvelope(bridge, data.selectedWorkspace, data.selectedThreadId);
      const nextData = {
        ...data,
        thread: refreshedThread,
        loadingError: null,
      };
      renderReadonlyThreadSurface(documentLike, bridge, nextData);
    } catch (submitError) {
      if (error) {
        error.textContent = submitError instanceof Error ? submitError.message : String(submitError);
      }
    } finally {
      sending = false;
      input.disabled = false;
      button.disabled = false;
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault?.();
    void submit();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault?.();
    void submit();
  });
}

if (typeof globalThis === "object" && "document" in globalThis) {
  const browserGlobal = globalThis as typeof globalThis & {
    document?: HtmlDocumentLike;
    window?: Window;
  };
  const bridge = browserGlobal.window?.msgcodeReadonlySurface;
  if (bridge) {
    void startReadonlyThreadSurface(document, bridge);
  } else {
    bootstrapReadonlyThreadSurface(document);
  }
}

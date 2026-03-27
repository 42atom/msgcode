import {
  buildThreadSurfaceChrome,
  escapeHtml,
  renderThreadSurfaceMarkup,
} from "../ui/main-window/thread-surface.js";
import type {
  ThreadSurfaceBridge,
  ThreadSurfaceRunCommandRequest,
  ThreadUpdateEvent,
} from "./thread-surface-bridge.js";

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
    msgcodeThreadSurface?: ThreadSurfaceBridge;
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
      lastTurnAt?: string;
      messages?: Array<{ user?: string; assistant?: string }>;
    } | null;
    workStatus?: {
      recentEntries?: unknown[];
    };
    schedules?: unknown[];
  };
}

interface ProfileEnvelope {
  data?: {
    workspacePath?: string;
    profile?: {
      sourcePath?: string;
      name?: string;
    };
    memory?: {
      enabled?: boolean;
      topK?: number;
      maxChars?: number;
    };
    soul?: {
      path?: string;
      exists?: boolean;
      content?: string;
    };
  };
}

interface CapabilitiesEnvelope {
  data?: {
    capabilities?: Array<{
      id?: string;
      title?: string;
      configured?: boolean;
      source?: string;
      model?: string;
      note?: string;
    }>;
  };
}

interface ThreadSurfaceViewData {
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  selectedThreadId: string;
  workspaceTree: WorkspaceTreeEnvelope;
  thread: ThreadEnvelope | null;
  profile: ProfileEnvelope | null;
  capabilities: CapabilitiesEnvelope | null;
  loadingError: string | null;
}

const pendingComposerThreads = new Set<string>();
const pendingComposerErrors = new Map<string, string>();
let activeSurfaceThreadKey = "";
let activeSurfaceData: ThreadSurfaceViewData | null = null;
let disposeThreadUpdateSubscription: (() => void) | null = null;

function buildSurfaceThreadKey(workspacePath: string, threadId: string): string {
  return `${workspacePath.trim()}::${threadId.trim()}`;
}

function clearComposerPendingState(threadKey: string, preserveError = false): void {
  pendingComposerThreads.delete(threadKey);
  if (!preserveError) {
    pendingComposerErrors.delete(threadKey);
  }
}

function buildEmptySurfaceViewData(loadingError: string | null): ThreadSurfaceViewData {
  return {
    selectedWorkspace: "",
    selectedWorkspacePath: "",
    selectedThreadId: "",
    workspaceTree: {},
    thread: null,
    profile: null,
    capabilities: null,
    loadingError,
  };
}

export function bootstrapThreadSurface(documentLike: HtmlDocumentLike): void {
  const chrome = buildThreadSurfaceChrome({
    selectedWorkspace: "",
    selectedThreadId: "",
    loadingError: null,
  });
  const markup = renderThreadSurfaceMarkup(chrome);
  documentLike.open();
  documentLike.write(markup);
  documentLike.close();
}

export async function loadThreadSurface(
  bridge: ThreadSurfaceBridge,
): Promise<{
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  selectedThreadId: string;
  workspaceTree: WorkspaceTreeEnvelope;
  thread: ThreadEnvelope | null;
  profile: ProfileEnvelope | null;
  capabilities: CapabilitiesEnvelope | null;
}> {
  const workspaceTree = (await bridge.runCommand({
    command: "workspace-tree",
  } satisfies ThreadSurfaceRunCommandRequest)) as WorkspaceTreeEnvelope;

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
      profile: null,
      capabilities: null,
    };
  }

  const [thread, shared] = await Promise.all([
    bridge.runCommand({
      command: "thread",
      workspace: selectedWorkspaceItem.name,
      threadId: selectedThreadId,
    } satisfies ThreadSurfaceRunCommandRequest) as Promise<ThreadEnvelope>,
    loadWorkspaceSharedSurfaces(bridge, selectedWorkspaceItem.path),
  ]);

  return {
    selectedWorkspace: selectedWorkspaceItem.name,
    selectedWorkspacePath: selectedWorkspaceItem.path,
    selectedThreadId,
    workspaceTree,
    thread: thread as ThreadEnvelope,
    profile: shared.profile,
    capabilities: shared.capabilities,
  };
}

export function applyThreadSurfaceData(
  documentLike: HtmlDocumentLike,
  data: ThreadSurfaceViewData,
): void {
  const leftPanel = documentLike.querySelector('[data-surface-slot="workspace-tree"]');
  if (leftPanel) {
    const workspaces = data.workspaceTree.data?.workspaces ?? [];
    leftPanel.innerHTML = renderLeftPanel({
      selectedWorkspace: data.selectedWorkspace,
      selectedThreadId: data.selectedThreadId,
      workspaces,
    });
  }

  const middlePanel = documentLike.querySelector('[data-surface-slot="thread"]');
  if (middlePanel) {
    middlePanel.innerHTML = renderMiddlePanel(data);
  }

  const rightPanel = documentLike.querySelector('[data-surface-slot="thread-rail"]');
  if (rightPanel) {
    const threadKey = buildSurfaceThreadKey(data.selectedWorkspacePath, data.selectedThreadId);
    const scheduleCount = data.thread?.data?.schedules?.length ?? 0;
    const recentStatusCount = data.thread?.data?.workStatus?.recentEntries?.length ?? 0;
    rightPanel.innerHTML = renderRightPanel({
      selectedWorkspace: data.selectedWorkspace,
      selectedWorkspacePath: data.selectedWorkspacePath,
      selectedThreadId: data.selectedThreadId,
      loadingError: data.loadingError,
      scheduleCount,
      recentStatusCount,
      writable: data.thread?.data?.thread?.writable === true,
      waiting: pendingComposerThreads.has(threadKey),
      lastTurnAt: data.thread?.data?.thread?.lastTurnAt ?? "",
      profile: data.profile,
      capabilities: data.capabilities,
    });
  }
}

function renderLeftPanel(params: {
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

function renderMiddlePanel(data: {
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  selectedThreadId: string;
  thread: ThreadEnvelope | null;
  loadingError: string | null;
}): string {
  const title = data.thread?.data?.thread?.title ?? "No thread selected";
  const writable = data.thread?.data?.thread?.writable === true;
  const threadKey = buildSurfaceThreadKey(data.selectedWorkspacePath, data.selectedThreadId);
  const waiting = pendingComposerThreads.has(threadKey);
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
          `  <input type="text" class="thread-composer__input" data-thread-composer-input="true" placeholder="${waiting ? "Waiting for reply..." : "Ask msgcode"}" />`,
          `  <button type="button" class="thread-composer__send" data-thread-composer-send="true">${waiting ? "Waiting" : "Send"}</button>`,
          `  <p class="thread-composer__error" data-thread-composer-error="true">${escapeHtml(pendingComposerErrors.get(threadKey) ?? (waiting ? "处理中..." : ""))}</p>`,
          "</div>",
        ]
      : []),
    "</div>",
  ].join("");
}

function renderRightPanel(params: {
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  selectedThreadId: string;
  loadingError: string | null;
  scheduleCount: number;
  recentStatusCount: number;
  writable: boolean;
  waiting: boolean;
  lastTurnAt: string;
  profile: ProfileEnvelope | null;
  capabilities: CapabilitiesEnvelope | null;
}): string {
  const brainCapability = (params.capabilities?.data?.capabilities ?? []).find((entry) => entry.id === "brain");
  const memoryEnabled = params.profile?.data?.memory?.enabled === true;
  const memoryTopK = params.profile?.data?.memory?.topK ?? 0;
  const soulPath = params.profile?.data?.soul?.path ?? "";
  const soulLabel = soulPath.trim() ? basenamePath(soulPath) : "未配置";
  const brainLabel = normalizeBrainLabel(brainCapability);
  const threadStatus = params.waiting ? "等待回复" : params.writable ? "可写" : "只读";

  return [
    '<header class="surface-panel__header">',
    '<p class="surface-panel__eyebrow">Observer</p>',
    "<h2>Thread Rail</h2>",
    "</header>",
    '<div class="surface-panel__body observer-stack">',
    '<section class="observer-section">',
    '<div class="observer-section__header"><h3>This Thread</h3></div>',
    '<div class="observer-rows">',
    renderObserverRow("状态", threadStatus),
    renderObserverRow("线程", params.selectedThreadId || "-"),
    renderObserverRow("最近回合", params.lastTurnAt || "-"),
    renderObserverRow("最近事件", `${params.recentStatusCount}`),
    ...(params.loadingError ? [renderObserverRow("异常", params.loadingError)] : []),
    "</div>",
    "</section>",
    '<section class="observer-section">',
    '<div class="observer-section__header"><h3>Shared</h3></div>',
    '<div class="observer-rows">',
    renderObserverRow("工作区", params.selectedWorkspace || "-"),
    renderObserverRow("路径", params.selectedWorkspacePath || "-"),
    renderObserverRow("大脑模型", brainLabel),
    renderObserverRow("Soul", soulLabel),
    renderObserverRow("记忆", memoryEnabled ? `已启用 · Top ${memoryTopK}` : "未启用"),
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

function loadSelectedThreadData(
  bridge: ThreadSurfaceBridge,
  workspaceName: string,
  threadId: string,
): Promise<ThreadEnvelope | null> {
  return threadId ? loadThreadEnvelope(bridge, workspaceName, threadId) : Promise.resolve(null);
}

async function loadWorkspaceSelectionState(params: {
  bridge: ThreadSurfaceBridge;
  current: ThreadSurfaceViewData;
  workspaceName: string;
  workspacePath: string;
  threadId: string;
  includeShared: boolean;
}): Promise<ThreadSurfaceViewData> {
  const nextData: ThreadSurfaceViewData = {
    ...params.current,
    selectedWorkspace: params.workspaceName,
    selectedWorkspacePath: params.workspacePath,
    selectedThreadId: params.threadId,
    loadingError: null,
    thread: null,
    profile: params.includeShared ? null : params.current.profile,
    capabilities: params.includeShared ? null : params.current.capabilities,
  };

  try {
    const [thread, shared] = await Promise.all([
      loadSelectedThreadData(params.bridge, params.workspaceName, params.threadId),
      params.includeShared
        ? loadWorkspaceSharedSurfaces(params.bridge, params.workspacePath)
        : Promise.resolve(null),
    ]);
    nextData.thread = thread;
    if (shared) {
      nextData.profile = shared.profile;
      nextData.capabilities = shared.capabilities;
    }
  } catch (error) {
    nextData.loadingError = error instanceof Error ? error.message : String(error);
  }

  return nextData;
}

async function loadThreadEnvelope(
  bridge: ThreadSurfaceBridge,
  workspace: string,
  threadId: string,
): Promise<ThreadEnvelope> {
  return (await bridge.runCommand({
    command: "thread",
    workspace,
    threadId,
  } satisfies ThreadSurfaceRunCommandRequest)) as ThreadEnvelope;
}

async function loadWorkspaceSharedSurfaces(
  bridge: ThreadSurfaceBridge,
  workspace: string,
): Promise<{ profile: ProfileEnvelope; capabilities: CapabilitiesEnvelope }> {
  const [profile, capabilities] = await Promise.all([
    bridge.runCommand({
      command: "profile",
      workspace,
    } satisfies ThreadSurfaceRunCommandRequest) as Promise<ProfileEnvelope>,
    bridge.runCommand({
      command: "capabilities",
      workspace,
    } satisfies ThreadSurfaceRunCommandRequest) as Promise<CapabilitiesEnvelope>,
  ]);

  return { profile, capabilities };
}

function normalizeBrainLabel(
  entry:
    | {
        configured?: boolean;
        model?: string;
        note?: string;
      }
    | undefined,
): string {
  if (!entry) {
    return "未配置";
  }
  const model = String(entry.model ?? "").trim();
  const note = String(entry.note ?? "").trim();
  if (model) {
    return note ? `${model} · ${note}` : model;
  }
  return note || "未配置";
}

function basenamePath(value: string): string {
  const normalized = String(value ?? "").trim().replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function renderThreadSurface(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
  data: ThreadSurfaceViewData,
): void {
  activeSurfaceThreadKey = buildSurfaceThreadKey(data.selectedWorkspacePath, data.selectedThreadId);
  activeSurfaceData = data;
  applyThreadSurfaceData(documentLike, data);
  bindThreadSurfaceSelection(documentLike, bridge, data);
  bindThreadComposer(documentLike, bridge, data);
}

async function handleThreadUpdateEvent(params: {
  documentLike: HtmlDocumentLike;
  bridge: ThreadSurfaceBridge;
  event: ThreadUpdateEvent;
}): Promise<void> {
  const current = activeSurfaceData;
  if (!current) {
    return;
  }
  const eventThreadKey = buildSurfaceThreadKey(params.event.workspacePath, params.event.threadId);
  if (eventThreadKey !== activeSurfaceThreadKey) {
    return;
  }
  try {
    const refreshedThread = await loadThreadEnvelope(
      params.bridge,
      current.selectedWorkspace,
      current.selectedThreadId,
    );
    clearComposerPendingState(eventThreadKey);
    renderThreadSurface(params.documentLike, params.bridge, {
      ...current,
      thread: refreshedThread,
      loadingError: null,
    });
  } catch (error) {
    pendingComposerErrors.set(
      eventThreadKey,
      error instanceof Error ? error.message : String(error),
    );
    clearComposerPendingState(eventThreadKey, true);
    renderThreadSurface(params.documentLike, params.bridge, {
      ...current,
      loadingError: error instanceof Error ? error.message : String(error),
    });
  }
}

export function bindThreadSurfaceSelection(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
  data: ThreadSurfaceViewData,
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
      return handleWorkspaceSelection(documentLike, bridge, data, workspaceName, workspacePath);
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
      return handleThreadSelection(documentLike, bridge, data, workspaceName, workspacePath, threadId);
    });
  }
}

async function handleWorkspaceSelection(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
  data: ThreadSurfaceViewData,
  workspaceName: string,
  workspacePath: string,
): Promise<void> {
  const workspace = (data.workspaceTree.data?.workspaces ?? []).find(
    (item) => item.name === workspaceName && item.path === workspacePath,
  );
  const nextThreadId = workspace?.threads[0]?.threadId ?? "";
  const nextData = await loadWorkspaceSelectionState({
    bridge,
    current: data,
    workspaceName,
    workspacePath,
    threadId: nextThreadId,
    includeShared: true,
  });
  renderThreadSurface(documentLike, bridge, nextData);
}

async function handleThreadSelection(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
  data: ThreadSurfaceViewData,
  workspaceName: string,
  workspacePath: string,
  threadId: string,
): Promise<void> {
  const nextData = await loadWorkspaceSelectionState({
    bridge,
    current: data,
    workspaceName,
    workspacePath,
    threadId,
    includeShared: false,
  });
  renderThreadSurface(documentLike, bridge, nextData);
}

export async function startThreadSurface(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
): Promise<void> {
  bootstrapThreadSurface(documentLike);
  disposeThreadUpdateSubscription?.();
  disposeThreadUpdateSubscription = bridge.onThreadUpdate((event) => {
    void handleThreadUpdateEvent({ documentLike, bridge, event });
  });
  try {
    const data = await loadThreadSurface(bridge);
    renderThreadSurface(documentLike, bridge, {
      ...data,
      loadingError: null,
    });
  } catch (error) {
    renderThreadSurface(
      documentLike,
      bridge,
      buildEmptySurfaceViewData(error instanceof Error ? error.message : String(error)),
    );
  }
}

interface EventfulElementLike extends ElementLike {
  value?: string;
  disabled?: boolean;
  addEventListener?: (type: string, listener: (event: { key?: string; shiftKey?: boolean; preventDefault?: () => void }) => void) => void;
}

export function bindThreadComposer(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
  data: ThreadSurfaceViewData,
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

  const threadKey = buildSurfaceThreadKey(data.selectedWorkspacePath, data.selectedThreadId);
  let sending = false;
  if (pendingComposerThreads.has(threadKey)) {
    input.disabled = true;
    button.disabled = true;
  }

  const submit = async (): Promise<void> => {
    if (sending || pendingComposerThreads.has(threadKey)) return;
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
      const latestMessage = refreshedThread.data?.thread?.messages?.[0] ?? null;
      const waitingForAssistant = !!latestMessage && !(latestMessage.assistant ?? "").trim();
      pendingComposerThreads.add(threadKey);
      pendingComposerErrors.delete(threadKey);
      const nextData = {
        ...data,
        thread: refreshedThread,
        loadingError: null,
      };
      if (!waitingForAssistant) {
        clearComposerPendingState(threadKey);
        renderThreadSurface(documentLike, bridge, nextData);
      } else {
        renderThreadSurface(documentLike, bridge, nextData);
      }
    } catch (submitError) {
      clearComposerPendingState(threadKey);
      if (error) {
        error.textContent = submitError instanceof Error ? submitError.message : String(submitError);
      }
    } finally {
      sending = false;
      if (!pendingComposerThreads.has(threadKey)) {
        input.disabled = false;
        button.disabled = false;
      }
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
  const bridge = browserGlobal.window?.msgcodeThreadSurface;
  if (bridge) {
    void startThreadSurface(document, bridge);
  } else {
    bootstrapThreadSurface(document);
  }
}

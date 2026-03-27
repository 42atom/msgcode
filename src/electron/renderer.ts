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

interface HallEnvelope {
  data?: {
    workspacePath?: string;
    org?: {
      path?: string;
      exists?: boolean;
      name?: string;
      taxRegion?: string;
      uscc?: string;
    };
    runtime?: {
      appVersion?: string;
      configPath?: string;
      logPath?: string;
      summary?: {
        status?: string;
        warnings?: number;
        errors?: number;
      };
      categories?: Array<{
        key?: string;
        name?: string;
        status?: string;
        message?: string;
      }>;
    };
    packs?: {
      builtin?: Array<{
        id?: string;
        name?: string;
        version?: string;
        enabled?: boolean;
      }>;
      user?: Array<{
        id?: string;
        name?: string;
        version?: string;
        enabled?: boolean;
      }>;
    };
    sites?: Array<{
      id?: string;
      title?: string;
      entry?: string;
      kind?: string;
      description?: string;
      sourcePath?: string;
    }>;
  };
}

interface NeighborEnvelope {
  data?: {
    workspacePath?: string;
    enabled?: boolean;
    configPath?: string;
    neighborsPath?: string;
    mailboxPath?: string;
    self?: {
      nodeId?: string;
      publicIdentity?: string;
    };
    summary?: {
      unreadCount?: number;
      lastMessageAt?: string;
      lastProbeAt?: string;
      reachableCount?: number;
    };
    neighbors?: Array<{
      nodeId?: string;
      displayName?: string;
      state?: string;
      unreadCount?: number;
      latencyMs?: number | null;
      lastProbeOk?: boolean | null;
    }>;
    mailbox?: {
      updatedAt?: string;
      entries?: Array<{
        at?: string;
        nodeId?: string;
        direction?: string;
        type?: string;
        summary?: string;
        unread?: boolean;
      }>;
    };
  };
}

type ThreadSurfaceSection = "workspace" | "base" | "neighbor";

interface ThreadSurfaceViewData {
  selectedSection: ThreadSurfaceSection;
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  selectedThreadId: string;
  workspaceTree: WorkspaceTreeEnvelope;
  thread: ThreadEnvelope | null;
  profile: ProfileEnvelope | null;
  capabilities: CapabilitiesEnvelope | null;
  hall: HallEnvelope | null;
  neighbor: NeighborEnvelope | null;
  loadingError: string | null;
}

const pendingComposerThreads = new Set<string>();
const pendingComposerErrors = new Map<string, string>();
const collapsedObserverSections = new Set<string>();
let activeSurfaceThreadKey = "";
let activeSurfaceData: ThreadSurfaceViewData | null = null;
let disposeThreadUpdateSubscription: (() => void) | null = null;

function buildSurfaceThreadKey(workspacePath: string, threadId: string): string {
  return `${workspacePath.trim()}::${threadId.trim()}`;
}

function buildObserverSectionKey(
  selectedSection: ThreadSurfaceSection,
  scope: "thread" | "shared",
  workspacePath: string,
  threadId: string,
): string {
  return `${selectedSection}:${scope}:${workspacePath.trim()}::${threadId.trim()}`;
}

function clearComposerPendingState(threadKey: string, preserveError = false): void {
  pendingComposerThreads.delete(threadKey);
  if (!preserveError) {
    pendingComposerErrors.delete(threadKey);
  }
}

function buildEmptySurfaceViewData(loadingError: string | null): ThreadSurfaceViewData {
  return {
    selectedSection: "workspace",
    selectedWorkspace: "",
    selectedWorkspacePath: "",
    selectedThreadId: "",
    workspaceTree: {},
    thread: null,
    profile: null,
    capabilities: null,
    hall: null,
    neighbor: null,
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
  selectedSection: ThreadSurfaceSection;
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  selectedThreadId: string;
  workspaceTree: WorkspaceTreeEnvelope;
  thread: ThreadEnvelope | null;
  profile: ProfileEnvelope | null;
  capabilities: CapabilitiesEnvelope | null;
  hall: HallEnvelope | null;
  neighbor: NeighborEnvelope | null;
}> {
  const workspaceTree = (await bridge.runCommand({
    command: "workspace-tree",
  } satisfies ThreadSurfaceRunCommandRequest)) as WorkspaceTreeEnvelope;

  const workspaces = workspaceTree.data?.workspaces ?? [];
  const selectedWorkspaceItem = workspaces.find((item) => item.threads.length > 0) ?? workspaces[0] ?? null;
  const selectedThreadId = selectedWorkspaceItem?.threads[0]?.threadId ?? "";

  if (!selectedWorkspaceItem) {
    return {
      selectedSection: "workspace",
      selectedWorkspace: "",
      selectedWorkspacePath: "",
      selectedThreadId,
      workspaceTree,
      thread: null,
      profile: null,
      capabilities: null,
      hall: null,
      neighbor: null,
    };
  }

  if (!selectedThreadId) {
    const shared = await loadWorkspaceSharedSurfaces(bridge, selectedWorkspaceItem.path);
    return {
      selectedSection: "workspace",
      selectedWorkspace: selectedWorkspaceItem.name,
      selectedWorkspacePath: selectedWorkspaceItem.path,
      selectedThreadId,
      workspaceTree,
      thread: null,
      profile: shared.profile,
      capabilities: shared.capabilities,
      hall: shared.hall,
      neighbor: shared.neighbor,
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
    selectedSection: "workspace",
    selectedWorkspace: selectedWorkspaceItem.name,
    selectedWorkspacePath: selectedWorkspaceItem.path,
    selectedThreadId,
    workspaceTree,
    thread: thread as ThreadEnvelope,
    profile: shared.profile,
    capabilities: shared.capabilities,
    hall: shared.hall,
    neighbor: shared.neighbor,
  };
}

export function applyThreadSurfaceData(
  documentLike: HtmlDocumentLike,
  data: ThreadSurfaceViewData,
): void {
  const leftPanel = documentLike.querySelector('[data-surface-slot="workspace-tree"]');
  if (leftPanel) {
    leftPanel.innerHTML = renderLeftPanel(data);
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
      selectedSection: data.selectedSection,
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
      hall: data.hall,
      neighbor: data.neighbor,
    });
  }
}

function renderLeftPanel(data: ThreadSurfaceViewData): string {
  return [
    '<div class="sidebar-shell">',
    renderSidebarTopNav(data.selectedSection),
    '<section class="sidebar-list-shell">',
    '<header class="surface-panel__header sidebar-list-shell__header">',
    `<p class="surface-panel__eyebrow">${escapeHtml(renderSidebarEyebrow(data.selectedSection))}</p>`,
    `<h2>${escapeHtml(renderSidebarTitle(data.selectedSection))}</h2>`,
    "</header>",
    '<div class="surface-panel__body workspace-list sidebar-list-shell__body">',
    ...renderSidebarSectionContent(data),
    "</div>",
    "</section>",
    renderSidebarFooter(),
    "</div>",
  ].join("");
}

function renderSidebarTopNav(selectedSection: ThreadSurfaceSection): string {
  return [
    '<nav class="sidebar-top-nav" aria-label="workspace sections">',
    renderSidebarTopNavItem("workspace", "工作区", selectedSection),
    renderSidebarTopNavItem("base", "基座", selectedSection),
    renderSidebarTopNavItem("neighbor", "邻居", selectedSection),
    "</nav>",
  ].join("");
}

function renderSidebarTopNavItem(
  section: ThreadSurfaceSection,
  label: string,
  selectedSection: ThreadSurfaceSection,
): string {
  return `<button type="button" class="sidebar-top-nav__item${section === selectedSection ? " is-selected" : ""}" data-surface-nav-select="true" data-surface-nav="${section}">${escapeHtml(label)}</button>`;
}

function renderSidebarFooter(): string {
  return [
    '<footer class="sidebar-footer">',
    '<button type="button" class="sidebar-footer__settings">Settings</button>',
    '<span class="sidebar-footer__spacer"></span>',
    '<button type="button" class="sidebar-footer__update">Update</button>',
    "</footer>",
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

function renderSidebarEyebrow(selectedSection: ThreadSurfaceSection): string {
  if (selectedSection === "base") return "Capability Packs";
  if (selectedSection === "neighbor") return "Neighbors";
  return "Workspaces";
}

function renderSidebarTitle(selectedSection: ThreadSurfaceSection): string {
  if (selectedSection === "base") return "Base";
  if (selectedSection === "neighbor") return "Neighbor Nodes";
  return "Workspace Tree";
}

function renderSidebarSectionContent(data: ThreadSurfaceViewData): string[] {
  if (data.selectedSection === "base") {
    return renderBaseSidebarContent(data.hall);
  }
  if (data.selectedSection === "neighbor") {
    return renderNeighborSidebarContent(data.neighbor);
  }
  const workspaces = data.workspaceTree.data?.workspaces ?? [];
  if (workspaces.length === 0) {
    return ['<p class="empty-state">No workspace yet.</p>'];
  }
  return workspaces.map((workspace) =>
    renderWorkspaceGroup(
      workspace,
      workspace.name === data.selectedWorkspace,
      data.selectedThreadId,
    ),
  );
}

function renderBaseSidebarContent(hall: HallEnvelope | null): string[] {
  const builtin = hall?.data?.packs?.builtin ?? [];
  const user = hall?.data?.packs?.user ?? [];
  const sites = hall?.data?.sites ?? [];
  return [
    renderStaticSidebarGroup(
      "Builtin Packs",
      builtin.map((entry) => renderStaticSidebarRow(entry.name || entry.id || "-", entry.version || "")),
    ),
    renderStaticSidebarGroup(
      "User Packs",
      user.map((entry) => renderStaticSidebarRow(entry.name || entry.id || "-", entry.version || "")),
    ),
    renderStaticSidebarGroup(
      "Sites",
      sites.map((entry) => renderStaticSidebarRow(entry.title || entry.id || "-", entry.kind || "")),
    ),
  ];
}

function renderNeighborSidebarContent(neighbor: NeighborEnvelope | null): string[] {
  const entries = neighbor?.data?.neighbors ?? [];
  if (entries.length === 0) {
    return ['<p class="empty-state">No neighbor yet.</p>'];
  }
  return [
    renderStaticSidebarGroup(
      "Neighbor List",
      entries.map((entry) =>
        renderStaticSidebarRow(
          entry.displayName || entry.nodeId || "-",
          entry.unreadCount ? `${entry.unreadCount}` : entry.state || "",
        ),
      ),
    ),
  ];
}

function renderStaticSidebarGroup(label: string, rows: string[]): string {
  return [
    '<section class="workspace-group workspace-group--static">',
    `<p class="workspace-row__meta workspace-group__label">${escapeHtml(label)}</p>`,
    ...(rows.length > 0 ? rows : ['<p class="empty-state">Empty.</p>']),
    "</section>",
  ].join("");
}

function renderStaticSidebarRow(title: string, meta: string): string {
  return [
    '<div class="thread-row thread-row--static">',
    `<span class="thread-row__title">${escapeHtml(title)}</span>`,
    ...(meta.trim() ? [`<span class="workspace-row__meta">${escapeHtml(meta)}</span>`] : []),
    "</div>",
  ].join("");
}

function renderMiddlePanel(data: {
  selectedSection: ThreadSurfaceSection;
  selectedWorkspace: string;
  selectedWorkspacePath: string;
  selectedThreadId: string;
  thread: ThreadEnvelope | null;
  hall: HallEnvelope | null;
  neighbor: NeighborEnvelope | null;
  loadingError: string | null;
}): string {
  if (data.selectedSection === "base") {
    return renderBaseMiddlePanel(data.hall, data.loadingError);
  }
  if (data.selectedSection === "neighbor") {
    return renderNeighborMiddlePanel(data.neighbor, data.loadingError);
  }
  return renderWorkspaceMiddlePanel(data);
}

function renderWorkspaceMiddlePanel(data: {
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
    '<div class="thread-shell">',
    '<header class="surface-panel__header thread-shell__header">',
    '<p class="surface-panel__eyebrow">Current Thread</p>',
    `<h2>${escapeHtml(title)}</h2>`,
    '<div class="thread-head-meta">',
    `<span class="inline-chip">${escapeHtml(data.selectedWorkspace || "-")}</span>`,
    `<span class="inline-chip${writable ? "" : " inline-chip--muted"}">${writable ? "writable" : "readonly"}</span>`,
    `<span class="inline-chip inline-chip--muted">${escapeHtml(data.selectedThreadId || "-")}</span>`,
    "</div>",
    "</header>",
    '<div class="surface-panel__body thread-shell__body">',
    '<section class="chat-stage">',
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
          '<div class="composer-dock" data-thread-composer="true">',
          `  <input type="text" class="thread-composer__input" data-thread-composer-input="true" placeholder="${waiting ? "Waiting for reply..." : "Ask msgcode"}" />`,
          `  <button type="button" class="thread-composer__send" data-thread-composer-send="true">${waiting ? "Waiting" : "Send"}</button>`,
          `  <p class="thread-composer__error" data-thread-composer-error="true">${escapeHtml(pendingComposerErrors.get(threadKey) ?? (waiting ? "处理中..." : ""))}</p>`,
          "</div>",
        ]
      : []),
    "</section>",
    "</div>",
    "</div>",
  ].join("");
}

function renderBaseMiddlePanel(hall: HallEnvelope | null, loadingError: string | null): string {
  const org = hall?.data?.org;
  const runtime = hall?.data?.runtime;
  const sites = hall?.data?.sites ?? [];
  const builtinCount = hall?.data?.packs?.builtin?.length ?? 0;
  const userCount = hall?.data?.packs?.user?.length ?? 0;

  return [
    '<div class="thread-shell">',
    '<header class="surface-panel__header thread-shell__header">',
    '<p class="surface-panel__eyebrow">Base</p>',
    '<h2>基座总览</h2>',
    '<div class="thread-head-meta">',
    `<span class="inline-chip">${escapeHtml(org?.name || "未配置组织")}</span>`,
    `<span class="inline-chip inline-chip--muted">${escapeHtml(runtime?.summary?.status || "unknown")}</span>`,
    "</div>",
    "</header>",
    '<div class="surface-panel__body thread-shell__body">',
    '<section class="summary-stack">',
    renderSummaryCard("组织", [
      renderSummaryRow("名称", org?.name || "-"),
      renderSummaryRow("城市", org?.taxRegion || "-"),
      renderSummaryRow("统一社会信用代码", org?.uscc || "-"),
    ]),
    renderSummaryCard("运行时", [
      renderSummaryRow("版本", runtime?.appVersion || "-"),
      renderSummaryRow("状态", runtime?.summary?.status || "-"),
      renderSummaryRow("告警", `${runtime?.summary?.warnings ?? 0}`),
      renderSummaryRow("错误", `${runtime?.summary?.errors ?? 0}`),
    ]),
    renderSummaryCard("能力包", [
      renderSummaryRow("Builtin", `${builtinCount}`),
      renderSummaryRow("User", `${userCount}`),
      renderSummaryRow("Sites", `${sites.length}`),
    ]),
    ...(loadingError ? [renderSummaryCard("异常", [renderSummaryRow("错误", loadingError)])] : []),
    "</section>",
    "</div>",
    "</div>",
  ].join("");
}

function renderNeighborMiddlePanel(neighbor: NeighborEnvelope | null, loadingError: string | null): string {
  const entries = neighbor?.data?.mailbox?.entries ?? [];
  return [
    '<div class="thread-shell">',
    '<header class="surface-panel__header thread-shell__header">',
    '<p class="surface-panel__eyebrow">Neighbor</p>',
    '<h2>邻居邮箱</h2>',
    '<div class="thread-head-meta">',
    `<span class="inline-chip">${neighbor?.data?.enabled ? "enabled" : "disabled"}</span>`,
    `<span class="inline-chip inline-chip--muted">${escapeHtml(neighbor?.data?.self?.nodeId || "-")}</span>`,
    "</div>",
    "</header>",
    '<div class="surface-panel__body thread-shell__body">',
    '<section class="mailbox-list">',
    ...(entries.length === 0
      ? ['<p class="empty-state">No mailbox entries yet.</p>']
      : entries.map((entry) => renderMailboxEntry(entry))),
    ...(loadingError ? [`<p class="thread-error">${escapeHtml(loadingError)}</p>`] : []),
    "</section>",
    "</div>",
    "</div>",
  ].join("");
}

function renderMailboxEntry(entry: {
  at?: string;
  nodeId?: string;
  direction?: string;
  type?: string;
  summary?: string;
  unread?: boolean;
}): string {
  const classes = ["mailbox-entry"];
  if ((entry.direction || "").trim() === "out") {
    classes.push("mailbox-entry--out");
  }
  if ((entry.direction || "").trim() === "system") {
    classes.push("mailbox-entry--system");
  }
  if (entry.unread) {
    classes.push("mailbox-entry--unread");
  }
  return [
    `<article class="${classes.join(" ")}">`,
    '<div class="mailbox-entry__meta">',
    `<span>${escapeHtml(entry.nodeId || "-")}</span>`,
    `<span>${escapeHtml(entry.at || "-")}</span>`,
    "</div>",
    `<p class="mailbox-entry__summary">${escapeHtml(entry.summary || entry.type || "-")}</p>`,
    "</article>",
  ].join("");
}

function renderRightPanel(params: {
  selectedSection: ThreadSurfaceSection;
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
  hall: HallEnvelope | null;
  neighbor: NeighborEnvelope | null;
}): string {
  if (params.selectedSection === "base") {
    return renderBaseRightPanel(params);
  }
  if (params.selectedSection === "neighbor") {
    return renderNeighborRightPanel(params);
  }
  return renderWorkspaceRightPanel(params);
}

function renderWorkspaceRightPanel(params: {
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
  const threadSectionKey = buildObserverSectionKey(
    "workspace",
    "thread",
    params.selectedWorkspacePath,
    params.selectedThreadId,
  );
  const sharedSectionKey = buildObserverSectionKey(
    "workspace",
    "shared",
    params.selectedWorkspacePath,
    params.selectedThreadId,
  );

  return [
    '<div class="observer-shell">',
    '<header class="surface-panel__header observer-header">',
    '<p class="surface-panel__eyebrow">Observer</p>',
    "<h2>Thread Rail</h2>",
    "</header>",
    '<div class="surface-panel__body observer-body observer-stack">',
    renderObserverSection("This Thread", "thread", threadSectionKey, [
      renderObserverRow("状态", threadStatus, "status"),
      renderObserverRow("线程", params.selectedThreadId || "-", "text"),
      renderObserverRow("最近回合", params.lastTurnAt || "-", "text"),
      renderObserverRow("最近事件", `${params.recentStatusCount}`, "text"),
      ...(params.loadingError ? [renderObserverRow("异常", params.loadingError, "status")] : []),
    ]),
    renderObserverSection("Shared", "shared", sharedSectionKey, [
      renderObserverRow("工作区", params.selectedWorkspace || "-", "text"),
      renderObserverRow("路径", params.selectedWorkspacePath || "-", "path", params.selectedWorkspacePath),
      renderObserverRow("大脑模型", brainLabel, "text"),
      renderObserverRow("Soul", soulLabel, soulPath.trim() ? "path" : "text", soulPath),
      renderObserverToggleRow(
        "记忆",
        memoryEnabled,
        memoryEnabled ? `已启用 · Top ${memoryTopK}` : "未启用",
        params.selectedWorkspacePath,
      ),
      renderObserverRow("定时任务", `${params.scheduleCount}`, "text"),
    ]),
    "</div>",
    "</div>",
  ].join("");
}

function renderBaseRightPanel(params: {
  selectedWorkspacePath: string;
  profile: ProfileEnvelope | null;
  capabilities: CapabilitiesEnvelope | null;
  hall: HallEnvelope | null;
}): string {
  const runtime = params.hall?.data?.runtime;
  const brainCapability = (params.capabilities?.data?.capabilities ?? []).find((entry) => entry.id === "brain");
  const soulPath = params.profile?.data?.soul?.path ?? "";
  const sharedSectionKey = buildObserverSectionKey(
    "base",
    "shared",
    params.selectedWorkspacePath,
    "",
  );

  return [
    '<div class="observer-shell">',
    '<header class="surface-panel__header observer-header">',
    '<p class="surface-panel__eyebrow">Observer</p>',
    "<h2>Base Rail</h2>",
    "</header>",
    '<div class="surface-panel__body observer-body observer-stack">',
    renderObserverSection("Shared", "shared", sharedSectionKey, [
      renderObserverRow("路径", params.selectedWorkspacePath || "-", "path", params.selectedWorkspacePath),
      renderObserverRow("大脑模型", normalizeBrainLabel(brainCapability), "text"),
      renderObserverRow("Soul", soulPath.trim() ? basenamePath(soulPath) : "未配置", soulPath.trim() ? "path" : "text", soulPath),
      renderObserverRow("Runtime", runtime?.summary?.status || "-", "status"),
      renderObserverRow("日志", runtime?.logPath || "-", runtime?.logPath ? "path" : "text", runtime?.logPath || ""),
    ]),
    "</div>",
    "</div>",
  ].join("");
}

function renderNeighborRightPanel(params: {
  selectedWorkspacePath: string;
  selectedThreadId: string;
  neighbor: NeighborEnvelope | null;
}): string {
  const summary = params.neighbor?.data?.summary;
  const self = params.neighbor?.data?.self;
  const threadSectionKey = buildObserverSectionKey(
    "neighbor",
    "thread",
    params.selectedWorkspacePath,
    params.selectedThreadId,
  );
  const sharedSectionKey = buildObserverSectionKey(
    "neighbor",
    "shared",
    params.selectedWorkspacePath,
    params.selectedThreadId,
  );
  return [
    '<div class="observer-shell">',
    '<header class="surface-panel__header observer-header">',
    '<p class="surface-panel__eyebrow">Observer</p>',
    "<h2>Neighbor Rail</h2>",
    "</header>",
    '<div class="surface-panel__body observer-body observer-stack">',
    renderObserverSection("This Thread", "thread", threadSectionKey, [
      renderObserverRow("邻居功能", params.neighbor?.data?.enabled ? "启用中" : "未启用", "status"),
      renderObserverRow("自身节点", self?.nodeId || "-", "text"),
      renderObserverRow("公开身份", self?.publicIdentity || "-", "text"),
    ]),
    renderObserverSection("Shared", "shared", sharedSectionKey, [
      renderObserverRow("路径", params.selectedWorkspacePath || "-", "path", params.selectedWorkspacePath),
      renderObserverRow("未读", `${summary?.unreadCount ?? 0}`, "text"),
      renderObserverRow("最近消息", summary?.lastMessageAt || "-", "text"),
      renderObserverRow("最近探测", summary?.lastProbeAt || "-", "text"),
      renderObserverRow("可达邻居", `${summary?.reachableCount ?? 0}`, "text"),
    ]),
    "</div>",
    "</div>",
  ].join("");
}

function renderObserverSection(
  title: string,
  scope: "thread" | "shared",
  sectionKey: string,
  rows: string[],
): string {
  const collapsed = collapsedObserverSections.has(sectionKey);
  return [
    `<section class="observer-section${collapsed ? " is-collapsed" : ""}">`,
    `<button type="button" class="observer-section__header" data-observer-toggle="true" data-observer-scope="${scope}" aria-expanded="${collapsed ? "false" : "true"}">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<span class="observer-section__chevron${collapsed ? " is-collapsed" : ""}" aria-hidden="true">⌄</span>`,
    "</button>",
    collapsed ? "" : `<div class="observer-rows">${rows.join("")}</div>`,
    "</section>",
  ].join("");
}

function renderSummaryCard(title: string, rows: string[]): string {
  return [
    '<section class="summary-card">',
    `<h3 class="summary-card__title">${escapeHtml(title)}</h3>`,
    '<div class="summary-card__rows">',
    ...rows,
    "</div>",
    "</section>",
  ].join("");
}

function renderSummaryRow(label: string, value: string): string {
  return [
    '<div class="summary-row">',
    `<span class="summary-row__label">${escapeHtml(label)}</span>`,
    `<span class="summary-row__value">${escapeHtml(value)}</span>`,
    "</div>",
  ].join("");
}

function renderObserverRow(
  label: string,
  value: string,
  kind: "text" | "path" | "status",
  finderPath = "",
): string {
  const valueClasses = ["observer-row__value"];
  if (kind === "path") {
    valueClasses.push("observer-row__value--path");
  }
  if (kind === "status") {
    valueClasses.push("observer-row__value--status");
  }
  const valueMarkup =
    kind === "path" && finderPath.trim()
      ? `<button type="button" class="${valueClasses.join(" ")} observer-row__value-button" data-finder-path="${escapeHtml(finderPath)}">${escapeHtml(value)}</button>`
      : `<span class="${valueClasses.join(" ")}">${escapeHtml(value)}</span>`;
  return [
    '<div class="observer-row">',
    `<span class="observer-row__label">${escapeHtml(label)}</span>`,
    valueMarkup,
    "</div>",
  ].join("");
}

function renderObserverToggleRow(
  label: string,
  enabled: boolean,
  value: string,
  workspacePath = "",
): string {
  const isInteractive = workspacePath.trim().length > 0;
  const valueMarkup = isInteractive
    ? [
        `<button type="button" class="observer-row__value observer-row__value--toggle observer-row__toggle-button" data-memory-toggle="true" data-workspace-path="${escapeHtml(workspacePath)}" data-memory-enabled="${enabled ? "true" : "false"}">`,
        `<span class="switch-indicator${enabled ? " is-on" : ""}" aria-hidden="true"></span>`,
        `<span>${escapeHtml(value)}</span>`,
        "</button>",
      ].join("")
    : [
        '<span class="observer-row__value observer-row__value--toggle">',
        `<span class="switch-indicator${enabled ? " is-on" : ""}" aria-hidden="true"></span>`,
        `<span>${escapeHtml(value)}</span>`,
        "</span>",
      ].join("");
  return [
    '<div class="observer-row observer-row--toggle">',
    `<span class="observer-row__label">${escapeHtml(label)}</span>`,
    valueMarkup,
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
    hall: params.includeShared ? null : params.current.hall,
    neighbor: params.includeShared ? null : params.current.neighbor,
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
      nextData.hall = shared.hall;
      nextData.neighbor = shared.neighbor;
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
): Promise<{
  profile: ProfileEnvelope;
  capabilities: CapabilitiesEnvelope;
  hall: HallEnvelope;
  neighbor: NeighborEnvelope;
}> {
  const [profile, capabilities, hall, neighbor] = await Promise.all([
    bridge.runCommand({
      command: "profile",
      workspace,
    } satisfies ThreadSurfaceRunCommandRequest) as Promise<ProfileEnvelope>,
    bridge.runCommand({
      command: "capabilities",
      workspace,
    } satisfies ThreadSurfaceRunCommandRequest) as Promise<CapabilitiesEnvelope>,
    bridge.runCommand({
      command: "hall",
      workspace,
    } satisfies ThreadSurfaceRunCommandRequest) as Promise<HallEnvelope>,
    bridge.runCommand({
      command: "neighbor",
      workspace,
    } satisfies ThreadSurfaceRunCommandRequest) as Promise<NeighborEnvelope>,
  ]);

  return { profile, capabilities, hall, neighbor };
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
  bindThreadSurfaceFinderActions(documentLike, bridge);
  bindThreadSurfaceMemoryToggles(documentLike, bridge, data);
  bindThreadSurfaceObserverToggles(documentLike, bridge, data);
  bindThreadSurfaceNav(documentLike, bridge, data);
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

function bindThreadSurfaceFinderActions(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
): void {
  const finderButtons = Array.from(documentLike.querySelectorAll?.('[data-finder-path]') ?? []);
  for (const button of finderButtons) {
    const target = button as EventfulElementLike;
    if (!target.addEventListener) continue;
    target.addEventListener("click", (event) => {
      event.preventDefault?.();
      const nextPath = target.getAttribute?.("data-finder-path") ?? "";
      if (!nextPath.trim()) {
        return;
      }
      void bridge.showPathInFinder({ path: nextPath });
    });
  }
}

export function bindThreadSurfaceMemoryToggles(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
  data: ThreadSurfaceViewData,
): void {
  const toggleButtons = Array.from(documentLike.querySelectorAll?.('[data-memory-toggle="true"]') ?? []);
  for (const button of toggleButtons) {
    const target = button as EventfulElementLike;
    if (!target.addEventListener) continue;
    target.addEventListener("click", (event) => {
      event.preventDefault?.();
      const workspacePath = String(target.getAttribute?.("data-workspace-path") ?? "").trim();
      const enabled = String(target.getAttribute?.("data-memory-enabled") ?? "").trim() === "true";
      if (!workspacePath) {
        return;
      }
      target.disabled = true;
      return (async () => {
        try {
          await bridge.setWorkspaceMemoryEnabled({
            workspacePath,
            enabled: !enabled,
          });
          const shared = await loadWorkspaceSharedSurfaces(bridge, workspacePath);
          renderThreadSurface(documentLike, bridge, {
            ...data,
            profile: shared.profile,
            capabilities: shared.capabilities,
            hall: shared.hall,
            neighbor: shared.neighbor,
            loadingError: null,
          });
        } catch (error) {
          renderThreadSurface(documentLike, bridge, {
            ...data,
            loadingError: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });
  }
}

export function bindThreadSurfaceObserverToggles(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
  data: ThreadSurfaceViewData,
): void {
  const toggleButtons = Array.from(documentLike.querySelectorAll?.('[data-observer-toggle="true"]') ?? []);
  for (const button of toggleButtons) {
    const target = button as EventfulElementLike;
    if (!target.addEventListener) continue;
    target.addEventListener("click", (event) => {
      event.preventDefault?.();
      const scope = String(target.getAttribute?.("data-observer-scope") ?? "").trim();
      if (scope !== "thread" && scope !== "shared") {
        return;
      }
      const sectionKey = buildObserverSectionKey(
        data.selectedSection,
        scope,
        data.selectedWorkspacePath,
        data.selectedThreadId,
      );
      if (collapsedObserverSections.has(sectionKey)) {
        collapsedObserverSections.delete(sectionKey);
      } else {
        collapsedObserverSections.add(sectionKey);
      }
      renderThreadSurface(documentLike, bridge, data);
    });
  }
}

export function bindThreadSurfaceNav(
  documentLike: HtmlDocumentLike,
  bridge: ThreadSurfaceBridge,
  data: ThreadSurfaceViewData,
): void {
  const navButtons = Array.from(documentLike.querySelectorAll?.('[data-surface-nav-select="true"]') ?? []);
  for (const button of navButtons) {
    const target = button as EventfulElementLike;
    if (!target.addEventListener) continue;
    target.addEventListener("click", (event) => {
      event.preventDefault?.();
      const nextSection = String(target.getAttribute?.("data-surface-nav") ?? "").trim() as ThreadSurfaceSection;
      if (!nextSection || nextSection === data.selectedSection) {
        return;
      }
      renderThreadSurface(documentLike, bridge, {
        ...data,
        selectedSection: nextSection,
      });
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

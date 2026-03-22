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
}

export interface ElementLike {
  textContent: string | null;
  innerHTML: string;
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
      messages?: Array<{ user?: string; assistant?: string }>;
    } | null;
    workStatus?: {
      recentEntries?: unknown[];
    };
    schedules?: unknown[];
  };
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
    selectedThreadId,
    workspaceTree,
    thread,
  };
}

export function applyReadonlyThreadSurfaceData(
  documentLike: HtmlDocumentLike,
  data: {
    selectedWorkspace: string;
    selectedThreadId: string;
    workspaceTree: WorkspaceTreeEnvelope;
    thread: ThreadEnvelope | null;
    loadingError: string | null;
  },
): void {
  const workspacePanel = documentLike.querySelector('[data-surface-slot="workspace-tree"]');
  if (workspacePanel) {
    const workspaces = data.workspaceTree.data?.workspaces ?? [];
    workspacePanel.innerHTML = [
      "<h2>Workspace Tree</h2>",
      ...workspaces.map(
        (item) =>
          `<p>${escapeHtml(item.name)}${item.threads.length > 0 ? ` (${item.threads.length})` : ""}</p>`,
      ),
    ].join("");
  }

  const threadPanel = documentLike.querySelector('[data-surface-slot="thread"]');
  if (threadPanel) {
    const title = data.thread?.data?.thread?.title ?? "No thread selected";
    const messages = data.thread?.data?.thread?.messages ?? [];
    const latest = messages[0];
    threadPanel.innerHTML = [
      "<h2>Thread</h2>",
      `<p>selectedWorkspace: ${escapeHtml(data.selectedWorkspace || "-")}</p>`,
      `<p>selectedThreadId: ${escapeHtml(data.selectedThreadId || "-")}</p>`,
      `<p>title: ${escapeHtml(title)}</p>`,
      `<p>latestUser: ${escapeHtml(latest?.user ?? "-")}</p>`,
      `<p>latestAssistant: ${escapeHtml(latest?.assistant ?? "-")}</p>`,
      `<p>loadingError: ${escapeHtml(data.loadingError ?? "No loading error")}</p>`,
    ].join("");
  }

  const railPanel = documentLike.querySelector('[data-surface-slot="thread-rail"]');
  if (railPanel) {
    const scheduleCount = data.thread?.data?.schedules?.length ?? 0;
    const recentStatusCount = data.thread?.data?.workStatus?.recentEntries?.length ?? 0;
    railPanel.innerHTML = [
      "<h2>Thread Rail</h2>",
      `<p>schedules: ${scheduleCount}</p>`,
      `<p>recentStatus: ${recentStatusCount}</p>`,
      '<p><a href="#settings">Settings</a></p>',
    ].join("");
  }
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
    applyReadonlyThreadSurfaceData(documentLike, {
      ...data,
      loadingError: null,
    });
  } catch (error) {
    applyReadonlyThreadSurfaceData(documentLike, {
      selectedWorkspace: "",
      selectedThreadId: "",
      workspaceTree: {},
      thread: null,
      loadingError: error instanceof Error ? error.message : String(error),
    });
  }
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

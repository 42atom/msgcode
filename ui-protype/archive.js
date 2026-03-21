const archiveStatus = document.getElementById("archive-status");
const archiveFootnote = document.getElementById("archive-footnote");
const archivedWorkspacesNode = document.getElementById("archived-workspaces");
const archivedThreadsNode = document.getElementById("archived-threads");
const archivedThreadsTitle = document.getElementById("archived-threads-title");
const archiveCommandPreview = document.getElementById("archive-command-preview");

const archiveSurfaceData = {
  workspacePath: "/Users/admin/msgcode-workspaces/family",
  workspaceArchiveRoot: "/Users/admin/msgcode-workspaces/.archive",
  archivedThreadsPath: "/Users/admin/msgcode-workspaces/family/.msgcode/archived-threads",
  archivedWorkspaces: [
    {
      name: "smoke",
      path: "/Users/admin/msgcode-workspaces/.archive/smoke",
      updatedAt: "2026-03-20T09:46:00.000Z",
    },
    {
      name: "smoke-agent-cli",
      path: "/Users/admin/msgcode-workspaces/.archive/smoke-agent-cli",
      updatedAt: "2026-03-18T13:21:00.000Z",
    },
    {
      name: "test-r9-smoke",
      path: "/Users/admin/msgcode-workspaces/.archive/test-r9-smoke",
      updatedAt: "2026-03-17T08:15:00.000Z",
    },
  ],
  archivedThreads: [
    {
      threadId: "copy-edit",
      chatId: "feishu:oc_family",
      title: "145了该接小孩了",
      source: "feishu",
      archivedPath: "/Users/admin/msgcode-workspaces/family/.msgcode/archived-threads/copy-edit.md",
      lastTurnAt: "2026-03-19T03:45:00.000Z",
    },
    {
      threadId: "missed-reminder",
      chatId: "feishu:oc_family",
      title: "今天为什么没有提醒我",
      source: "feishu",
      archivedPath: "/Users/admin/msgcode-workspaces/family/.msgcode/archived-threads/missed-reminder.md",
      lastTurnAt: "2026-03-18T11:25:00.000Z",
    },
  ],
};

const state = {
  archivedWorkspaces: [...archiveSurfaceData.archivedWorkspaces],
  archivedThreads: [...archiveSurfaceData.archivedThreads],
};

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function basename(filePath) {
  return String(filePath).split("/").filter(Boolean).pop() || filePath;
}

function workspaceNameFromPath(workspacePath) {
  return String(workspacePath).split("/").filter(Boolean).pop() || workspacePath;
}

function setArchiveStatus(text) {
  archiveStatus.textContent = text;
}

function setArchiveCommand(command) {
  if (!archiveCommandPreview) return;
  archiveCommandPreview.textContent = command;
}

function renderEmpty(text) {
  return `
    <article class="archive-item archive-item--empty">
      <div class="archive-item__head">
        <div>
          <h4>${text}</h4>
        </div>
      </div>
    </article>
  `;
}

function renderArchivedWorkspaces() {
  if (state.archivedWorkspaces.length === 0) {
    archivedWorkspacesNode.innerHTML = renderEmpty("暂无已归档工作区");
    return;
  }

  archivedWorkspacesNode.innerHTML = state.archivedWorkspaces
    .map(
      (workspace) => `
        <article class="archive-item">
          <div class="archive-item__head">
            <div>
              <h4>${workspace.name}</h4>
              <p class="archive-item__path">${workspace.path}</p>
            </div>
            <span class="inline-chip inline-chip--muted">workspace</span>
          </div>
          <div class="archive-item__meta">
            <span>最近修改：${formatDate(workspace.updatedAt)}</span>
          </div>
          <div class="archive-item__actions">
            <button class="ghost-mini" data-workspace-view="${workspace.name}">查看</button>
            <button class="action-button action-button--ghost" data-workspace-restore="${workspace.name}">恢复到活跃列表</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderArchivedThreads() {
  const workspaceName = workspaceNameFromPath(archiveSurfaceData.workspacePath);
  archivedThreadsTitle.textContent = `${workspaceName} 已归档线程`;

  if (state.archivedThreads.length === 0) {
    archivedThreadsNode.innerHTML = renderEmpty("暂无已归档线程");
    return;
  }

  archivedThreadsNode.innerHTML = state.archivedThreads
    .map(
      (thread) => `
        <article class="archive-item">
          <div class="archive-item__head">
            <div>
              <h4>${thread.title}</h4>
              <p class="archive-item__path">${thread.archivedPath}</p>
            </div>
            <span class="inline-chip inline-chip--muted">thread</span>
          </div>
          <div class="archive-item__meta">
            <span>来源：${thread.source}</span>
            <span>chatId：${thread.chatId}</span>
            <span>最近一轮：${formatDate(thread.lastTurnAt)}</span>
          </div>
          <div class="archive-item__actions">
            <button class="ghost-mini" data-thread-view="${thread.threadId}">查看</button>
            <button class="action-button action-button--ghost" data-thread-restore="${thread.threadId}">恢复到活跃线程列表</button>
          </div>
        </article>
      `
    )
    .join("");
}

function updateFootnote() {
  archiveFootnote.textContent = `当前工作区：${workspaceNameFromPath(archiveSurfaceData.workspacePath)}。主界面只显示活跃工作区和活跃线程。`;
}

function renderArchiveSurface() {
  renderArchivedWorkspaces();
  renderArchivedThreads();
  updateFootnote();
}

function restoreWorkspaceCommand(name) {
  return `msgcode appliance restore-workspace --workspace ${name} --json`;
}

function restoreThreadCommand(threadId) {
  return `msgcode appliance restore-thread --workspace ${workspaceNameFromPath(archiveSurfaceData.workspacePath)} --thread-id ${threadId} --json`;
}

function viewWorkspaceCommand(name) {
  return `msgcode appliance archive --workspace ${name} --json`;
}

function viewThreadCommand(threadId) {
  return `msgcode appliance thread --workspace ${workspaceNameFromPath(archiveSurfaceData.workspacePath)} --thread-id ${threadId} --json`;
}

async function simulateMutation(command, applyMutation) {
  setArchiveCommand(command);
  setArchiveStatus("调用中...");
  await new Promise((resolve) => window.setTimeout(resolve, 700));
  applyMutation();
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target) return;

  const workspaceView = target.closest("[data-workspace-view]");
  if (workspaceView instanceof HTMLElement) {
    const name = workspaceView.dataset.workspaceView || "";
    setArchiveCommand(viewWorkspaceCommand(name));
    setArchiveStatus(`查看工作区：${name}`);
    return;
  }

  const workspaceRestore = target.closest("[data-workspace-restore]");
  if (workspaceRestore instanceof HTMLElement) {
    const name = workspaceRestore.dataset.workspaceRestore || "";
    void simulateMutation(restoreWorkspaceCommand(name), () => {
      state.archivedWorkspaces = state.archivedWorkspaces.filter((workspace) => workspace.name !== name);
      renderArchiveSurface();
      setArchiveStatus(`已恢复工作区：${name}`);
    });
    return;
  }

  const threadView = target.closest("[data-thread-view]");
  if (threadView instanceof HTMLElement) {
    const threadId = threadView.dataset.threadView || "";
    setArchiveCommand(viewThreadCommand(threadId));
    setArchiveStatus(`查看线程：${threadId}`);
    return;
  }

  const threadRestore = target.closest("[data-thread-restore]");
  if (threadRestore instanceof HTMLElement) {
    const threadId = threadRestore.dataset.threadRestore || "";
    void simulateMutation(restoreThreadCommand(threadId), () => {
      const restored = state.archivedThreads.find((thread) => thread.threadId === threadId);
      state.archivedThreads = state.archivedThreads.filter((thread) => thread.threadId !== threadId);
      renderArchiveSurface();
      setArchiveStatus(`已恢复线程：${restored ? restored.title : threadId}`);
    });
  }
});

renderArchiveSurface();
setArchiveCommand(`msgcode appliance archive --workspace ${workspaceNameFromPath(archiveSurfaceData.workspacePath)} --json`);

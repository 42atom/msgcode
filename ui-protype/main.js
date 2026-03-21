const workspaceTree = document.getElementById("workspace-tree");
const surfaceStatus = document.getElementById("surface-status");
const threadTitle = document.getElementById("thread-title");
const threadWorkspaceChip = document.getElementById("thread-workspace-chip");
const threadChannelChip = document.getElementById("thread-channel-chip");
const threadKindChip = document.getElementById("thread-kind-chip");
const chatLog = document.getElementById("chat-log");
const observerTitle = document.getElementById("observer-title");
const loadingError = document.getElementById("loading-error");
const workStatusLine1 = document.getElementById("work-status-line-1");
const workStatusLine2 = document.getElementById("work-status-line-2");
const observerSecondaryTitle = document.getElementById("observer-secondary-title");
const observerSecondaryContent = document.getElementById("observer-secondary-content");

const state = {
  selectedWorkspace: "",
  selectedThreadId: "",
  loadingError: "",
};

function getSurfaceBridge() {
  const bridge = window.msgcodeReadonlySurface;
  if (!bridge || typeof bridge.runCommand !== "function") {
    throw new Error("缺少只读线程面桥接：window.msgcodeReadonlySurface.runCommand");
  }
  return bridge;
}

async function runSurfaceCommand(command, args) {
  const bridge = getSurfaceBridge();
  const envelope = await bridge.runCommand(command, args);
  if (!envelope || typeof envelope !== "object") {
    throw new Error(`无效 surface 响应：${command}`);
  }
  return envelope;
}

function setStatus(text, kind = "idle") {
  if (!surfaceStatus) return;
  surfaceStatus.textContent = text;
  surfaceStatus.classList.toggle("status-pill--ok", kind === "ok");
}

function setLoadingError(text) {
  state.loadingError = text;
  if (loadingError) {
    loadingError.textContent = text || "读取正常";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatCronHint(cron) {
  if (!cron) return "--";
  const parts = String(cron).split(" ");
  if (parts.length < 2) return cron;
  return `${String(parts[1]).padStart(2, "0")}:${String(parts[0]).padStart(2, "0")}`;
}

function renderEmptyState(title, body) {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">○</div>
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function renderStatusList(entries) {
  if (entries.length === 0) {
    return `
      <article class="schedule-item">
        <div>
          <p>暂无共享近况</p>
        </div>
      </article>
    `;
  }

  return entries.map((entry) => `
    <article class="schedule-item">
      <strong>${escapeHtml(formatTime(entry.timestamp))}</strong>
      <div>
        <p>${escapeHtml(entry.kind || "status")}</p>
        <small>${escapeHtml(entry.summary || "")}</small>
      </div>
    </article>
  `).join("");
}

function renderScheduleList(items) {
  if (items.length === 0) {
    return `
      <article class="schedule-item">
        <div>
          <p>暂无定时任务</p>
        </div>
      </article>
    `;
  }

  return items.map((item) => `
    <article class="schedule-item">
      <strong>${escapeHtml(formatCronHint(item.cron))}</strong>
      <div>
        <p>${escapeHtml(item.id || "")}</p>
        <small>${escapeHtml(item.message || "")}</small>
      </div>
    </article>
  `).join("");
}

function pickInitialSelection(workspaces) {
  if (state.selectedWorkspace && workspaces.some((workspace) => workspace.name === state.selectedWorkspace)) {
    const current = workspaces.find((workspace) => workspace.name === state.selectedWorkspace);
    if (current && state.selectedThreadId && current.threads.some((thread) => thread.threadId === state.selectedThreadId)) {
      return;
    }
    state.selectedThreadId = current?.currentThreadId || current?.threads[0]?.threadId || "";
    return;
  }

  const firstWorkspaceWithThread = workspaces.find((workspace) => workspace.currentThreadId || workspace.threads.length > 0);
  const initialWorkspace = firstWorkspaceWithThread || workspaces[0] || null;
  state.selectedWorkspace = initialWorkspace?.name || "";
  state.selectedThreadId = initialWorkspace?.currentThreadId || initialWorkspace?.threads[0]?.threadId || "";
}

function renderWorkspaceTree(surface) {
  if (!workspaceTree) return;
  const workspaces = surface?.data?.workspaces || [];

  if (workspaces.length === 0) {
    workspaceTree.innerHTML = renderEmptyState("暂无活跃工作区", "workspace-tree 当前没有返回可选线程。");
    return;
  }

  pickInitialSelection(workspaces);

  workspaceTree.innerHTML = workspaces.map((workspace) => {
    const workspaceName = workspace.name || "";
    const isSelectedWorkspace = workspaceName === state.selectedWorkspace;
    const currentThreadId = workspace.currentThreadId || "";
    const threads = Array.isArray(workspace.threads) ? workspace.threads : [];
    const body = threads.length > 0
      ? threads.map((thread) => {
        const selected = isSelectedWorkspace && thread.threadId === state.selectedThreadId;
        return `
          <article
            class="thread-list-item${selected ? " is-selected" : ""}"
            data-thread-id="${escapeHtml(thread.threadId || "")}"
            data-workspace="${escapeHtml(workspaceName)}"
          >
            <div class="thread-list-item__head">
              <strong>${escapeHtml(thread.title || thread.threadId || "未命名线程")}</strong>
              <span>${escapeHtml(thread.source || "unknown")}</span>
            </div>
          </article>
        `;
      }).join("")
      : `
        <article class="thread-list-item">
          <div class="thread-list-item__head">
            <strong>暂无线程</strong>
            <span>0</span>
          </div>
        </article>
      `;

    return `
      <details
        class="workspace-group${isSelectedWorkspace ? " is-selected" : ""}"
        data-workspace="${escapeHtml(workspaceName)}"
        data-current-thread-id="${escapeHtml(currentThreadId)}"
        data-first-thread-id="${escapeHtml(threads[0]?.threadId || "")}"
        open
      >
        <summary class="workspace-group__title">
          <span class="workspace-group__name">${escapeHtml(workspaceName)}</span>
          <span class="inline-chip inline-chip--muted">${threads.length}</span>
        </summary>
        <div class="workspace-group__items">
          ${body}
        </div>
      </details>
    `;
  }).join("");
}

function renderThreadPlaceholder(title, body) {
  if (threadTitle) {
    threadTitle.textContent = title;
  }
  if (threadWorkspaceChip) {
    threadWorkspaceChip.textContent = state.selectedWorkspace || "workspace";
  }
  if (threadChannelChip) {
    threadChannelChip.textContent = "readonly";
  }
  if (threadKindChip) {
    threadKindChip.textContent = state.selectedThreadId ? "thread" : "empty";
  }
  if (observerTitle) {
    observerTitle.textContent = title;
  }
  if (chatLog) {
    chatLog.innerHTML = renderEmptyState(title, body);
  }
  if (workStatusLine1) {
    workStatusLine1.textContent = body;
  }
  if (workStatusLine2) {
    workStatusLine2.textContent = "";
  }
  if (observerSecondaryTitle) {
    observerSecondaryTitle.textContent = "最近工作状况";
  }
  if (observerSecondaryContent) {
    observerSecondaryContent.innerHTML = renderStatusList([]);
  }
}

function renderThreadSurface(surface) {
  const data = surface?.data || {};
  const thread = data.thread || null;
  const workStatus = data.workStatus || { updatedAt: "", currentThreadEntries: [], recentEntries: [] };
  const schedules = Array.isArray(data.schedules) ? data.schedules : [];
  const currentThreadId = getCurrentWorkspaceThreadId();
  const errorMessage = surface?.errors?.[0]?.message || "";

  setLoadingError(errorMessage);

  if (!thread) {
    renderThreadPlaceholder("未选中线程", errorMessage || "当前工作区没有可读线程。");
    return;
  }

  if (threadTitle) {
    threadTitle.textContent = thread.title || thread.threadId || "未命名线程";
  }
  if (threadWorkspaceChip) {
    threadWorkspaceChip.textContent = state.selectedWorkspace || "workspace";
  }
  if (threadChannelChip) {
    threadChannelChip.textContent = thread.source || "unknown";
  }
  if (threadKindChip) {
    threadKindChip.textContent = thread.threadId === currentThreadId ? "当前线程" : "历史线程";
  }
  if (observerTitle) {
    observerTitle.textContent = thread.title || "线程附带信息";
  }

  const primaryEntries = Array.isArray(workStatus.currentThreadEntries) ? workStatus.currentThreadEntries : [];
  const recentEntries = Array.isArray(workStatus.recentEntries) ? workStatus.recentEntries : [];
  const line1 = primaryEntries[0]?.summary || recentEntries[0]?.summary || "暂无工作状况。";
  const line2 = primaryEntries[1]?.summary || (workStatus.updatedAt ? `最近更新时间：${formatTime(workStatus.updatedAt)}` : "");

  if (workStatusLine1) {
    workStatusLine1.textContent = line1;
  }
  if (workStatusLine2) {
    workStatusLine2.textContent = line2;
  }
  if (observerSecondaryTitle) {
    observerSecondaryTitle.textContent = schedules.length > 0 ? "日历 / 定时任务" : "最近工作状况";
  }
  if (observerSecondaryContent) {
    observerSecondaryContent.innerHTML = schedules.length > 0
      ? renderScheduleList(schedules)
      : renderStatusList(recentEntries);
  }

  const messages = Array.isArray(thread.messages) ? [...thread.messages].sort((a, b) => (a.turn || 0) - (b.turn || 0)) : [];
  if (chatLog) {
    chatLog.innerHTML = messages.length > 0
      ? messages.map((message) => `
        <article class="bubble bubble--user">${escapeHtml(message.user || "")}</article>
        <article class="bubble bubble--agent">${escapeHtml(message.assistant || "")}</article>
      `).join("")
      : renderEmptyState("线程没有正文", "thread 读面返回成功，但没有消息体。");
  }
}

function getCurrentWorkspaceThreadId() {
  const selectedWorkspace = workspaceTree?.querySelector(`[data-workspace="${CSS.escape(state.selectedWorkspace)}"]`);
  return selectedWorkspace instanceof HTMLElement ? selectedWorkspace.dataset.currentThreadId || "" : "";
}

async function loadThreadSurface() {
  if (!state.selectedWorkspace || !state.selectedThreadId) {
    setStatus("workspace-tree 已加载，等待选择线程", "ok");
    setLoadingError("");
    renderThreadPlaceholder("未选中线程", "请先从左侧选择一条活跃线程。");
    return;
  }

  setStatus(`读取 thread: ${state.selectedWorkspace}/${state.selectedThreadId}`, "idle");
  try {
    const envelope = await runSurfaceCommand("thread", {
      workspace: state.selectedWorkspace,
      threadId: state.selectedThreadId,
    });
    renderThreadSurface(envelope);
    setStatus(`thread 已加载: ${state.selectedWorkspace}/${state.selectedThreadId}`, envelope.status === "pass" ? "ok" : "idle");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLoadingError(message);
    renderThreadPlaceholder("线程读取失败", message);
    setStatus("thread 读取失败", "idle");
  }
}

async function loadWorkspaceTree() {
  setStatus("读取 workspace-tree...", "idle");
  try {
    const envelope = await runSurfaceCommand("workspace-tree", {});
    renderWorkspaceTree(envelope);
    const warningMessage = envelope?.warnings?.[0]?.message || "";
    setLoadingError(warningMessage);
    setStatus("workspace-tree 已加载", envelope.status === "pass" ? "ok" : "idle");
    await loadThreadSurface();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLoadingError(message);
    if (workspaceTree) {
      workspaceTree.innerHTML = renderEmptyState("workspace-tree 读取失败", message);
    }
    renderThreadPlaceholder("只读线程面未联通", message);
    setStatus("workspace-tree 读取失败", "idle");
  }
}

if (workspaceTree) {
  workspaceTree.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const threadItem = target.closest("[data-thread-id]");
    if (threadItem instanceof HTMLElement) {
      state.selectedWorkspace = threadItem.dataset.workspace || "";
      state.selectedThreadId = threadItem.dataset.threadId || "";
      await loadWorkspaceTree();
      return;
    }

    const workspaceItem = target.closest("[data-workspace]");
    if (workspaceItem instanceof HTMLElement) {
      state.selectedWorkspace = workspaceItem.dataset.workspace || "";
      state.selectedThreadId = workspaceItem.dataset.currentThreadId || workspaceItem.dataset.firstThreadId || "";
      await loadWorkspaceTree();
    }
  });
}

loadWorkspaceTree();

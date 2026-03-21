const workspaceTree = document.getElementById("workspace-tree");
const surfaceStatus = document.getElementById("surface-status");
const threadTitle = document.getElementById("thread-title");
const threadWorkspaceChip = document.getElementById("thread-workspace-chip");
const threadChannelChip = document.getElementById("thread-channel-chip");
const threadKindChip = document.getElementById("thread-kind-chip");
const chatLog = document.getElementById("chat-log");
const observerTitle = document.getElementById("observer-title");
const prototypeNote = document.getElementById("prototype-note");
const prototypeNoteDetail = document.getElementById("prototype-note-detail");
const workStatusLine1 = document.getElementById("work-status-line-1");
const workStatusLine2 = document.getElementById("work-status-line-2");
const observerSecondaryTitle = document.getElementById("observer-secondary-title");
const observerSecondaryContent = document.getElementById("observer-secondary-content");

const state = {
  selectedWorkspace: "family",
  selectedThreadId: "copy-edit",
};

const prototypeSurface = {
  note: {
    title: "原型研究面",
    body: "这里只保留静态阅读和演示，不走正式宿主桥接。",
    detail: "一级入口保留，三栏结构保留，正式实现另走 src。",
  },
  workspaces: [
    {
      name: "family",
      currentThreadId: "copy-edit",
      threads: [
        {
          threadId: "copy-edit",
          title: "Copy Edit",
          source: "prototype",
          channel: "draft",
          kind: "readonly",
          messages: [
            {
              turn: 1,
              user: "把开场再收短一点。",
              assistant: "可以，保留一条主线，把背景说明压成一句。",
            },
            {
              turn: 2,
              user: "一级入口还要留吗？",
              assistant: "留，作为原型研究面的一部分。",
            },
          ],
          workStatus: [
            "当前关注点：原型说明收口。",
            "最近动作：保留 settings 入口，不做正式桥接。",
          ],
          observer: [
            "该线程用于演示静态布局与阅读节奏。",
            "不承载正式读面联通。",
          ],
          schedule: [
            { cron: "0 9 * * 1", id: "prototype-review", message: "检查原型口径是否仍然干净。" },
          ],
        },
        {
          threadId: "family-notes",
          title: "Family Notes",
          source: "prototype",
          channel: "notes",
          kind: "readonly",
          messages: [
            {
              turn: 1,
              user: "这个页面的任务是什么？",
              assistant: "展示静态原型，不接正式运行时。",
            },
          ],
          workStatus: [
            "当前关注点：静态展示。",
            "最近动作：保留既定入口。",
          ],
          observer: [
            "用于演示多线程样式，但不代表真实工作流。",
          ],
          schedule: [],
        },
      ],
    },
    {
      name: "ops-room",
      currentThreadId: "ops-brief",
      threads: [
        {
          threadId: "ops-brief",
          title: "Ops Brief",
          source: "prototype",
          channel: "report",
          kind: "readonly",
          messages: [
            {
              turn: 1,
              user: "今天的状态怎么样？",
              assistant: "一切都在原型研究面里。",
            },
          ],
          workStatus: [
            "当前关注点：保持页面可静态阅读。",
            "最近动作：去掉正式桥接依赖。",
          ],
          observer: [
            "这里仍然只是示意区，不是运行态控制面。",
          ],
          schedule: [
            { cron: "30 14 * * 3", id: "design-sync", message: "回看结构是否还像原型。" },
          ],
        },
      ],
    },
    {
      name: "lab",
      currentThreadId: "prototype-audit",
      threads: [
        {
          threadId: "prototype-audit",
          title: "Prototype Audit",
          source: "prototype",
          channel: "audit",
          kind: "readonly",
          messages: [
            {
              turn: 1,
              user: "还剩哪些正式 UI 痕迹？",
              assistant: "已收掉桥接、加载失败和正式读面空态路径。",
            },
            {
              turn: 2,
              user: "这页现在做什么？",
              assistant: "做静态演示，保留一级入口和 UX 结构。",
            },
          ],
          workStatus: [
            "当前关注点：边界清晰。",
            "最近动作：把主窗口退回原型研究面。",
          ],
          observer: [
            "这个线程用于人工巡检原型表面。",
            "点击不同工作区可以切换示例内容。",
          ],
          schedule: [],
        },
      ],
    },
  ],
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatCronHint(cron) {
  if (!cron) return "--";
  const parts = String(cron).split(" ");
  if (parts.length < 2) return cron;
  return `${String(parts[1]).padStart(2, "0")}:${String(parts[0]).padStart(2, "0")}`;
}

function summarizeThread(thread) {
  const firstMessage = thread.messages[0];
  if (!firstMessage) return "静态演示线程";
  return firstMessage.assistant || firstMessage.user || "静态演示线程";
}

function getWorkspace(workspaceName) {
  return prototypeSurface.workspaces.find((workspace) => workspace.name === workspaceName) || prototypeSurface.workspaces[0];
}

function getThread(workspaceName, threadId) {
  const workspace = getWorkspace(workspaceName);
  return workspace.threads.find((thread) => thread.threadId === threadId) || workspace.threads[0];
}

function setStatus(text) {
  if (!surfaceStatus) return;
  surfaceStatus.textContent = text;
}

function renderRailEmptyState(title, body) {
  return `
    <section class="compact-empty-state compact-empty-state--rail" aria-label="${escapeHtml(title)}">
      <div class="compact-empty-state__row">
        <strong>${escapeHtml(title)}</strong>
      </div>
      <p>${escapeHtml(body)}</p>
    </section>
  `;
}

function renderThreadEmptyState(title, body) {
  return `
    <section class="thread-empty-state" aria-label="${escapeHtml(title)}">
      <header class="thread-empty-state__head">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(body)}</p>
      </header>
      <div class="thread-empty-state__placeholder">
        <span class="thread-empty-state__line thread-empty-state__line--wide"></span>
        <span class="thread-empty-state__line"></span>
        <span class="thread-empty-state__line thread-empty-state__line--short"></span>
      </div>
    </section>
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
      <div>
        <p>${escapeHtml(entry)}</p>
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

function pickInitialSelection() {
  const workspace = getWorkspace(state.selectedWorkspace);
  const thread = getThread(workspace.name, state.selectedThreadId);
  state.selectedWorkspace = workspace.name;
  state.selectedThreadId = thread.threadId;
  return { workspace, thread };
}

function renderWorkspaceTree() {
  if (!workspaceTree) return;

  const workspaces = prototypeSurface.workspaces;
  if (workspaces.length === 0) {
    workspaceTree.innerHTML = renderRailEmptyState("暂无示例工作区", "原型数据为空。");
    return;
  }

  workspaceTree.innerHTML = workspaces.map((workspace) => {
    const isSelectedWorkspace = workspace.name === state.selectedWorkspace;
    const threads = Array.isArray(workspace.threads) ? workspace.threads : [];
    const items = threads.map((thread) => {
      const selected = isSelectedWorkspace && thread.threadId === state.selectedThreadId;
      return `
        <article
          class="thread-list-item${selected ? " is-selected" : ""}"
          data-thread-id="${escapeHtml(thread.threadId)}"
          data-workspace="${escapeHtml(workspace.name)}"
        >
          <div class="thread-list-item__head">
            <strong>${escapeHtml(thread.title)}</strong>
            <span>${escapeHtml(thread.source)}</span>
          </div>
        </article>
      `;
    }).join("");

    return `
      <details class="workspace-group${isSelectedWorkspace ? " is-selected" : ""}" data-workspace="${escapeHtml(workspace.name)}" open>
        <summary class="workspace-group__title">
          <span class="workspace-group__name">${escapeHtml(workspace.name)}</span>
          <span class="inline-chip inline-chip--muted">${threads.length}</span>
        </summary>
        <div class="workspace-group__items">
          ${items}
        </div>
      </details>
    `;
  }).join("");
}

function renderThreadSurface() {
  const { workspace, thread } = pickInitialSelection();
  const messages = Array.isArray(thread.messages) ? [...thread.messages].sort((a, b) => (a.turn || 0) - (b.turn || 0)) : [];
  const workStatus = Array.isArray(thread.workStatus) ? thread.workStatus : [];
  const observer = Array.isArray(thread.observer) ? thread.observer : [];
  const schedule = Array.isArray(thread.schedule) ? thread.schedule : [];

  setStatus("静态原型数据已加载");

  if (threadTitle) {
    threadTitle.textContent = thread.title;
  }
  if (threadWorkspaceChip) {
    threadWorkspaceChip.textContent = workspace.name;
  }
  if (threadChannelChip) {
    threadChannelChip.textContent = thread.channel || thread.source || "prototype";
  }
  if (threadKindChip) {
    threadKindChip.textContent = thread.kind || "readonly";
  }
  if (observerTitle) {
    observerTitle.textContent = thread.title;
  }
  if (prototypeNote) {
    prototypeNote.textContent = prototypeSurface.note.title;
  }
  if (prototypeNoteDetail) {
    prototypeNoteDetail.textContent = prototypeSurface.note.body;
  }
  if (workStatusLine1) {
    workStatusLine1.textContent = workStatus[0] || "暂无工作状况。";
  }
  if (workStatusLine2) {
    workStatusLine2.textContent = workStatus[1] || prototypeSurface.note.detail;
  }
  if (observerSecondaryTitle) {
    observerSecondaryTitle.textContent = schedule.length > 0 ? "日历 / 定时任务" : "观察说明";
  }
  if (observerSecondaryContent) {
    observerSecondaryContent.innerHTML = schedule.length > 0 ? renderScheduleList(schedule) : renderStatusList(observer);
  }
  if (chatLog) {
    chatLog.innerHTML = messages.length > 0
      ? messages.map((message) => `
        <article class="bubble bubble--user">${escapeHtml(message.user || "")}</article>
        <article class="bubble bubble--agent">${escapeHtml(message.assistant || "")}</article>
      `).join("")
      : renderThreadEmptyState("静态原型", "这里保留正文区结构，但不接正式宿主读取。");
  }
}

function selectThread(workspaceName, threadId) {
  state.selectedWorkspace = workspaceName;
  state.selectedThreadId = threadId;
  renderWorkspaceTree();
  renderThreadSurface();
}

if (workspaceTree) {
  workspaceTree.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const threadItem = target.closest("[data-thread-id]");
    if (threadItem instanceof HTMLElement) {
      selectThread(threadItem.dataset.workspace || state.selectedWorkspace, threadItem.dataset.threadId || state.selectedThreadId);
      return;
    }

    const workspaceItem = target.closest("[data-workspace]");
    if (workspaceItem instanceof HTMLElement) {
      const workspace = getWorkspace(workspaceItem.dataset.workspace || state.selectedWorkspace);
      selectThread(workspace.name, workspace.currentThreadId || workspace.threads[0]?.threadId || state.selectedThreadId);
    }
  });
}

renderWorkspaceTree();
renderThreadSurface();

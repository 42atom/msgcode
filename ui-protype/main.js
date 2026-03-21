const navItems = document.querySelectorAll("[data-view]");
const panels = document.querySelectorAll("[data-view-panel]");

const workspaceTree = document.getElementById("workspace-tree");
const threadTitle = document.getElementById("thread-title");
const threadChannelChip = document.getElementById("thread-channel-chip");
const threadKindChip = document.getElementById("thread-kind-chip");
const chatLog = document.getElementById("chat-log");
const observerTitle = document.getElementById("observer-title");
const workStatusLine1 = document.getElementById("work-status-line-1");
const workStatusLine2 = document.getElementById("work-status-line-2");
const observerSecondaryTitle = document.getElementById("observer-secondary-title");
const observerSecondaryContent = document.getElementById("observer-secondary-content");
const sendButton = document.getElementById("send-button");
const composerStatus = document.getElementById("composer-status");
const observerPanel = document.getElementById("observer-panel");
const observerToggle = document.getElementById("observer-toggle");
const observerClose = document.getElementById("observer-close");

const workspaceTreeData = {
  workspaceRoot: "/Users/admin/msgcode-workspaces",
  workspaces: [
    { key: "acme", name: "acme", threads: [] },
    { key: "artifacts", name: "artifacts", threads: [] },
    { key: "charai", name: "charai", threads: [] },
    {
      key: "default",
      name: "default",
      threads: [
        { key: "default-reminder", title: "以后所有定时提醒文字内容前面加一个‘⏰’,这样", source: "feishu" },
        { key: "default-hi", title: "hi", source: "feishu" },
      ],
    },
    {
      key: "family",
      name: "family",
      peopleCount: 2,
      open: true,
      threads: [
        { key: "door", title: "我在门口准备好了", source: "feishu", selected: true },
        { key: "missed-reminder", title: "今天为什么没有提醒我", source: "feishu" },
        { key: "vision", title: "@_user_1 你看看这个小朋友的视力检查结果", source: "feishu" },
        { key: "copy-edit", title: "145了该接小孩了", source: "feishu" },
      ],
    },
    {
      key: "game01",
      name: "game01",
      threads: [
        { key: "game01-smoke", title: "【SMOKE-SKILL-1771572317】-2", source: "feishu" },
      ],
    },
    {
      key: "medicpass",
      name: "medicpass",
      threads: [
        { key: "medicpass-model", title: "你是什么模型", source: "feishu" },
      ],
    },
    { key: "mlx-whisper", name: "mlx-whisper", threads: [] },
    { key: "mycompany", name: "mycompany", threads: [] },
    {
      key: "mylife",
      name: "mylife",
      threads: [
        { key: "mylife-update", title: "之前是老代码 现在更新了", source: "feishu" },
      ],
    },
    { key: "r9-smoke-20260222-181939", name: "r9-smoke-20260222-181939", threads: [] },
    { key: "real-test", name: "real-test", threads: [] },
    { key: "skill-wpkg", name: "skill-wpkg", threads: [] },
    {
      key: "test-real",
      name: "test-real",
      threads: [
        { key: "test-real-subagent", title: "哥，先别实际委派。请读取 subagent 这个", source: "feishu" },
      ],
    },
  ],
};

const threadData = {
  door: {
    title: "我在门口准备好了",
    channel: "feishu",
    kind: "当前线程",
    messages: [
      { role: "user", text: "我在门口准备好了" },
      { role: "agent", text: "好的，Chandler的健康档案已经建好了。去接小孩的路上注意安全。" },
      { role: "user", text: "好" },
      { role: "agent", text: "好的，路上慢点。" },
    ],
    workStatus: [
      "最新一条 family 线程，主要是出门前确认。",
      "",
    ],
    secondaryTitle: "日历 / 定时任务",
    secondaryHtml: `
      <article class="schedule-item">
        <strong>11:45</strong>
        <div>
          <p>pick-up-kids</p>
          <small>通知用户 ⏰ 中午要接小孩回家了</small>
        </div>
      </article>
      <article class="schedule-item">
        <strong>13:40</strong>
        <div>
          <p>send-kids-school</p>
          <small>通知用户 ⏰: 1:40了该送小孩上学了</small>
        </div>
      </article>
      <article class="schedule-item">
        <strong>16:00</strong>
        <div>
          <p>pickup-kid</p>
          <small>通知用户去学校接娃 ⏰: 放学接娃</small>
        </div>
      </article>
    `,
  },
  "missed-reminder": {
    title: "今天为什么没有提醒我",
    channel: "feishu",
    kind: "历史线程",
    messages: [
      { role: "user", text: "今天为什么没有提醒我" },
      { role: "agent", text: "我查到了 pick-up-kids 的配置：周一至周五 11:45，消息是“通知用户 ⏰ 中午要接小孩回家了”，配置本身正常。" },
      { role: "user", text: "帮我看看这个结果" },
      { role: "agent", text: "后续这条线又接上了一张眼科报告图片，话题开始从提醒排查转向报告解读。" },
    ],
    workStatus: [
      "围绕接娃提醒未触发的排查线。",
      "相关真相源是 schedules 和日志。",
    ],
    secondaryTitle: "相关定时任务",
    secondaryHtml: `
      <article class="schedule-item">
        <strong>11:45</strong>
        <div>
          <p>pick-up-kids</p>
          <small>通知用户 ⏰ 中午要接小孩回家了</small>
        </div>
      </article>
      <article class="schedule-item">
        <strong>13:40</strong>
        <div>
          <p>send-kids-school</p>
          <small>通知用户 ⏰: 1:40了该送小孩上学了</small>
        </div>
      </article>
    `,
  },
  vision: {
    title: "@_user_1 你看看这个小朋友的视力检查结果",
    channel: "feishu",
    kind: "历史线程",
    messages: [
      { role: "user", text: "@_user_1 你看看这个小朋友的视力检查结果 给我一些建议 7岁小朋友" },
      { role: "agent", text: "先是把报告误解成右眼 300 度近视，后面又回到 DS / DC / AXIS 的解释，承认了前面的矛盾。" },
      { role: "user", text: "@_user_1 你搜索一下相关信息 给出一个准确合理的信息 比如ds到底代表什么" },
      { role: "agent", text: "最后收口到 DS 是球镜度数，DC 是柱镜度数，AXIS 是散光轴位，并提醒要确认到底是裸眼还是矫正视力。" },
    ],
    workStatus: [
      "围绕视力检查报告的解读和修正。",
      "",
    ],
    secondaryTitle: "相关记录",
    secondaryHtml: `
      <article class="schedule-item">
        <strong>03-17</strong>
        <div>
          <p>视力检查讨论</p>
          <small>thread markdown 中有完整对话与自我修正过程</small>
        </div>
      </article>
      <article class="schedule-item">
        <strong>DS/DC</strong>
        <div>
          <p>术语澄清</p>
          <small>DS=球镜度数，DC=柱镜度数，AXIS=散光轴位</small>
        </div>
      </article>
    `,
  },
  "copy-edit": {
    title: "145了该接小孩了",
    channel: "feishu",
    kind: "历史线程",
    messages: [
      { role: "user", text: "1:45了该接小孩了 这句话改成 ‘⏰中午要接小孩回家了’ 其他不变" },
      { role: "agent", text: "这条线先没定位到任务，后面才回到 3 个 schedules，并开始实际改文案。" },
      { role: "user", text: "是⏰中午要接小孩回家了 ,不是 ⏰中午要接小孩回了家" },
      { role: "agent", text: "最后确认消息内容应为“⏰中午要接小孩回家了”。" },
    ],
    workStatus: [
      "围绕接娃提醒文案修订的历史线程。",
      "",
    ],
    secondaryTitle: "相关定时任务",
    secondaryHtml: `
      <article class="schedule-item">
        <strong>11:45</strong>
        <div>
          <p>pick-up-kids</p>
          <small>文案最终定为：通知用户 ⏰ 中午要接小孩回家了</small>
        </div>
      </article>
    `,
  },
  "default-reminder": {
    title: "以后所有定时提醒文字内容前面加一个‘⏰’,这样",
    channel: "feishu",
    kind: "历史线程",
    messages: [
      { role: "user", text: "以后所有定时提醒文字内容前面加一个‘⏰’,这样更醒目。" },
      { role: "agent", text: "收到，这条线主要围绕提醒文案的统一调整。" },
    ],
    workStatus: ["default 工作区的一条旧提醒调整线程。", ""],
    secondaryTitle: "相关定时任务",
    secondaryHtml: `
      <article class="schedule-item">
        <strong>11:45</strong>
        <div>
          <p>pick-up-kids</p>
          <small>文案统一调整为带 ⏰ 前缀</small>
        </div>
      </article>
    `,
  },
  "default-hi": {
    title: "hi",
    channel: "feishu",
    kind: "历史线程",
    messages: [
      { role: "user", text: "hi" },
      { role: "agent", text: "你好。" },
    ],
    workStatus: ["default 工作区的早期测试线程。", ""],
    secondaryTitle: "附记",
    secondaryHtml: `
      <article class="schedule-item">
        <strong>旧线程</strong>
        <div>
          <p>保留为历史记录</p>
          <small>适合后续归档</small>
        </div>
      </article>
    `,
  },
  "game01-smoke": {
    title: "【SMOKE-SKILL-1771572317】-2",
    channel: "feishu",
    kind: "历史线程",
    messages: [
      { role: "user", text: "【SMOKE-SKILL-1771572317】-2" },
      { role: "agent", text: "这是一条 smoke 线程，占位展示。后续应通过 archive 收起来。" },
    ],
    workStatus: ["这类冒烟线程是 archive 的典型目标。", ""],
    secondaryTitle: "附记",
    secondaryHtml: "",
  },
  "medicpass-model": {
    title: "你是什么模型",
    channel: "feishu",
    kind: "历史线程",
    messages: [
      { role: "user", text: "你是什么模型" },
      { role: "agent", text: "这里先只模拟线程，不展开正文。" },
    ],
    workStatus: ["medicpass 工作区的一条历史问答。", ""],
    secondaryTitle: "附记",
    secondaryHtml: "",
  },
  "mylife-update": {
    title: "之前是老代码 现在更新了",
    channel: "feishu",
    kind: "历史线程",
    messages: [
      { role: "user", text: "之前是老代码 现在更新了" },
      { role: "agent", text: "这条线先保留成工作区树中的真实标题示意。" },
    ],
    workStatus: ["mylife 工作区的一条历史线程。", ""],
    secondaryTitle: "附记",
    secondaryHtml: "",
  },
  "test-real-subagent": {
    title: "哥，先别实际委派。请读取 subagent 这个",
    channel: "feishu",
    kind: "历史线程",
    messages: [
      { role: "user", text: "哥，先别实际委派。请读取 subagent 这个" },
      { role: "agent", text: "这是一条 test-real 工作区的历史线程示意。" },
    ],
    workStatus: ["test-real 工作区的一条历史线程。", ""],
    secondaryTitle: "附记",
    secondaryHtml: "",
  },
};

const WORKSPACE_ORDER_STORAGE_KEY = "msgcode-ui-workspace-order";

let selectedWorkspaceKey = "family";
let selectedThreadKey = "door";

function renderThread(threadKey) {
  const data = threadData[threadKey];
  if (!data) return;

  if (threadTitle) threadTitle.textContent = data.title;
  if (threadChannelChip) threadChannelChip.textContent = data.channel;
  if (threadKindChip) threadKindChip.textContent = data.kind;
  if (observerTitle) observerTitle.textContent = data.title;
  if (workStatusLine1) {
    workStatusLine1.textContent = data.workStatus[0] || "";
    workStatusLine1.hidden = !data.workStatus[0];
  }
  if (workStatusLine2) {
    workStatusLine2.textContent = data.workStatus[1] || "";
    workStatusLine2.hidden = !data.workStatus[1];
  }
  if (observerSecondaryTitle) observerSecondaryTitle.textContent = data.secondaryTitle;
  if (observerSecondaryContent) observerSecondaryContent.innerHTML = data.secondaryHtml;

  if (chatLog) {
    chatLog.innerHTML = data.messages
      .map((message) => {
        const klass = message.role === "user" ? "bubble bubble--user" : "bubble bubble--agent";
        return `<article class="${klass}">${message.text}</article>`;
      })
      .join("");
  }
}

function applyStoredWorkspaceOrder() {
  if (!workspaceTree) return;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_ORDER_STORAGE_KEY);
    if (!raw) return;
    const order = JSON.parse(raw);
    if (!Array.isArray(order)) return;
    const workspaceMap = new Map(workspaceTreeData.workspaces.map((workspace) => [workspace.key, workspace]));
    const next = [];
    for (const workspaceKey of order) {
      const workspace = workspaceMap.get(workspaceKey);
      if (workspace) {
        next.push(workspace);
        workspaceMap.delete(workspaceKey);
      }
    }
    for (const workspace of workspaceTreeData.workspaces) {
      if (workspaceMap.has(workspace.key)) next.push(workspace);
    }
    workspaceTreeData.workspaces = next;
  } catch (error) {
    console.warn("failed to restore workspace order", error);
  }
}

function saveWorkspaceOrder() {
  const order = workspaceTreeData.workspaces.map((item) => item.key);
  window.localStorage.setItem(WORKSPACE_ORDER_STORAGE_KEY, JSON.stringify(order));
}

function bindWorkspaceSorting() {
  if (!workspaceTree) return;
  if (workspaceTree.dataset.sortBound === "true") return;
  workspaceTree.dataset.sortBound = "true";

  let draggingWorkspace = null;

  const getDragAfterElement = (container, clientY) => {
    const draggableCards = [...container.querySelectorAll(".workspace-group:not(.is-dragging)")];

    return draggableCards.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = clientY - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset, element: child };
        }
        return closest;
      },
      { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
  };

  workspaceTree.addEventListener("dragstart", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const card = target.closest(".workspace-group");
    if (!(card instanceof HTMLElement)) return;
    draggingWorkspace = card;
    card.classList.add("is-dragging");
  });

  workspaceTree.addEventListener("dragend", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const card = target.closest(".workspace-group");
    if (!(card instanceof HTMLElement)) return;
    card.classList.remove("is-dragging");
    draggingWorkspace = null;
    syncWorkspaceOrderFromDom();
    saveWorkspaceOrder();
  });

  workspaceTree.addEventListener("toggle", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const card = target.closest(".workspace-group");
    if (!(card instanceof HTMLElement)) return;
    const workspaceKey = card.dataset.workspaceKey;
    if (workspaceKey) {
      const workspace = workspaceTreeData.workspaces.find((item) => item.key === workspaceKey);
      if (workspace) workspace.open = card.open;
    }
  });

  workspaceTree.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!draggingWorkspace) return;

    const afterElement = getDragAfterElement(workspaceTree, event.clientY);
    if (!afterElement) {
      workspaceTree.appendChild(draggingWorkspace);
      return;
    }
    workspaceTree.insertBefore(draggingWorkspace, afterElement);
  });
}

function syncWorkspaceOrderFromDom() {
  if (!workspaceTree) return;
  const order = Array.from(workspaceTree.querySelectorAll(".workspace-group"))
    .map((item) => item.dataset.workspaceKey)
    .filter(Boolean);
  workspaceTreeData.workspaces = order
    .map((key) => workspaceTreeData.workspaces.find((workspace) => workspace.key === key))
    .filter(Boolean);
}

function renderWorkspaceTree() {
  if (!workspaceTree) return;

  workspaceTree.innerHTML = workspaceTreeData.workspaces
    .map((workspace) => {
      const threads = workspace.threads.length > 0
        ? workspace.threads.map((thread) => `
            <article class="thread-list-item${thread.key === selectedThreadKey ? " is-selected" : ""}" data-thread-key="${thread.key}" data-workspace-key="${workspace.key}">
              <div class="thread-list-item__head">
                <strong>${escapeHtml(thread.title)}</strong>
                <span>${escapeHtml(thread.source)}</span>
              </div>
            </article>
          `).join("")
        : `
            <article class="thread-list-item">
              <div class="thread-list-item__head">
                <strong>暂无线程</strong>
                <span>0</span>
              </div>
            </article>
          `;

      const peopleLink = workspace.peopleCount !== undefined
        ? `
          <a class="project-mini-link" href="./people.html" title="人物角色" aria-label="人物角色">
            <span class="project-mini-link__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 12a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7Z"></path>
                <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"></path>
              </svg>
            </span>
            <span class="project-mini-link__count">${workspace.peopleCount}</span>
          </a>
        `
        : "";

      return `
        <details class="workspace-group${workspace.key === selectedWorkspaceKey ? " is-selected" : ""}" data-workspace-key="${workspace.key}" ${workspace.open ? "open" : ""}>
          <summary class="workspace-group__title">
            <span class="workspace-group__name">${escapeHtml(workspace.name)}</span>
            ${peopleLink}
          </summary>
          <div class="workspace-group__items">
            ${threads}
          </div>
        </details>
      `;
    })
    .join("");

  bindWorkspaceSorting();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

for (const item of navItems) {
  item.addEventListener("click", () => {
    const target = item.dataset.view;
    for (const current of navItems) current.classList.toggle("is-active", current === item);
    for (const panel of panels) panel.classList.toggle("view--active", panel.dataset.viewPanel === target);
  });
}

if (workspaceTree) {
  workspaceTree.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const threadItem = target.closest("[data-thread-key]");
    if (threadItem instanceof HTMLElement) {
      const threadKey = threadItem.dataset.threadKey;
      const workspaceKey = threadItem.dataset.workspaceKey;
      if (threadKey) {
        selectedThreadKey = threadKey;
        if (workspaceKey) selectedWorkspaceKey = workspaceKey;
        renderWorkspaceTree();
        renderThread(threadKey);
      }
    }
  });
}

if (sendButton && composerStatus) {
  sendButton.addEventListener("click", () => {
    sendButton.setAttribute("disabled", "true");
    composerStatus.textContent = "已投递到 runtime inbox，等待线程回写后再上屏。";
    setTimeout(() => {
      sendButton.removeAttribute("disabled");
      composerStatus.textContent = "输入只负责投递给 runtime；消息上屏以后端回写为准。";
    }, 1800);
  });
}

if (observerToggle && observerPanel) {
  observerToggle.addEventListener("click", () => {
    observerPanel.classList.add("is-open");
  });
}

if (observerClose && observerPanel) {
  observerClose.addEventListener("click", () => {
    observerPanel.classList.remove("is-open");
  });
}

applyStoredWorkspaceOrder();
renderWorkspaceTree();
renderThread(selectedThreadKey);

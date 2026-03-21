const navItems = document.querySelectorAll("[data-view]");
const panels = document.querySelectorAll("[data-view-panel]");

const workspaceCards = document.querySelectorAll("[data-workspace-key]");
const workspaceTree = document.getElementById("workspace-tree");

const threadItems = document.querySelectorAll("[data-thread-key]");
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
};

const WORKSPACE_ORDER_STORAGE_KEY = "msgcode-ui-workspace-order";

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

  for (const item of threadItems) {
    item.classList.toggle("is-selected", item.dataset.threadKey === threadKey);
  }
}

function applyStoredWorkspaceOrder() {
  if (!workspaceTree || workspaceCards.length === 0) return;

  try {
    const raw = window.localStorage.getItem(WORKSPACE_ORDER_STORAGE_KEY);
    if (!raw) return;
    const order = JSON.parse(raw);
    if (!Array.isArray(order)) return;

    const workspaceMap = new Map(Array.from(workspaceCards).map((card) => [card.dataset.workspaceKey, card]));
    for (const workspaceKey of order) {
      const card = workspaceMap.get(workspaceKey);
      if (card) workspaceTree.appendChild(card);
    }
  } catch (error) {
    console.warn("failed to restore workspace order", error);
  }
}

function saveWorkspaceOrder() {
  if (!workspaceTree) return;
  const order = Array.from(workspaceTree.querySelectorAll(".workspace-group"))
    .map((item) => item.dataset.workspaceKey)
    .filter(Boolean);
  window.localStorage.setItem(WORKSPACE_ORDER_STORAGE_KEY, JSON.stringify(order));
}

function bindWorkspaceSorting() {
  if (!workspaceTree || workspaceCards.length === 0) return;

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

  for (const card of workspaceCards) {
    card.addEventListener("dragstart", () => {
      draggingWorkspace = card;
      card.classList.add("is-dragging");
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      draggingWorkspace = null;
      saveWorkspaceOrder();
    });

    card.addEventListener("click", () => {
      for (const current of workspaceCards) current.classList.toggle("is-selected", current === card);
    });
  }

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

for (const item of navItems) {
  item.addEventListener("click", () => {
    const target = item.dataset.view;
    for (const current of navItems) current.classList.toggle("is-active", current === item);
    for (const panel of panels) panel.classList.toggle("view--active", panel.dataset.viewPanel === target);
  });
}

for (const item of threadItems) {
  item.addEventListener("click", () => {
    const threadKey = item.dataset.threadKey;
    if (threadKey) renderThread(threadKey);
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
bindWorkspaceSorting();
renderThread("door");

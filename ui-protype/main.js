const navItems = document.querySelectorAll("[data-view]");
const panels = document.querySelectorAll("[data-view-panel]");

const threadItems = document.querySelectorAll("[data-thread-key]");
const threadTitle = document.getElementById("thread-title");
const threadChannelChip = document.getElementById("thread-channel-chip");
const threadKindChip = document.getElementById("thread-kind-chip");
const threadStatusStrip = document.getElementById("thread-status-strip");
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
  web: {
    title: "网页线程",
    channel: "web",
    kind: "主线程",
    status: "共享近况：Chandler 的健康档案已建好；当前有 3 个接送提醒正在运行。",
    messages: [
      { role: "user", text: "今天为什么没有提醒我" },
      { role: "agent", text: "我查到了 pick-up-kids 任务的配置：周一至周五 11:45，消息是“通知用户 ⏰ 中午要接小孩回家了”，配置本身是正常的。" },
      { role: "user", text: "帮我看看今天下午还有哪些接娃提醒。" },
    ],
    workStatus: [
      "最近在处理接送提醒是否正常，以及 Chandler 的健康记录整理。",
      "当前关注：中午接娃提醒为什么没有按时出现。",
    ],
    secondaryTitle: "日历 / 定时任务",
    secondaryHtml: `
      <article class="schedule-item">
        <strong>11:45</strong>
        <div>
          <p>中午接小孩回家</p>
          <small>工作日提醒 · pick-up-kids</small>
        </div>
      </article>
      <article class="schedule-item">
        <strong>13:40</strong>
        <div>
          <p>送小孩上学</p>
          <small>工作日提醒 · send-kids-school</small>
        </div>
      </article>
      <article class="schedule-item">
        <strong>16:00</strong>
        <div>
          <p>放学接娃</p>
          <small>工作日提醒 · pickup-kid</small>
        </div>
      </article>
    `,
  },
  feishu: {
    title: "飞书线程",
    channel: "feishu",
    kind: "活跃线程",
    status: "共享近况：这条线程最近在补录视力检查数据，并已把结果写进 Chandler 健康档案。",
    messages: [
      { role: "user", text: "这在普通小朋友的视力水平中算好还是坏" },
      { role: "agent", text: "目前视力还行，但眼轴发育偏快，属于近视储备偏低，需要持续观察。" },
      { role: "user", text: "你帮我建个档 小朋友名字 chandler 集中记录他的健康报告" },
      { role: "agent", text: "Chandler 的健康档案已建立，以后新的健康报告都可以继续往这个目录里追加。" },
    ],
    workStatus: [
      "最近在整理 Chandler 的视力检查结果和健康档案。",
      "当前关注：把报告、解释和后续建议都沉淀到同一处，方便后面继续补充。",
    ],
    secondaryTitle: "相关记录",
    secondaryHtml: `
      <article class="schedule-item">
        <strong>03-19</strong>
        <div>
          <p>视力检查报告</p>
          <small>AIDOCS/eye_checkup_2026-03-19.md</small>
        </div>
      </article>
      <article class="schedule-item">
        <strong>03-19</strong>
        <div>
          <p>Chandler 健康档案</p>
          <small>AIDOCS/Chandler健康档案/视力检查报告_2026-03-19.md</small>
        </div>
      </article>
      <article class="schedule-item">
        <strong>03-20</strong>
        <div>
          <p>最新接娃对话</p>
          <small>我在门口准备好了 · 路上慢点</small>
        </div>
      </article>
    `,
  },
};

function renderThread(threadKey) {
  const data = threadData[threadKey];
  if (!data) return;

  if (threadTitle) threadTitle.textContent = data.title;
  if (threadChannelChip) threadChannelChip.textContent = data.channel;
  if (threadKindChip) threadKindChip.textContent = data.kind;
  if (threadStatusStrip) threadStatusStrip.textContent = data.status;
  if (observerTitle) observerTitle.textContent = data.title;
  if (workStatusLine1) workStatusLine1.textContent = data.workStatus[0] || "";
  if (workStatusLine2) workStatusLine2.textContent = data.workStatus[1] || "";
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

renderThread("web");

const toggle = document.getElementById("neighbor-toggle");
const logPanel = document.getElementById("neighbor-log");
const probeSummary = document.getElementById("neighbor-probe-summary");
const threadTitle = document.getElementById("neighbor-thread-title");
const nodeCards = Array.from(document.querySelectorAll(".neighbor-node-card"));

const threadMap = {
  "ops-room-mini": [
    { kind: "sys", author: "系统", time: "09:42", text: "发现节点 `ops-room-mini`，状态进入 discovered。" },
    { kind: "peer", avatar: "运", author: "ops-room-mini", time: "09:44", text: "你好，我可以提供运营日报摘要和渠道投放复盘。", footer: "已识别 · known" },
    { kind: "self", avatar: "我", author: "sam@acme-ops", time: "09:45", text: "请给我一份昨日小红书投放摘要，优先看退款波动。", footer: "已发送" },
    { kind: "peer", avatar: "运", author: "ops-room-mini", time: "09:46", text: "已回传一份摘要和截图。", tags: ["summary.md", "refund-spike.png"], footer: "已投递" },
    { kind: "sys", author: "审计", time: "09:46", text: "消息 `delivery: ok`，artifact 2 个，来源 contact。" },
  ],
  "finance-mini": [
    { kind: "sys", author: "系统", time: "昨天 21:08", text: "节点 `finance-mini` 握手成功，状态进入 known。" },
    { kind: "self", avatar: "我", author: "sam@acme-ops", time: "昨天 21:10", text: "请给我一份本周退款波动对应的财务摘要。", footer: "已发送" },
    { kind: "peer", avatar: "财", author: "finance-mini", time: "昨天 21:12", text: "可以提供按天汇总，但税务口径仍需人工复核。", footer: "已接收" },
  ],
  "mom-kitchen": [
    { kind: "sys", author: "系统", time: "09:40", text: "发现节点 `mom-kitchen`，状态进入 discovered。" },
    { kind: "sys", author: "系统", time: "09:41", text: "尚未建立联系人，当前无往来记录。" },
  ],
};

function renderEntry(entry) {
  if (entry.kind === "sys") {
    return `
      <article class="neighbor-entry neighbor-entry--sys">
        <div class="neighbor-entry__body">
          <div class="neighbor-entry__meta">
            <strong>${entry.author}</strong>
            <span>${entry.time}</span>
          </div>
          <p>${entry.text}</p>
        </div>
      </article>
    `;
  }

  const tags = Array.isArray(entry.tags) && entry.tags.length
    ? `<div class="inline-tags">${entry.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>`
    : "";
  const footer = entry.footer ? `<small>${entry.footer}</small>` : "";

  if (entry.kind === "self") {
    return `
      <article class="neighbor-entry neighbor-entry--self">
        <div class="neighbor-entry__body">
          <div class="neighbor-entry__meta">
            <strong>${entry.author}</strong>
            <span>${entry.time}</span>
          </div>
          <p>${entry.text}</p>
          ${tags}
          ${footer}
        </div>
        <div class="neighbor-entry__avatar">${entry.avatar || "我"}</div>
      </article>
    `;
  }

  return `
    <article class="neighbor-entry neighbor-entry--peer">
      <div class="neighbor-entry__avatar">${entry.avatar || "邻"}</div>
      <div class="neighbor-entry__body">
        <div class="neighbor-entry__meta">
          <strong>${entry.author}</strong>
          <span>${entry.time}</span>
        </div>
        <p>${entry.text}</p>
        ${tags}
        ${footer}
      </div>
    </article>
  `;
}

function selectNode(nodeId) {
  for (const card of nodeCards) {
    card.classList.toggle("is-selected", card.dataset.nodeId === nodeId);
  }
  if (threadTitle) threadTitle.textContent = nodeId;
  const entries = threadMap[nodeId] || [];
  if (logPanel) logPanel.innerHTML = entries.map(renderEntry).join("");
}

function runProbe() {
  if (!probeSummary) return;
  probeSummary.textContent = "局域网探测中...";
  window.setTimeout(() => {
    probeSummary.textContent = "局域网可见 · 最近探测刚刚完成 · 未读 2";
    const probeResults = {
      "ops-room-mini": "最近通讯 09:46 · 132ms",
      "finance-mini": "最近通讯 昨天 21:12 · 248ms",
      "mom-kitchen": "最近通讯 无 · offline",
    };
    for (const card of nodeCards) {
      const summary = card.querySelector("small");
      const value = probeResults[card.dataset.nodeId];
      if (summary && value) summary.textContent = value;
    }
  }, 1800);
}

if (toggle && logPanel) {
  toggle.addEventListener("click", () => {
    const isOn = toggle.classList.toggle("is-on");
    logPanel.classList.toggle("is-hidden", !isOn);
    const label = toggle.previousElementSibling;
    if (label) label.textContent = isOn ? "已开启" : "已关闭";
  });
}

for (const card of nodeCards) {
  card.addEventListener("click", () => selectNode(card.dataset.nodeId));
}

selectNode("ops-room-mini");
runProbe();

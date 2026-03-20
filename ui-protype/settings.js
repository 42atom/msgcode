const navItems = document.querySelectorAll("[data-view]");
const panels = document.querySelectorAll("[data-view-panel]");
const viewTitle = document.getElementById("view-title");
const capabilityProbeButton = document.getElementById("capability-probe");
const capabilityMetas = document.querySelectorAll("[data-capability-meta]");

const titles = {
  organization: "我的资料",
  general: "软件设置",
  doctor: "诊断",
  brain: "大脑模型",
  vision: "视觉模型",
  tts: "语音输出",
  asr: "听觉识别",
  image: "画图模型",
  video: "视频模型",
  music: "音乐模型",
  search: "联网搜索",
};

for (const item of navItems) {
  item.addEventListener("click", () => {
    const target = item.dataset.view;
    for (const current of navItems) current.classList.toggle("is-active", current === item);
    for (const panel of panels) panel.classList.toggle("view--active", panel.dataset.viewPanel === target);
    if (target && titles[target]) viewTitle.textContent = titles[target];
  });
}

if (capabilityProbeButton) {
  capabilityProbeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (capabilityProbeButton.disabled) return;
    capabilityProbeButton.disabled = true;
    capabilityProbeButton.textContent = "⚡ 测试中...";

    window.setTimeout(() => {
      const hidden = Array.from(capabilityMetas).every((node) => node.classList.contains("is-hidden"));
      for (const meta of capabilityMetas) meta.classList.toggle("is-hidden", !hidden);
      capabilityProbeButton.disabled = false;
      capabilityProbeButton.textContent = "⚡ 连接测试";
    }, 2000);
  });
}

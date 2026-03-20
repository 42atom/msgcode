const navItems = document.querySelectorAll("[data-view]");
const panels = document.querySelectorAll("[data-view-panel]");
const viewTitle = document.getElementById("view-title");

const titles = {
  projects: "项目级 Agent 工作入口",
  base: "可安装基座与能力包",
  neighbor: "邻居与异步协作",
};

for (const item of navItems) {
  item.addEventListener("click", () => {
    const target = item.dataset.view;
    for (const current of navItems) current.classList.toggle("is-active", current === item);
    for (const panel of panels) panel.classList.toggle("view--active", panel.dataset.viewPanel === target);
    if (target && titles[target]) viewTitle.textContent = titles[target];
  });
}

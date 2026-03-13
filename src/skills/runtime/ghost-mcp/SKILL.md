---
name: Ghost MCP
description: ghost-os 桌面 computer-use 说明书。msgcode 直接暴露 `ghost_*` 原生工具；先读外部真相源 GHOST-MCP，再按本文的本地安装、探测和失败口径执行。
---

# Ghost MCP

## 真相源

- 主体说明书：`/Users/admin/GitProjects/GithubDown/ghost-os/GHOST-MCP.md`
- 本地日志：`/Users/admin/.config/msgcode/log`

先读 `GHOST-MCP.md`，它定义了 `ghost_*` 工具的用法、失败路径和桌面操作规则。本文只补 msgcode 本地接入口径，不重写 provider 文档。

## 能力

- msgcode 已直接暴露 `ghost_*` 原生工具给 Agent
- 主链固定为：`模型 -> ghost_* -> ghost mcp -> 真实结果 -> 模型`
- 不走长期 `desktop.* -> ghost_*` 翻译层

## 何时使用

- 需要在 macOS 原生 App 或 Web App 上做桌面操作
- 需要 AX 树 + 截图 + 视觉 grounding 的组合能力
- 需要复用 ghost-os 已有 recipes，而不是重复手搓多步脚本

## msgcode 本地口径

### 安装与健康检查

```bash
brew install ghostwright/ghost-os/ghost-os
ghost setup
ghost doctor
ghost status
```

- msgcode 不会静默代装 `ghost-os`
- `ghost` 缺失时，`ghost_*` 工具会直接返回缺失事实和安装指引
- `ghost status` 未 ready 时，msgcode 会补跑一次 `ghost doctor`，把最小诊断事实回给模型

### 使用顺序

1. 多步骤任务先 `ghost_recipes`
2. 手工操作前先 `ghost_context`
3. Web 场景优先 `dom_id`
4. 找不到元素或状态不清时，先 `ghost_annotate`
5. 还不清楚就 `ghost_screenshot`
6. Web/视觉退化场景再 `ghost_ground`

### Web 场景

- Chrome / Electron 场景优先 `dom_id`
- `ghost_find` 找不到按钮时，不要死磕同一个 query
- 优先：
  - `ghost_context`
  - `ghost_find`（优先 `dom_id`）
  - `ghost_annotate`
  - `ghost_screenshot`
  - `ghost_ground`

### 失败处理

- 不要重复同一步 5 次
- 失败先看：
  - 当前上下文是否变了：`ghost_context`
  - 可点击坐标是否清楚：`ghost_annotate`
  - 视觉状态是否一致：`ghost_screenshot`
  - 是否需要视觉定位：`ghost_ground`

## 边界

- `ghost-os` 是外部 provider，不是 msgcode core
- 不要把 `ghost setup/doctor` 的业务逻辑搬进 msgcode
- 不要发明新的 desktop manager / plugin platform / supervisor
- 若高危动作未来需要 token，只允许收口在 `ghost-mcp-client`，不上升为总线级审批层

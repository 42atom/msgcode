---
name: Ghost MCP
description: ghost-os 桌面 computer-use 说明书。msgcode 直接暴露 `ghost_*` 原生工具；先读外部真相源 GHOST-MCP，再按本文的本地安装、探测和失败口径执行。
---

# Ghost MCP

## Web 使用优先级（先记住这条）

网页内容获取（抓文本、点普通按钮、表单填写、页面跳转）默认**不要**上 `ghost_*`。

- **优先**：`browser`（更快、更稳定、可复现）
- **仅当** `browser` 明显受阻（强反爬/复杂交互/页面被遮罩/DOM 不可达/需要原生系统弹窗）才降级用 `ghost_*`

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

### 最佳实践（必须照做）

- **先 recipes 再手工**：多步骤任务先问 `ghost_recipes`，能 `ghost_run` 就不要手搓流程。
- **先 context 再动作**：任何 click/type/press/drag/hotkey 之前先 `ghost_context`，确认前台 app、窗口与焦点元素都对。
- **Web 优先稳定锚点**：Web 场景优先 `dom_id`；原生 App 优先 `identifier`；不要长期依赖模糊 `query`。
- **焦点与 app 参数**：需要 focus 的动作（尤其 hotkey/press/scroll/drag）尽量传 `app`，避免对错窗口执行。
- **等待条件**：页面加载期先 `ghost_wait` 等“输入行/按钮可交互”再继续；不要边加载边疯狂 find。
- **不要重复试探**：同一目标 `ghost_find` 最多 3 次，超出就换策略（annotate/screenshot/ground）或停下向用户确认状态。
- **ground 必须具体**：`ghost_ground` 的 `description` 要写清“是什么 + 在哪 + 旁边锚点”，并尽量传 `crop_box` 提速与降误判。

### 两个最常见的失败点（必须记住）

#### `ghost_screenshot`（截图）

- **前置条件**：`ghost status` 必须是 `Status: Ready`；Screen Recording 必须已授权。
- **参数建议**：
  - `app`: 尽量传目标应用名（例如 `"Safari"`），避免截到别的窗口。
  - `full_resolution`: 默认 `false`；除非你需要看清小字再开 `true`。
- **失败时**：
  - 不要编造“工具没注册/没暴露”。先调用 `ghost_state`，把返回事实贴出来。
  - 再调用 `ghost_context` 确认前台应用与焦点窗口是否真是目标 app。
  - 仍失败就把 **原始错误**原样回传（不要系统代答式解释）。

#### `ghost_ground`（视觉定位）

- **必填参数**：`description` **必须提供**。不传就会失败。
- **前置条件**：优先先 `ghost_context`，把目标 app 拉到前台；否则 grounding 可能对错窗口做推理。
- **写 `description` 的标准**（越具体越好）：
  - “它是什么”：按钮/输入框/菜单项/图标/某行表达式
  - “它在哪”：左侧栏/顶部/某个面板/某行（例如 “Expression 1 输入行”）
  - “它旁边有什么可见锚点”：文本标签、占位符、相邻按钮文案
- **参数建议**：
  - `app`: 传 `"Safari"` / `"Terminal"` 等，减少误定位。
  - `crop_box`: 只要你能估出大概区域，就传，能显著提速并减少误判。
- **调用预算**：
  - 同一目标最多调用 `ghost_ground` 1-2 次。超过就停下让用户确认页面状态，不要死磕。

### 进程与内存（不要教模型“释放进程”）

- **不需要你手动释放**：msgcode 调 `ghost_*` 时不会要求你去管理 `ghost mcp` 常驻进程；每次调用都会按需启动并在调用结束后退出。
- **vision sidecar 可能短暂常驻**：`ghost_ground` 会用到 `ghost-vision` sidecar；它会在需要时启动，并在空闲约 600 秒后自动退出。
- **做法**：默认忽略，不要在任务里插入“kill 进程/清内存”这种多余动作；只有在用户明确要求排障或内存压力时，才提 `ghost doctor` 看状态。

### 高风险动作

- `ghost_*` 能力面保持完整；msgcode 不为它额外加 confirm gate
- 你需要防的不是“点歪了”，而是“做错了但做得极准”
- 一旦高风险动作判断错误，后果不是小失误，而是立刻造成不可逆损害
- 典型灾难包括：
  - 你精准点击了“删除 / 清空 / 格式化 / 退出登录 / 关闭安全设置”
  - 你精准执行了“发送 / 提交 / 回复 / 发布 / 支付 / 下单”
  - 你精准把破坏性命令输入进终端，再精准按下回车
- 所以规则很硬：
  - 只读、截图、标注、定位、观察类动作，直接做
  - 一旦进入高风险语义，先向用户确认，不要自己替用户做主
  - 不要用“我已经很确定元素没找错”给自己开脱；点得准不等于做得对
  - 如果你主观上已经开始替用户补完意图，立刻停下，先问
- 典型高风险动作包括：
  - 发送、提交、回复、发布、支付、下单
  - 删除、覆盖、清空、格式化、退出登录、关闭安全设置
  - 在终端或系统输入框里输入破坏性命令

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
- 不要把“高风险动作先问用户”实现成新的系统 gate、审批层或 supervisor
- 先用说明书约束模型；不要因为风险焦虑回流执行层拦截
- 这个 skill 的目标不是缩手缩脚,而是在保留完整电脑能力的前提下,强迫你在高风险语义上保持清醒

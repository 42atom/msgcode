# Desktop Automation Plan（v2.2）

> 一句话：不做 per-app 适配；走 macOS 通用可访问性（AX）+ 截图 + 动作原语；用一个 **menubar 宿主 App** 持有 TCC 权限，并通过本地 **Bridge** 把后台 agent/CLI 安全接入。

## 0) 背景与问题（为什么要做）

我们要的是“统一 GUI 操作能力”，而不是“给每个 App 写集成”：
- **跨 App**：Messages / Safari / Settings / Finder / 任意第三方 App。
- **可后台化**：agent/daemon 不应该负责弹系统授权 UI。
- **可审计**：每次动作可复盘（截图/元素树/计划/日志）。

现实冲突点：
- macOS 的 **TCC** 管 Screen Recording / Accessibility 权限。
- 后台进程（daemon/CLI）触发授权 UI 不可靠，也不适合在任意时机弹系统设置。

## 1) 方案总览（OpenClaw/Peekaboo 模式抽象）

### 1.1 核心结论

把 GUI 自动化拆成三层：
1. **Desktop Primitives（系统级原语）**：AX 枚举 + 截图 + click/type/scroll/hotkey/menu/wait
2. **Permission Host（带 UI 的权限宿主）**：负责拿到并“稳定持有” TCC 权限
3. **Bridge（本地代理/经纪人）**：后台 agent/CLI 只通过 Bridge 发请求，不直接触碰 TCC

### 1.2 角色分工（Host/Client 解耦）

- `msgcode-desktop-host.app`（menubar）
  - 拿权限：Accessibility + Screen Recording
  - 起本地服务：`UNIX socket` 或 `XPC`
  - 执行 Desktop Primitives
  - 输出结构化结果 + 证据文件（截图/元素树）

- `msgcode`（CLI/daemon）
  - 负责：计划、策略、循环（agent loop）
  - 不负责：拿权限、直接执行 AX/截图
  - 只负责调用：Bridge RPC

## 2) 能力定义（Desktop Primitives）

最小原语集（先做这些，避免复杂度爆炸）：
- `capture_screen`：截图（含显示器/窗口范围）
- `dump_ax_tree`：枚举 UI 元素树（bounded traversal）
- `click`：点击（坐标/元素引用）
- `type_text`：输入文本（可选：按键序列）
- `scroll`：滚动（方向/距离/次数）
- `hotkey`：快捷键（如 `cmd+l`）
- `menu_pick`：菜单选择（路径：`App > File > Export...`）
- `wait_until`：等待条件（元素出现/文案匹配/窗口标题变化），带硬超时

### 2.0 共同类型：Route / Selector / ElementRef（统一的“定位语言”）

如果没有一套稳定的“定位契约”，所谓“统一”会被定位问题拖垮。因此原语需要共享三类输入/输出类型：

#### Route（路由，一等公民）

每个动作必须显式指定“目标上下文”，避免误点/误发：
- `app`: `{ bundleId? | pid? }`
- `window`: `{ windowId? | titlePattern? }`（由 Host 分配/解析）
- `display`: `{ displayId? }`（多显示器时强制）
- `focusPolicy`: `requireFocused | focusIfNeeded | failIfNotFocused`

#### Selector（选择器，多策略匹配 + 评分排序）

输入允许同时给多条策略，让 Host 在当前快照内“找最像的那个”：
- `byRole`: `AXButton/AXTextField/...`
- `byTitle/label/value`: `equals | contains | regex`
- `byIdentifier`:（若目标提供）
- `byPath`: 从 window root 到 child 的索引路径（不稳定但可兜底）
- `byRect`: 限定区域（为 pixels/坐标兜底提供边界）
- `near`: 靠近某个锚点元素（相对布局稳定时很强）

输出应记录：
- 候选列表与评分（用于复盘“为什么选了它”）
- 选中原因（最小可解释性）

#### ElementRef（元素引用，可短期复用且可检测 stale）

动作执行时，目标可由 selector 解析成 elementRef，再执行：
- `elementId`: 本快照内稳定 ID（由 Host 生成）
- `fingerprint`: `role + label/title + rect + subtreeHash`（用于 stale 校验）
- `rect`: 屏幕坐标 rect（用于证据一致性与像素兜底）

动作请求统一支持两种 target：
- `target: { elementRef }`
- `target: { selector }`（Host 解析成 elementRef）

### 2.1 观测模型：AX + Pixels（两条腿走路）

桌面 App 的 UI 不是都“可访问”：
- **能用 AX 就用 AX**：结构化、可定位、对分辨率/窗口位置不敏感。
- **AX 不够时用截图兜底**：画布/时间线/自绘控件常见“无语义”，需要回到 pixels。

因此基础能力必须同时具备：
- 结构化观测：`dump_ax_tree`
- 像素观测：`capture_screen`

### 2.2 动作分层：稳定优先，兜底可控

动作执行按稳定性从高到低分层（同一条 plan 内允许混用）：
1. **元素级动作**：基于 AX 元素引用/属性定位后 click/type/menu
2. **语义动作**：`menu_pick` / `hotkey`（更像“命令”，比点坐标更稳）
3. **坐标兜底**：当且仅当无法获得稳定语义定位时启用，并强制截图取证（before/after）

### 2.3 自然语言接入：NL → Plan → Run

自然语言只是输入；系统的单一真相源是 **Plan（可审计的结构化动作序列）**：
- `plan`：描述要做什么、怎么定位、每步证据点、预期变化与失败策略
- `run`：严格按 plan 执行；不可逆动作必须显式 `confirm`

### 2.4 原子观测：observe（截图 + AX + 路由信息同一时刻对齐）

证据要可复盘，关键在“同一时刻”：
- 仅有截图或仅有 AX 树，都可能在时间上漂移
- 需要一个组合型观测原语，保证截图与 AX 快照对齐

建议新增原语：
- `observe`: `{ screenshot, axSnapshot, focusedWindowInfo, frontmostAppInfo, cursorInfo? }`

所有原语统一约束：
- **JSON-first**：请求/响应为结构化 Envelope（便于 agent 稳定解析）
- **证据优先**：每次执行可选落盘 `before/after` 截图 + AX 快照
- **可控副作用**：默认 read-only；副作用动作要求显式 `confirm`

## 3) Bridge（IPC 与安全）

### 3.1 IPC 选型（两条路线，后续择一落地）

- 方案 A：`XPC`
  - 优点：macOS 原生；与签名/沙盒契合；权限语义更顺
  - 缺点：跨语言成本略高（但可封装）

- 方案 B：`UNIX domain socket + JSON-RPC`
  - 优点：跨语言调试最友好；日志与抓包直观
  - 缺点：需要自己做鉴权与连接管理

### 3.2 安全基线（必须）

- **本地-only**：只监听本机（socket path / XPC service），禁止网络端口暴露
- **调用方校验**：校验 client 代码签名/TeamID（allowlist）
- **对等身份获取**：XPC 可直接拿到 peer identity；UNIX socket 必须获取 peer pid 并据此做 codesign 校验（否则 allowlist 落不住）
- **重放防护（建议）**：每请求 nonce + 过期窗口（本地也值得做，避免被同机恶意复用旧请求）
- **硬超时**：wall-clock timeout，超时即中断并返回错误码
- **拒绝弹窗**：缺权限时只返回明确错误码，不尝试“代用户点击系统设置”

## 4) 可靠性机制（为 agent loop 设计）

### 4.1 Snapshot 模型（短期内存态）

原则：**每次请求尽量自洽、短生命周期**，避免长 session 卡死。
- `snapshotId`（可选）：短时间复用的上下文（同一窗口/同一 AX 根节点）
- 过期策略：TTL + 最大复用次数（防止 stale state）

### 4.2 Bounded AX Traversal（防卡死）

`dump_ax_tree` 强制边界：
- `maxDepth`
- `maxNodes`
- `maxWallTimeMs`
- `includeText`（默认关，避免泄漏与性能问题）

#### 4.2.1 文本读取与脱敏（默认最小泄漏）

AX dump 很容易把聊天/邮件等正文带出来；默认应严格最小化：
- `dump_ax_tree` 默认只返回结构与少量 metadata（role、rect、可点击/可聚焦、少量 title/label）
- 文本读取变成单独原语：`read_text(selector, limitBytes, redactionMode)`
- 对 secure/password 字段：默认拒绝读取；写入也建议 require `confirm`

### 4.3 证据包（可审计/可复盘）

建议结构（以 `requestId` 作为主键）：

```
<workspace>/
└── artifacts/
    └── desktop/
        └── YYYY-MM-DD/
            └── <requestId>/
                ├── env.json
                ├── request.json
                ├── response.json
                ├── ax/
                │   └── 001_dump_ax_tree.json
                ├── screenshots/
                │   ├── 001_before.png
                │   └── 002_after.png
                ├── selectors/
                │   └── 001_candidates.json
                └── summary.md
```

建议最小 `env.json` 字段（用于复盘与复现）：
- macOS 版本、分辨率/缩放比例、输入法信息（若可得）
- frontmost app、目标 window rect、display rect

### 4.4 急停与中断（避免跑偏）

桌面自动化一旦跑偏，代价很高（误点/误删/误发）。基础能力必须支持：
- **硬超时**：每请求 wall-clock timeout
- **可中断**：Host 能立即中止当前动作链并返回明确错误码
- **急停入口**：至少提供一个“立即停止所有自动化”的入口（Host UI 操作/CLI 命令）

### 4.5 Single-flight 执行与 Abort 语义（可测试、可证明）

为避免 AX/焦点互相踩踏，Host 应采用单飞队列：
- 同一时刻只允许一个 action chain 在执行（single-flight）
- 运行时返回 `executionId`，用于查询/中止

Abort 语义（必须明确）：
- 立即中断当前链路（不再注入键鼠事件）
- 中断后不继续执行队列中的后续步骤
- 返回 `DESKTOP_ABORTED`，并写入证据包摘要

## 5) CLI 契约（建议并入 msgcode CLI Contract）

建议新增一组错误码（示例）：
- `DESKTOP_HOST_NOT_RUNNING`
- `DESKTOP_PERMISSION_MISSING`
- `DESKTOP_AX_TRAVERSAL_LIMIT`
- `DESKTOP_TIMEOUT`
- `DESKTOP_ELEMENT_NOT_FOUND`
- `DESKTOP_CONFIRM_REQUIRED`
- `DESKTOP_ABORTED`
- `DESKTOP_MODAL_BLOCKING`
- `DESKTOP_FOCUS_LOST`
- `DESKTOP_STALE_SNAPSHOT`

错误对象建议带：
- `retryable: boolean`
- `details`（例如当前 frontmost app/window，便于策略层决定“重试/重新 observe/先处理 modal”）

## 6) 最小落地路径（按里程碑）

### M1：Host + Bridge 起跑（P0）
- menubar App（宿主）可启动/退出，展示权限状态
- Bridge RPC 可用（A: XPC / B: UNIX socket 二选一）
- 支持 `observe`（截图 + AX + 路由信息对齐）与有界遍历
- 增加调试原语：`find(selector) -> elementRef[]`（必要时再加 `highlight`）

### M2：动作原语闭环（P0+）
- `click/type_text/hotkey/wait_until` 最小闭环
- requestId 串起：请求→动作→证据→结构化返回

### M3：安全与策略（P1）
- TeamID allowlist + 拒绝未签名/未知调用方
- 全部动作硬超时 + 中断语义明确
- `confirm` 机制（对副作用动作要求显式确认短语）

### M4：可维护性（P1）
- 诊断命令：`msgcode desktop doctor --json`
- 自检：权限缺失/Host 未运行/AX 被禁用的错误口径一致

## 7) 风险与对策（只列最重要的）

1) **权限链不稳定**：用户忘了给 Screen Recording/Accessibility
   - 对策：Host menubar 常驻显示红/黄/绿状态 + 一键跳转系统设置（只做引导，不代操作）

2) **AX 不一致/元素树巨大**：导致卡死或定位不准
   - 对策：bounded traversal + 多策略定位（role/title/label/path）+ 必要时回退到坐标点击（但必须截图取证）

3) **安全边界被打穿**：任意本地进程调用 Bridge
   - 对策：TeamID allowlist + 最小权限 + 本地-only + 审计日志落盘

## 8) 与现有能力的关系（避免重复造轮子）

- `AIDOCS/msgcode-2.1/browser_automation_spec_v2.1.md`：解决“浏览器内”的语义快照 + 两段式提交 + 证据包。
- 本 v2.2：解决“桌面级”（跨 App）的统一能力与 TCC 权限宿主/桥接问题。

## 9) 附录：参考案例（仅作启发，不作依赖）

本节只用于“校准直觉/复用模式”，不意味着实现必须绑定某个项目或工具。

### A) 权限宿主 + 本地 Bridge 模式（macOS）

当目标是“后台 agent 稳定调用 Screen Recording / Accessibility”时，常见做法是：
- 用一个带 UI、可签名的 App 作为 **TCC 权限宿主**
- 通过本地 `XPC/UNIX socket` 把能力暴露给无权限的 CLI/daemon
- 在 Bridge 层做调用方校验（代码签名/TeamID allowlist）与硬超时

这一模式在 OpenClaw/Peekaboo 语境下被系统化实践过，但我们只复用“模式”，不绑定其实现细节。

### B) 分层执行器（稳定性优先）

针对“真实桌面 App 不可预测”的工程现实，常见建议是：
1. 能走系统/可脚本化接口就走接口（若存在）
2. 走 UI Scripting / Accessibility 元素级动作
3. 最后才用坐标/按键注入兜底（并强制证据与确认）

### C) Human-in-the-loop（不可逆动作）

对于不可逆动作（发送/发布/覆盖保存/导出覆盖），实践上通常强制：
- `prepare` 阶段只到“就绪态”（草稿/预览/定位正确）
- `run --confirm` 才允许执行最后一步
- 记录证据包，支持回放与审计

### D) 快捷键优先（Hotkey-first）

当目标操作存在稳定快捷键或菜单路径时：
- 优先用 `hotkey/menu_pick` 表达“命令式动作”，减少坐标点击
- 以 `wait_until` + 证据点确认状态变化（而不是假设成功）

### E) 文件对话框与导出（Open/Save/Export）

桌面自动化里最常见的“高风险不可逆”之一是导出/覆盖：
- 将 `open/save/export` 视为高风险动作，默认 require `confirm`
- 把“目标路径/文件名/覆盖行为”写入 plan，并强制证据（对话框截图/结果文件落盘）

### F) 剪贴板缓冲（Clipboard Staging）

把“写入目标 App”的副作用延后：
- 先把内容落到剪贴板/草稿区（read-only/local-write）
- 最后一步才执行粘贴/发送/提交（browser-act/desktop-act）

### G) 弹窗与模态（Modal/Notification Handling）

弹窗/模态是桌面自动化的“剧情反转点”：
- 将 modal 识别与处理纳入 plan（`wait_until` + 退出策略）
- 支持 `abort` 与明确错误码，避免无限等待或误点

### H) 多窗口/多显示器（Window & Display Routing）

“发错窗口/点错屏幕”是最高频事故源：
- 先识别目标 app/window/display，再执行动作
- 将窗口选择/前台切换写入 plan，并在证据包中保留关键截图

### I) 自绘控件与画布（AX 不完整时的 Pixels 兜底）

当 AX 缺失或不稳定时：
- 允许降级到 pixels（截图定位/坐标点击），但必须是“最后兜底”
- 兜底步骤强制 before/after 截图，并记录分辨率/窗口位置（可复现）

### J) 长流程可恢复（Checkpoint & Resume）

把长流程拆成可重入步骤：
- 每步落盘状态与证据（checkpoint）
- 失败时从最近 checkpoint 继续，而不是重跑全链路

### K) 动作白名单（Action Allowlist）

把“允许做什么”做成策略输入，而不是靠 prompt 约束：
- 默认只开 read-only/local-write
- 对 `desktop-act` 的高风险动作单独 gate（confirm + allowlist）

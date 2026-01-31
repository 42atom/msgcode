# msgcode 2.0（方案 B）功能设想评估：账号分离 + 命令控制面 + 文件链接 + 定时任务 + 公网发布

更新时间：2026-01-28

## 目标
把 msgcode 2.0 做成“用户手动建群后，在群里一条命令完成绑定目录；随后收发/跑任务/发布成果”的控制面产品。

## 前提（你已给出的约束）
1. 用户与 agent 的 iMessage 账号分离（你愿意提供额外账号用于组群）。
2. 文件交付优先：始终返回 `share/`（可分享目录）中的链接（依赖 Pinme/OneDrive 或局域网）。
3. 用户发送的文档要被完整跟踪并可交给 agent 使用。
4. 不使用 Cloudflare；发布通道改为 Pinme（静态网页）+ OneDrive（工作成果文件）。

## 可行性结论（关键点先说清）

### A) `/newchat` 自动创建群聊：**可行，但不靠 `imsg rpc send` 本身**
`imsg rpc send` 只能“发给已存在的 chat（chat_id/chat_guid/chat_identifier）或单人 to”，并不提供“按 participants 新建群”的 RPC。

**但** macOS Messages 的 AppleScript 字典显示：
- `chat` 对象存在，并且 `participants` 说明里明确提到“可在创建时指定”。（系统自带脚本定义可见）

因此 2.0 的正确形态是：
- **创建群聊用 AppleScript（make new chat with participants）**
- 创建完成后获得 `chat.id`（这是 guid），把它作为 `chat_guid` 交给 `imsg rpc` 的发送通道
- 后续收/发主链路仍然是 `imsg rpc`（watch + send），不要把 AppleScript 扩散到主链路以外

> 但：为降低权限/GUI 依赖与复杂度，msgcode 2.0 **默认不做自动建群**。推荐方案：
> - 用户手动建群（Messages UI）
> - 群内 `/bind <dir>` 完成绑定与落盘

### B) 发文件：`imsg` 支持附件发送（可行性高）
`imsg` 的发送实现会在 AppleScript 里对 chat 或 buddy 执行 `send theFile to ...`，且 RPC `send` 支持 `file` 参数。

仍需验证（落地前的必测项）：
- 对“群聊 chat_guid”发送附件是否稳定（Automation 权限、路径权限、文件大小限制、重复发送行为）。

### C) “始终返回 share 链接”：**可行，但必须先定安全边界**
把分享交给托管方（Pinme/OneDrive）能显著降低我们自建公网入口的风险，但仍需要约束：
- 只允许发布 workspace 下的 `share/` 目录（只读语义）
- 链接应可撤销；默认不要“任何人可访问”（优先“仅指定人/组织”或“仅持有链接且可撤销”）

### D) 定时任务 + 主动推送：可行（建议做成 Job 系统）
核心是把“定时执行 + 输出推送”从 iMessage listener 主循环里剥离出来，做独立 Job runner（可观测、可暂停、可审计）。

### E) 语音/媒体：msgcode 只做“落盘 + 转发”
语音消息等同“音频附件”。msgcode 只负责：
- 可靠落盘到 workspace（`inbound/`）
- 发布/上传后返回可访问链接（Pinme/OneDrive/local）
- 把链接与元数据转发给 agent/用户
不负责转写（ASR）或语音合成（TTS）；这些由 agent 的 skill 实现。

## 功能设计（最小可用版本）

### 1) 账号分离与权限模型（MVP 必做）
- `ownerAllowFrom`: 只允许 owner（你的用户账号）在 DM 里控制 agent。
- `groupAdminAllowFrom`: 用于群内命令（可选，默认 disabled）。
- agent 运行在“专用 macOS 用户 + 专用 Apple ID”下，减少隐私与误操作风险。

### 2) `/newchat`（自动化版本，允许失败降级）
流程（推荐）：
1. 在 DM 中 `/newchat <projectName?>`
2. bot 询问/确认 workspace 目录（未指定则创建新目录）
3. bot 询问参与者列表（默认：owner + 你提供的额外账号/新人账号）
4. bot 运行 AppleScript：
   - 选择 iMessage service
   - 获取 buddies（参与者）
   - `make new chat with properties {participants: {...}}`
   - 发一条握手消息（含随机 nonce，方便后续匹配）
   - 返回 `id of chat`（chat guid）
5. bot 记录路由：`chat_guid -> workspace`，并把群聊命名/标签写入自己的 store

失败降级（必须有，否则 2.0 会被权限弹窗/GUI 状态击穿）：
- AppleScript 失败 → bot 发“手动建群指引” + `/bind` 命令，让用户把 bot 拉进群后绑定。

重要备注：
- Messages 的 `chat.name` 是只读；“改群名”很可能只能靠用户手动改。2.0 里可以用“我们自己的 label”。

### 3) `/chatlist`
- 来源：我们自己的 route store（不是临时扫 env）
- 输出：群 label、chat_guid、workspace、最后活跃、发布链接（如果已启用 tunnel）

### 4) 文件：统一“落盘→公开链接→iMessage 返回”
约束（你想要的“总是链接”）：
- 所有交付物写入 `<workspace>/public/`
- iMessage 只回一个 URL（必要时附上文件名/大小/sha256）

> 注：2.0 不建议叫 `public/`，更推荐 `share/`（语义更明确，避免用户误以为是公网目录）。

用户→bot 的附件：
- inbound 附件落到 `<workspace>/inbound/`
- 同步复制/导出到 `<workspace>/public/inbound/<timestamp>-<name>`（或只给 owner 可见的链接）
- 把本地路径注入 agent 执行上下文（让 agent 能读文件）

### 5) 定时任务（Jobs）
建议命令：
- `/job add <name>` → 交互式询问：schedule、command/script、target（DM/群）、workspace、是否发布到 public
- `/job list` `/job disable` `/job run <name>`

安全建议（2.0 必须）：
- 默认只允许跑 workspace 内的脚本，或使用 allowlist（禁止任意 shell）
- 记录每次执行：开始/结束/退出码/输出摘要/产物链接

### 6) 发布后端（Pinme + OneDrive）
建议模型：
- 静态网页：发布到 Pinme（需要确认其 API/CLI 能力与“更新/回滚/私密性”）
- 工作成果文件：上传到 OneDrive 并返回分享链接（可撤销/可控）

## 风险清单（需要你确认接受度）
1. **自动建群依赖 GUI Session + Automation 权限**：如果机器是无 UI 的后台态（未登录桌面），AppleScript 可能失败。
2. **群名不可编程设置**：多半只能用我们自己的 label。
3. **长期公网子域名**：必须有访问控制，否则等价于公网暴露文件。

## 你需要补充的 3 个决策
1. 你提供的“额外账号”是：固定一个第三人账号，还是每次 /newchat 可选？
2. Pinme 是否支持“私密/仅持有链接可访问/可撤销”？（需要调研）
3. OneDrive 分享链接策略：允许“仅你”还是“任何持链接”？是否需要自动过期？

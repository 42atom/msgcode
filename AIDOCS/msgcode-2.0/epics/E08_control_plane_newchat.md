# E08: 控制面（DM 命令）+ 自动建群 `/newchat` + `/chatlist`

## Goal
用户只需和 agent 私聊下命令，即可自动创建群聊并绑定 workspace，形成“群=项目”的稳定路由。

## Product Intent（单人公司 OS）
- 目标是把 msgcode 作为“一人公司”的项目/客户/事项管理中枢：群聊承载上下文，workspace 承载文件与产物。
- 设计优先级：**效率 > 可追溯 > 最小必要护栏**（不做过度防御/复杂 RBAC）。

## Scope
- owner DM 命令集：`/newchat`、`/chatlist`、`/bind`（降级用）、`/help`
- 自动建群：AppleScript 创建 chat（participants at creation）→ 获取 chat guid → 写入 route store
- 群聊命名：使用“我们的 label”（不依赖 Messages 的 chat.name 可写）

## Non-goals
- 不在此 Epic 内实现 Cloudflare、Jobs、文件系统发布。

## Minimal Data Model（唯一真相源）
RouteStore（建议持久化为一个 JSON/SQLite；v1 可用 JSON）：
- `workspaceId`：稳定主键（UUID）
- `label`：人类可读名称（可选）
- `workspacePath`：本地目录路径
- `chatGuid`：iMessage chat guid（来自 `chat.id`）
- `participants`：创建/绑定时的参与者快照（数组字符串）
- `status`：`pending | bound | paused | archived`
- `createdAt` / `updatedAt`
- `lastSeenRowId`：用于 `watch.subscribe since_rowid` 补洞

> 极简原则：所有其它信息都可以通过 `imsg rpc chats.list` 或运行时探测恢复，不再重复存。

## Tasks
- [ ] 定义 owner allowlist（DM 控制权限）
- [ ] 定义 route store（chat_guid ↔ workspace ↔ label）
- [ ] `/newchat` 交互：projectName、workspaceDir、participants（owner + extra）
- [ ] AppleScript：create chat + send handshake + return chat id
- [ ] 失败降级：输出手动建群指引 + `/bind` 绑定现有群
- [ ] `/chatlist` 输出：label/chat_guid/workspace/lastActive

## Flow（极简但可恢复）

### `/newchat`（自动化，幂等）
1. DM：`/newchat <label?>`
2. bot：询问 workspace 目录（未给则创建 `WORK_ROOT/<date>-<label>` 并生成 `workspaceId`）
3. bot：使用固定新人账号 + owner 账号，调用 AppleScript `make new chat` 创建群
4. bot：向群发送握手消息（含 `nonce`，例如 `msgcode bind <workspaceId> <nonce>`）
5. bot：写入 RouteStore：`status=pending`
6. 群中收到握手回声/确认（或 owner 发送 `/bind <workspaceId>`）：切 `status=bound`

幂等键建议：
- `(workspaceId)`：重复 `/newchat` 不重复创建 workspace
- `(nonce)`：重复发送握手不重复绑定

### `/bind`（兜底）
- 适用：AppleScript 建群失败、或用户手动建群后想绑定到某个 workspace
- 行为：当前群 `chatGuid` + workspaceId → 写入 RouteStore 并置 `bound`

### `/pause` `/archive`（轻量治理）
- `/pause`：停止转发但保留路由
- `/archive`：只读归档（不再写入/不再转发），可用于项目完结

## Minimal Guardrails（不防御化，但防自毁）
- 默认：**只有 owner（DM allowlist）能执行“建群/绑定/发布/创建 job”等高权限动作**。
- 群内命令：可开，但必须“消息 sender 属于 ownerAllowlist”才执行（避免群友误触发）。
- 路径约束：workspace 必须在 `WORK_ROOT` 下（防止误写系统目录）。
- 群名策略：**不依赖程序修改 Messages 的真实群名**（`chat.name` 多为只读且 UI scripting 不稳定）。2.0 以 RouteStore 的 `label` 为准；需要时由用户手动改群名。自动改群名作为 2.1 的 best-effort 增强项。

## Audit（可追溯，服务于一人公司复盘）
每次执行以下动作写一条审计记录（JSONL 即可）：
- `workspace.create`
- `chat.create`（含 participants）
- `route.bind/pause/archive`
- `forward.dispatch`（可选采样）

## Acceptance
- 从 DM 发 `/newchat`，能自动得到一个群聊并完成绑定（或失败时可用 `/bind` 完成）。
- 重启后可恢复：根据 RouteStore + `imsg rpc` 对账，不丢路由、不丢 lastSeenRowId。

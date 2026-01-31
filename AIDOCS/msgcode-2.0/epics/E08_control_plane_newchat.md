# E08: 控制面（群绑定）+ `/bind` + `/where` + `/chatlist`

## Goal
用户手动建群后，在群里用一条命令完成绑定：**群 = 项目/会话，workspace = 落盘目录**，形成稳定路由。

## Product Intent（单人公司 OS）
- 目标是把 msgcode 作为“一人公司”的项目/客户/事项管理中枢：群聊承载上下文，workspace 承载文件与产物。
- 设计优先级：**效率 > 可追溯 > 最小必要护栏**（不做过度防御/复杂 RBAC）。

## Scope
- 群内命令集（MVP）：`/bind`、`/where`、`/unbind`、`/help`
- `chatlist`（可选 DM）：列出已绑定会话
- 路径约束：workspace 必须在 `WORKSPACE_ROOT`（Agent Root）之下
- 群聊命名：使用“我们的 label”（不依赖 Messages 的 chat.name 可写）

## Non-goals
- 不在此 Epic 内实现 Cloudflare、Jobs、文件发布后端（Pinme/OneDrive）。

## Minimal Data Model（唯一真相源）
RouteStore（建议持久化为一个 JSON/SQLite；v1 可用 JSON）：
- `workspaceId`：稳定主键（UUID）
- `label`：人类可读名称（可选）
- `workspacePath`：本地目录路径
- `chatGuid`：iMessage chat guid（主键；如 `any;+;...`）
- `chatId`：iMessage chat rowid（可选缓存；不可迁移，但过滤/补洞更稳）
- `participants`：创建/绑定时的参与者快照（数组字符串）
- `status`：`pending | bound | paused | archived`
- `createdAt` / `updatedAt`
- `lastSeenRowId`：用于 `watch.subscribe since_rowid` 补洞

> 极简原则：所有其它信息都可以通过 `imsg rpc chats.list` 或运行时探测恢复，不再重复存。

## Tasks
- [ ] 定义 owner allowlist（高权限动作执行者）
- [ ] 定义 route store（chat_guid 主键 + chat_id 缓存）
- [ ] `/bind <dir>`：创建/更新绑定（幂等）
- [ ] `/where`：回显当前群绑定的 workspace
- [ ] `/unbind`：解除绑定（软删除或 status=archived/paused）
- [ ] `/chatlist` 输出：label/chat_guid/workspace/lastActive（可选）

## Flow（极简但可恢复）

### `/bind`（主流程，幂等）
0. 用户在 Messages 里手动创建群聊（并把 bot/agent 账号拉进群）。
1. 群里发送：`/bind <dir>`
2. bot 解析 `<dir>`：
   - 只接受相对路径（统一纳入 Agent Root）
   - 最终路径：`WORKSPACE_ROOT/<dir>`
3. bot 创建目录（若不存在），并写入/更新 RouteStore：
   - `chatGuid`（主键） + `workspaceId/label/workspacePath`
   - 可选写入 `chatId`（若当前消息带 chat_id）
4. bot 回复当前绑定状态（`/where` 的内容）

### `/pause` `/archive`（轻量治理）
- `/pause`：停止转发但保留路由
- `/archive`：只读归档（不再写入/不再转发），可用于项目完结

## Minimal Guardrails（不防御化，但防自毁）
- 默认：**只有 owner（DM allowlist）能执行“建群/绑定/发布/创建 job”等高权限动作**。
- 群内命令：可开，但必须“消息 sender 属于 ownerAllowlist”才执行（避免群友误触发）。
- 路径约束：workspace 必须在 `WORKSPACE_ROOT` 下（防止误写系统目录）。
- 群名策略：**不依赖程序修改 Messages 的真实群名**（`chat.name` 多为只读且 UI scripting 不稳定）。2.0 以 RouteStore 的 `label` 为准；需要时由用户手动改群名。自动改群名作为 2.1 的 best-effort 增强项。

## Audit（可追溯，服务于一人公司复盘）
每次执行以下动作写一条审计记录（JSONL 即可）：
- `workspace.create`
- `chat.create`（含 participants）
- `route.bind/pause/archive`
- `forward.dispatch`（可选采样）

## Acceptance
- 用户手动建群后，在群内发 `/bind <dir>` 能完成绑定并立即可用。
- 重启后可恢复：根据 RouteStore + `imsg rpc` 对账，不丢路由、不丢 lastSeenRowId。

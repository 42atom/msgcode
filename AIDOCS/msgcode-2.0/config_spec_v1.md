# msgcode 2.0 配置规格（v1）

目标：把“发布/文件/调度/身份”等能力集中到单一配置入口（`~/.config/msgcode/.env` 或总工作目录下的 config），并支持 per-workspace 覆盖；明确 **不使用 Cloudflare** 作为发布通道（避免长期公网入口的安全风险）。

## 配置层级（建议）
1. 全局：`~/.config/msgcode/.env`（机器级 secrets/账号/token）
2. 总工作目录：`<WORK_ROOT>/.env` 或 `<WORK_ROOT>/msgcode.config.json`（默认策略）
3. workspace：`<workspace>/.env` 或 `<workspace>/msgcode.workspace.json`（仅覆盖必要项）

## 核心字段（草案）

### 身份与权限
- `OWNER_ALLOW_FROM`：允许控制 bot 的用户标识（邮箱/电话），单个或逗号分隔
- `DM_COMMANDS_ENABLED=true|false`
- `GROUP_COMMANDS_ENABLED=true|false`（默认 false）

### 工作目录与路由
- `WORKSPACE_ROOT=/Users/<bot-user>/msgcode-workspaces`（Agent Root；所有 workspace 必须在其子目录下；可自行加一层 `<agent-name>` 做隔离）
- `ROUTE_STORE_PATH=...`（chat_guid/chat_id ↔ workspace ↔ label）

#### 路由主键策略（双键制，单一真相源）
msgcode 2.0 的路由以 **chat_guid 为主键**，chat_id(rowid) 仅作为缓存/补全字段：
- `chatGuid`：主键（稳定、可复制；与现有 `any;+;...` 配置一致）
- `chatId`：辅助字段（本机 chat.db 的 rowid；不可迁移，但过滤/断点续传更稳）

入站路由（Inbound → Route）：
1. 若消息带 `chat_guid`：用它路由
2. 若缺失：回退用 `chat_id`，并通过 `chats.list`/缓存补全 `chat_guid`（写回 RouteStore）

出站发送（Route → Send）：
1. 优先用 `chat_guid` 发送
2. 必要时回退用 `chat_id`（`imsg send` 支持两者）

### iMessage Provider（2.0 唯一）
- `IMSG_PATH=/path/to/our-built/imsg`（强制使用源码构建产物）
- `IMSG_DB_PATH=/Users/<bot-user>/Library/Messages/chat.db`

### Artifact Publisher（文件发布后端）
- `PUBLISH_BACKEND=onedrive|local|pinme|disabled`
- `PUBLISH_SHARE_DIR=share`（默认 share；不建议叫 public）

#### OneDrive（推荐默认后端）
- `ONEDRIVE_MODE=upload`（Graph API 上传）|`sync`（同步文件夹+分享链接）
- `ONEDRIVE_PARENT_ID=...` 或 `ONEDRIVE_SHARE_FOLDER=...`
- `ONEDRIVE_TENANT=...` `ONEDRIVE_CLIENT_ID=...`（如走 OAuth/App）

#### Pinme（待调研）
- `PINME_PROJECT=...`
- `PINME_TOKEN=...`

### Jobs（定时任务）
- `JOBS_ENABLED=true|false`
- `JOBS_STORE_PATH=...`

## 关键安全默认值
- 默认 `PUBLISH_BACKEND=disabled` 或 `onedrive`（不要裸公网）。
- 默认 `GROUP_COMMANDS_ENABLED=false`（只允许 owner DM 控制面）。
- `IMSG_PATH` 必须显式配置，否则拒绝启动 imsg provider（避免误用 brew zip）。

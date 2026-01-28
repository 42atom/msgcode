# msgcode 2.0 配置规格（v1）

目标：把“发布/文件/调度/身份”等能力集中到单一配置入口（`~/.config/msgcode/.env` 或总工作目录下的 config），并支持 per-workspace 覆盖；明确 **不使用 Cloudflare** 作为发布通道（避免长期公网入口的安全风险）。

## 配置层级（建议）
1. 全局：`~/.config/msgcode/.env`（机器级 secrets/账号/token）
2. 总工作目录：`<WORK_ROOT>/.env` 或 `<WORK_ROOT>/msgcode.config.json`（默认策略）
3. workspace：`<workspace>/.env` 或 `<workspace>/msgcode.workspace.json`（仅覆盖必要项）

## 核心字段（草案）

### 身份与权限
- `OWNER_ALLOW_FROM`：允许控制 bot 的用户标识（邮箱/电话），单个或逗号分隔
- `DEFAULT_PARTICIPANT`：固定“新人账号”（用于 `/newchat` 自动建群第三人）
- `DM_COMMANDS_ENABLED=true|false`
- `GROUP_COMMANDS_ENABLED=true|false`（默认 false）

### 工作目录与路由
- `WORK_ROOT=/Users/<bot-user>/msgcode-workspaces`
- `ROUTE_STORE_PATH=...`（chat_guid ↔ workspace ↔ label）

### iMessage Provider（方案 B）
- `IMESSAGE_PROVIDER=imsg`（主）|`sdk`（fallback）
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

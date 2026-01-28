# E09: 产物发布（Artifact Publisher）+ 可配置文件访问（不使用 Cloudflare）

## Goal
所有产物都落到 workspace 的“可分享目录”并自动可访问；iMessage 回复默认返回链接而不是附件；发布通道可配置（Pinme/OneDrive/局域网均可）。

## Scope
- workspace 标准目录：
  - `share/`：可分享目录（默认对外“可访问”但不等于公开）
  - `inbound/`：用户附件落盘
  - `run/`：执行产物
- 发布后端（可插拔）：
  - `local`：仅局域网可访问（例如网关同网段）
  - `pinme`：发布到 Pinme（需确认其 API/CLI 能力）
  - `onedrive`：上传到 OneDrive 并返回分享链接（推荐用于“长期但不公开”的文件）
- 链接策略：按 `workspaceId` 隔离路径；默认“需要鉴权/可撤销”，禁止裸公开。

## Non-goals
- 不做完整文件管理系统（搜索/分享/权限管理）— 只做最小可用。

## Tasks
- [ ] 规范化 workspace 目录结构
- [ ] 定义 `ArtifactPublisher` 接口：`publishFile`/`publishDir`/`revoke`/`status`
- [ ] 本地静态服务器（loopback）+ 路径隔离/防穿越 + workspace 映射
- [ ] 后端 1（优先）：OneDrive 上传 + 返回分享链接（撤销/重置可选）
- [ ] 后端 2（待调研）：Pinme 发布（需要确认 API/CLI）
- [ ] 链接生成：`baseUrl + /w/<workspaceId>/<path>` 或后端返回的 share link

## Acceptance
- 任意 workspace 的 `share/` 文件可被发布并返回链接；bot 回复默认给链接；发布后端由配置选择且可切换。

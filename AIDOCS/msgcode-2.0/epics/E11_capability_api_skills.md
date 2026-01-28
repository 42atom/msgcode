# E11: Capability API + Skills（让 Claude/Codex/OpenCode 可“感知并使用”发布/上传能力）

## Goal
msgcode 2.0 核心只提供“能力”（capabilities）与安全边界，不把 Pinme/OneDrive 的细节硬编码进业务对话；各类 agent 通过统一 API/CLI 调用能力（可做成 skill）。

## 核心原则
- **API-first**：所有能力都先落成可机读 API，再由 CLI/skill 包装。
- **核心不懂内容**：msgcode 不理解网页内容/文件内容，只管理“工作目录、产物路径、发布结果链接、权限与审计”。
- **后端可插拔**：Pinme/OneDrive 是 publisher 插件实现，核心只依赖接口。
- **不做内容处理**：不内置 ASR/TTS/摘要/解析等能力；只提供文件/媒体的落盘与可访问链接，让 agent 自己用 skill 做理解与生成。

## 统一能力面（建议）
- `workspace.create/list/get`
- `chat.create`（自动建群，最佳努力）
- `route.bind/list`
- `artifact.publish`（返回 URL）
- `artifact.upload`（返回 URL）
- `job.add/list/run/disable`

## API 形态（两种都可，优先 1）
1. **本机 loopback HTTP JSON API**（推荐）
   - `POST /v1/workspaces`
   - `POST /v1/artifacts/publish`（publisher=pinme）
   - `POST /v1/artifacts/upload`（publisher=onedrive）
   - `POST /v1/jobs`
2. **CLI 作为 API**
   - `msgcode publish --backend pinme --path <dir>`
   - `msgcode upload --backend onedrive --path <file>`

## Skill 交付（面向不同 agent）
- 给 Claude/Codex/OpenCode 各自提供一个“薄 wrapper”：
  - 只负责读配置、调用 API/CLI、把 URL 回传
  - 不直接处理 secrets（secrets 全在 msgcode config/Keychain）

## 安全边界（必须）
- 所有路径必须落在 `WORK_ROOT` 下，且只能发布 workspace 的 `share/`。
- `artifact.publish/upload` 必须写审计记录：who/when/what path/result url。
- 默认只允许 owner 在 DM 下发高权限命令（发布/上传/建群/创建 job）。

## Acceptance
- 任一 agent 只需要知道“调用哪个 tool + 给路径”，即可完成发布/上传并拿到 URL。
- msgcode 可以替换 publisher 实现（Pinme ↔ OneDrive）而不影响 agent 使用方式。

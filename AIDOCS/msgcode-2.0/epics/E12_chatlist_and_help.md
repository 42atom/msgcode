# E12 - Chatlist & Help（聊天进程管理最小控制面）

## 背景
2.0 已确定“用户手动建群 + 群内 `/bind` 绑定工作目录”。下一步要让小白也能无痛上手、能看懂当前有哪些“项目群/工作目录”正在被 msgcode 管理。

## 目标
- 在任意已绑定群里，用户能一眼看到所有绑定关系（群 → 工作目录）。
- 新用户无需看源码，靠 `/help` + README 就能启动第一条链路（/bind → /start）。

## 非目标
- 不做自动建群（`/newchat` 不在 2.0 范围）。
- 不做内容理解/ASR/TTS。
- 不做 Cloudflare Tunnel。

## 新增命令（群内）
### 1) `/chatlist`
展示当前所有“活跃绑定”：
- 只读：不修改任何绑定
- 数据源：`RouteStore`（`~/.config/msgcode/routes.json`）
- 输出格式（建议，每行一条，方便复制/检索）：
  - `<label>  ->  <workspacePath>  (#<chatGuidSuffix>)`

补充规则：
- 默认只列 `status=active`
- 可选扩展（后续再做，不影响本次验收）：
  - `/chatlist --all`：包含 `archived/paused`

### 2) `/help`
输出极简帮助：
- 只写“必会三招”：`/bind`、`/where`、`/start`
- 引导用法：`/bind <dir>` 只能相对路径，最终落在 `$WORKSPACE_ROOT/<dir>`
- 给出 1 个完整示例：`/bind acme/ops` → `/start`

## 设计约束
- 统一风格：bot 回包不使用 emoji（纯文本，适合复制粘贴）。
- 路由主键：以 `chatGuid` 为单一真相源；`chatId(rowid)` 仅作为缓存/补全字段。

## 实现建议（给 Opus）
- `src/routes/commands.ts`
  - 扩展 `isRouteCommand / parseRouteCommand` 支持 `/chatlist`、`/help`
  - 新增 `handleChatlistCommand / handleHelpCommand`
- `src/routes/store.ts`
  - 复用 `getActiveRoutes()`；必要时补一个 `getAllRoutes()`（避免直接暴露 JSON 结构）
- `src/listener.ts`
  - 保持“路由命令优先截获”逻辑不变
- `README.md`
  - 增加 “3 分钟上手” 段落（/bind → /start → /where）

## 验收标准
- 在任意已绑定群发送 `/chatlist`，能看到至少 1 条绑定（含目录 + chatGuid 后缀）。
- 在任意群发送 `/help`，能得到清晰的最短上手路径。
- `bun test` 全绿。


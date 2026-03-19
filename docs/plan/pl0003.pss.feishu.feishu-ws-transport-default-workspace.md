# Plan: 飞书 Bot(WebSocket) 接入 + 未绑定 chat 默认工作目录（MVP）

Issue: 0003

## Problem
当前 msgcode 的 transport 偏 iMessage-first，而 iMessage 账号/通道存在不稳定性，导致整体可用性被“单点传输层”制约。与此同时，未绑定 chat 的消息会被直接丢弃（route=null），降低了开箱即用程度。  
评审意见：[留空,用户将给出反馈]

## Decision
采用“多 transport 并存”的方式：在不破坏现有 iMessage 流程的前提下，引入飞书 Bot 作为新 transport。优先实现飞书 WebSocket 长连接收消息 + API 文本回发，复用现有 listener/handler/tmux 闭环。  
同时在路由层增加“未绑定 chat -> 默认工作目录”的 fallback（可配置目录名），让用户无需先 /bind 也能使用。  
评审意见：[留空,用户将给出反馈]

## Alternatives
1) 继续 iMessage-only：实现最少，但稳定性问题无解，且受账号/设备约束。  
2) 飞书 HTTP 回调：需要公网/反代与签名校验，部署与运维成本更高。  
3) 飞书 WebSocket：无需公网入口，配置更贴近 Alma 的“连接模式=WebSocket”，更适合 MVP。  
推荐：3) WebSocket。  
评审意见：[留空,用户将给出反馈]

## Plan
1) 依赖与配置
- 增加依赖：`@larksuiteoapi/node-sdk`
- `.env` 新增（用户配置目录 `~/.config/msgcode/.env`）：
  - `FEISHU_APP_ID`
  - `FEISHU_APP_SECRET`
  - `FEISHU_ALLOW_ALL=1`（仅冒烟期；默认应为 0）
  - `MSGCODE_DEFAULT_WORKSPACE_DIR=default`
  - 可选：`MSGCODE_TRANSPORTS=imsg,feishu`（默认并存）

2) 新增飞书 transport（收/发）
- 新增 `src/feishu/transport.ts`
  - WS 订阅事件：`im.message.receive_v1`
  - 将飞书事件转换为统一 `InboundMessage`
    - `chatId`: `feishu:<chat_id>`
    - `id`: `message_id`
    - `text`: 解析 message.content(JSON) 中的 `text`
    - `sender`: `open_id/user_id`（用于观测；MVP 不做白名单）
    - `isGroup`: `chat_type === "group"`
  - 提供 `send({ chat_guid, text, file? })`：
    - `chat_guid` 以 `feishu:` 前缀时，用飞书 API 向 `chat_id` 回发文本
    - `file` 先降级为文本提示（后续再补资源上传）

3) 统一发送口径（按 chatId 前缀分发）
- listener/commands/jobs 统一依赖一个 `sendClient.send({chat_guid,text,file?})`，由上层注入：
  - iMessage：直接走 `ImsgRpcClient.send`
  - Feishu：走 `feishuTransport.send`
- 目标：不在 handler 层引入 transport 细节，transport 仅影响“入站转换 + 出站发送”。

4) 路由层 default workspace fallback
- 修改 `src/router.ts`：
  - 未命中 RouteStore 且未命中 GROUP_* 时，不再返回 null
  - 返回默认 workspace 路由：
    - `projectDir = WORKSPACE_ROOT/MSGCODE_DEFAULT_WORKSPACE_DIR`
    - 启动时确保目录存在（`mkdir -p` 等效）

5) 兼容性与安全闸门
- 修改 `src/routes/store.ts`：后缀匹配仅对 iMessage chatId 启用，避免 `feishu:` 误命中。
- 修改 `src/security.ts`：
  - 若 `chatId` 以 `feishu:` 开头且 `FEISHU_ALLOW_ALL=1`：绕过白名单（仅冒烟期）
  - 默认行为不变（不开开关就不绕过）

6) UX 与可观测性
- 修改 `src/routes/cmd-bind.ts`：
  - 未绑定时 `/where` 输出增加“默认工作目录”展示，并提示 `/bind` 可覆盖
- 飞书 transport 增加结构化日志字段（connect/recv/send/error），用于定位“是否连上、是否收到事件、是否发送成功”。
评审意见：[留空,用户将给出反馈]

## Risks
- 鉴权风险：allow-all 冒烟期开关若误开启，会扩大可触发面。
  - 缓解：开关默认关闭；日志输出明确标记 allow-all 状态；后续补 owner-only/白名单映射。
- 回传能力不完整：MVP 先 text，附件/图片暂不支持。
  - 缓解：明确降级行为与后续补齐路径（资源上传、消息卡片等）。
- tmux session name 合法性：`feishu:<id>` 的后缀可能包含非法字符。
  - 缓解：稳定 groupName 生成时做字符清洗（仅保留 [a-z0-9-]）。
评审意见：[留空,用户将给出反馈]

## Rollback
- 通过 `.env` 移除/注释 `FEISHU_APP_ID/FEISHU_APP_SECRET` 或将 `MSGCODE_TRANSPORTS` 改为 `imsg`，即可回退到 iMessage-only。
- 不修改 RouteStore 数据结构（仍是 routes.json），回滚不需要迁移数据。  
评审意见：[留空,用户将给出反馈]

## Test Plan
- 单测：`npm test`
- 本地守护进程：重启 daemon 后观察日志出现 feishu connect
- 飞书群聊冒烟：
  - 发送 `/where`（未绑定时应显示默认目录）
  - 发送 `/bind acme/ops`
  - 发送普通文本（应触发 tmux/handler 并回文本）  
评审意见：[留空,用户将给出反馈]

## Evidence (可验证来源)
- Docs：飞书开放平台 Node SDK（`@larksuiteoapi/node-sdk`）文档；事件 `im.message.receive_v1`；接口 `im.message.create`。
- Code：`src/feishu/transport.ts`、`src/commands.ts`、`src/listener.ts`、`src/router.ts`、`src/security.ts`。
- Logs：`~/.config/msgcode/log/msgcode.log`（connect/recv/send）。  
评审意见：[留空,用户将给出反馈]

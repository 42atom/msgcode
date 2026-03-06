# P5.7-R13: Feishu WS Transport + Default Workspace Fallback（MVP）

Issue: 0003  
Plan: docs/design/plan-260306-feishu-ws-transport-default-workspace.md

## 背景
- iMessage 传输层不稳定，导致 msgcode 使用受限。
- 需要飞书 Bot（长连接）作为备用/主通道，同时保持现有 handler/tmux 架构不变。

## 交付物
- 代码：飞书 WS transport + 统一发送口径 + 默认工作目录 fallback
- 文档：Plan + Issue 记录齐备

## 验收点
1. 飞书群里 `/where`（未绑定）显示默认工作目录，并提示 `/bind` 覆盖。
2. 飞书群里 `/bind acme/ops` 生效，`routes.json` 生成对应条目（chatGuid=feishu:<chat_id>）。
3. 飞书群里发普通文本能收到 bot 回文（MVP：仅 text）。


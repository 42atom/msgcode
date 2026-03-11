---
name: feishu-send-file
description: 需要把当前 workspace 里的文件回传到飞书会话时使用。优先直接调用 feishu_send_file，并让工具自己从 .msgcode/config.json 读取 runtime.current_chat_id；只有在必须显式确认 chatId 时，才读取配置文件，不要解析 session 文件名。
---

# feishu-send-file skill

## 能力

- 把当前 workspace 里的图片、音频、文档或报告回传到飞书会话
- 在当前 workspace 已绑定飞书群时，直接复用 `.msgcode/config.json` 里的 `runtime.current_chat_id`

## 何时使用

- 用户要求“把生成的文件发回当前群”
- 已经生成了本地文件，现在要回传到飞书

## 调用合同

优先直接调用工具：

- `feishu_send_file(filePath=<绝对路径>, message=<可选说明>)`

说明：

- 在当前 workspace 已绑定飞书群时，`chatId` 可以省略
- 工具会优先读取当前 workspace 的 `.msgcode/config.json` 中的 `runtime.current_chat_id`
- 不要去解析 `.msgcode/sessions/` 文件名猜 chatId

只有在必须显式确认 chatId 时，才调用：

- `bash ~/.config/msgcode/skills/feishu-send-file/main.sh current-chat-id --workspace "$PWD" --json`

## 非目标

- 不要自己拼飞书 OpenAPI 请求
- 不要通过 session 文件名推断 chatId
- 如果 `.msgcode/config.json` 里没有 `runtime.current_chat_id`，直接报未绑定，不要猜

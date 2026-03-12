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

### 唯一正式发送入口

优先直接调用原生工具：

- `feishu_send_file(filePath=<绝对路径>, message=<可选说明>)`

说明：

- 在当前 workspace 已绑定飞书群时，`chatId` 可以省略
- 工具会优先读取当前 workspace 的 `.msgcode/config.json` 中的 `runtime.current_chat_id`
- 不要去解析 `.msgcode/sessions/` 文件名猜 chatId

### 关键规则

- **要把文件发回飞书群时，默认只用 `feishu_send_file`。**
- **不要为了发文件去走 `bash` 包一层 `msgcode` CLI。**
- **不要自己拼飞书 OpenAPI 请求。**
- **不要在没有真正调用 `feishu_send_file` 成功前，说“已发送”。**
- **如果用户明确说的是“把当前工作目录里的某个文件发回当前群/当前会话”，这就是动作题，不是解释题；没有 `feishu_send_file` 的成功回执前，不要直接结束。**

只有在必须显式确认 chatId 时，才调用辅助脚本：

- `bash ~/.config/msgcode/skills/feishu-send-file/main.sh current-chat-id --workspace "$PWD" --json`

这个辅助脚本 **只用于读取当前 chatId**，不是正式发送入口。

## 非目标

- 不要自己拼飞书 OpenAPI 请求
- 不要通过 session 文件名推断 chatId
- 不要通过 `bash msgcode ...` 伪造一条“发送文件”路径
- 如果 `.msgcode/config.json` 里没有 `runtime.current_chat_id`，直接报未绑定，不要猜

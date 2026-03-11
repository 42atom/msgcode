# 飞书文件发送工具使用指南

## 功能概述

飞书文件发送工具 (`feishu_send_file`) 允许智能体向指定的飞书群聊发送文件。

## 配置要求

### 1. 飞书应用配置

在使用前，需要在 workspace 配置中设置飞书应用凭证：

```bash
# 在你的工作区目录下执行
/msgcode config set feishu.appId "your_app_id"
/msgcode config set feishu.appSecret "your_app_secret"
```

或者直接编辑 `.msgcode/config.json`：

```json
{
  "feishu.appId": "cli_xxxxxxxxxxxxx",
  "feishu.appSecret": "your_app_secret",
  "tooling.allow": ["tts", "asr", "vision", "mem", "bash", "browser", "desktop", "read_file", "write_file", "edit_file", "feishu_send_file"],
  "runtime.current_transport": "feishu",
  "runtime.current_chat_id": "oc_xxxxxxxxxxxxxxxx",
  "runtime.current_chat_guid": "feishu:oc_xxxxxxxxxxxxxxxx"
}
```

### 2. 飞书应用权限

确保你的飞书应用已开通以下权限：
- `im:message` (发送消息权限)
- `im:message:send_as_bot` (以应用身份发送消息)
- `im:file` (文件权限)

## 工具参数

### `feishu_send_file`

- **filePath** (必需): 本地文件路径（绝对路径或相对于工作目录的路径）
- **chatId** (可选): 飞书群聊 ID（例如：`oc_xxxxxxxxxxxxxxxx`）。未传时优先读取 `.msgcode/config.json` 中的 `runtime.current_chat_id`
- **message** (可选): 附加文本消息，会与文件一起发送

## 使用示例

### 基本用法

```
请把这个文件发送到飞书群：/path/to/file.pdf
```

### 带消息的发送

```
发送这个文件到飞书群 oc_1234567890，并附上消息"这是最新的报告"
```

### 智能体识别

智能体会自动识别以下指令：
- "发送文件到飞书"
- "把这个文件发送到群聊"
- "上传文件到飞书"

## 工作流程

1. **文件验证**: 检查文件是否存在且有效
2. **文件上传**: 上传文件到飞书服务器，获取 `file_key`
3. **消息发送**: 发送文件消息到指定群聊
4. **文本附件**: 如果提供了 `message` 参数，会额外发送一条文本消息

## 错误处理

工具会处理以下错误情况：
- 文件不存在
- 文件超过大小限制（30MB）
- 飞书 API 调用失败
- 权限不足
- 网络问题

所有错误都会返回清晰的错误消息。

## 安全说明

- 工具默认需要用户确认（`riskLevel: "medium"`）
- 确保 `appSecret` 安全存储，不要提交到版本控制
- 建议使用环境变量或配置管理工具管理敏感信息

## 获取 Chat ID

有几种方式可以获取飞书群聊 ID：

1. **从 workspace config 获取**: 优先读取 `.msgcode/config.json` 中的 `runtime.current_chat_id`
2. **使用飞书开放平台 API**: 调用 `im.chat.list` 获取群聊列表
3. **从飞书客户端获取**: 在飞书客户端中查看群聊信息

## 技术实现

- **文件上传**: 使用飞 SDK 的 `im.file.create` API
- **消息发送**: 使用飞 SDK 的 `im.message.create` API
- **文件类型**: 支持所有飞书支持的文件类型（文档、图片、视频等）
- **大小限制**: 最大 30MB

## 相关文件

- 实现代码: `src/tools/feishu-send.ts`
- 工具集成: `src/tools/bus.ts`
- 工具清单: `src/tools/manifest.ts`
- 测试文件: `test/p5-7-r12-feishu-send-file.test.ts`

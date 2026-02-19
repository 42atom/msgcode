# msgcode 多 CLI + 对话式配置 PRD（极简）

## 目标
- 支持 cc 与 codex 两种 CLI 客户端（参考 telecode）。
- 通过与 bot 的对话完成群组配置，无需手改文件。
- 不破坏现有 cc 体验。

## 范围
- 新增 Driver 抽象（ClaudeDriver / CodexDriver）。
- config.json 取代 .env 为主配置（.env 仅兼容读取）。
- 群组内命令支持：client 切换 + 配置管理。

## 非目标
- 不做管理员控制面板。
- 不重写 Claude 输出解析（仅封装为 Driver）。

## 核心流程（对话式新增群组）
`/add` → 群组选择 → bot 类型 → projectDir → 身份确认 → 写入 config.json → `/show` 回显。

## 命令体系（当前群组生效）
- `/client show|cc|codex|args ...`
- `/add`
- `/bind <path>`
- `/bot <type>`
- `/whoami` `/allow <id>` `/deny <id>`

## 配置结构（简化）
```json
{
  "defaults": { "group": "default" },
  "identity": { "emails": [], "phones": [] },
  "groups": [
    {
      "key": "default",
      "chatId": "iMessage;+;xxxx",
      "name": "群组名",
      "projectDir": "/Users/<you>/GitProjects/xxx",
      "bot": "code",
      "client": "cc",
      "clientArgs": ["--dangerously-skip-permissions"]
    }
  ]
}
```

## 风险
- CLI 输出格式不一致 → Driver 隔离解析。
- codex 初期只做最小解析（优先非流式）。

## 里程碑
- M1: Driver 抽象 + cc 迁移
- M2: codex 支持 + /client 切换
- M3: /add 流程 + config.json 写入

## 成功指标
- cc 无回归
- codex 可启动并完成对话
- /add 配置成功率 > 95%

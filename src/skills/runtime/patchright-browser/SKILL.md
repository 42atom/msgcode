---
name: patchright-browser
description: This skill should be used when the model needs to inspect or drive the Patchright browser CLI wrapper, verify Chrome root state, or diagnose browser instances and tabs in msgcode.
---

# patchright-browser skill

## 能力

本 skill 是 Patchright 浏览器能力说明书，用来说明 `msgcode browser` CLI wrapper 的正确入口和参数合同。

- 正式浏览器通道：`browser` 工具（Patchright + Chrome-as-State）
- 本 skill 作用：提供 CLI 合同、状态检查路径、最小命令模板
- 本 skill 不替代正式 `browser` 工具，也不重新发明第二套浏览器底座

## 何时使用

在以下场景读取并使用本 skill：

- 浏览器自动化排障
- Patchright browser CLI 合同确认
- Chrome root / profiles / instances / tabs 状态检查
- 需要显式通过 bash 调 `msgcode browser` CLI wrapper

## 唯一入口

优先入口：`~/.config/msgcode/skills/patchright-browser/main.sh`

先把 Patchright 当成唯一正式浏览器底座，不要使用 `agent-browser`。先读 `~/.config/msgcode/skills/index.json`，再读本 skill，再走 wrapper。

## 核心规则

- 共享工作 Chrome 根目录信息时，先执行：
  - `bash ~/.config/msgcode/skills/patchright-browser/main.sh root --ensure --json`
- 需要查看 roots / instances / tabs 时，显式调用对应子命令，不猜默认 instance / tab。
- `instances stop` 和 `tabs list` 不是无参命令，必须传真实 `instanceId`。
- `instanceId` 不是人工编号，必须来自真实返回值，通常来自 `instances launch --json`、`instances list --json`、`tabs open --json` 等结构化结果。
- `tabId` 不是人工编号，不是 1、2、3 这种顺序号。`tabId` 必须来自真实返回值，通常来自 `tabs open --json`、`tabs list --json`、`snapshot --json`、`text --json` 等结构化结果里的 `tabId`。
- 读取页面内容、截图、点击或执行脚本前，先确认当前真实 `tabId`。不要猜旧页签，更不要直接写死 `tabId=1`。
- 需要真实网页交互时，优先走正式 `browser` 工具；需要排障、查看状态或验证 CLI 合同时，再走本 skill。

## 常用模板

```bash
bash ~/.config/msgcode/skills/patchright-browser/main.sh root --ensure --json
bash ~/.config/msgcode/skills/patchright-browser/main.sh profiles list --json
bash ~/.config/msgcode/skills/patchright-browser/main.sh instances list --json
bash ~/.config/msgcode/skills/patchright-browser/main.sh instances launch --mode headed --root-name work-default --json
bash ~/.config/msgcode/skills/patchright-browser/main.sh tabs open --url https://example.com --json
bash ~/.config/msgcode/skills/patchright-browser/main.sh tabs list --instance-id <real-instance-id> --json
bash ~/.config/msgcode/skills/patchright-browser/main.sh instances stop --instance-id <real-instance-id> --json
bash ~/.config/msgcode/skills/patchright-browser/main.sh snapshot --tab-id <real-tab-id> --compact --json
bash ~/.config/msgcode/skills/patchright-browser/main.sh action --tab-id <real-tab-id> --kind click --ref '{"role":"link","name":"More info","index":0}' --json
```

正确示例：

1. 先执行 `instances launch --json` 或 `tabs open --json`
2. 从返回 JSON 中读取真实 `instanceId` 和 `tabId`
3. `tabs list` / `instances stop` 复用真实 `instanceId`
4. `snapshot`、`text`、`action`、`eval` 复用真实 `tabId`

错误示例：

- `tabs list --json`
- `instances stop --json`
- `tabs list --instance-id 1`
- `snapshot --tab-id 1`
- `text --tab-id 1`
- `action --tab-id 1 --kind click ...`
- `instances stop --instance-id 1`
- 复用上一轮已经失效的旧 `tabId`
- 猜测一个旧 `instanceId`

## 参数速查

- `tabs.action` 必填 `kind`（`click` / `type` / `press`）
- `ref` 为 JSON：`{"role":"...","name":"...","index":N}`
- `kind=type` 时带 `text`
- `kind=press` 时带 `key`（如 `Enter` / `Tab` / `Escape`）
- `tabs.snapshot` 可带 `--interactive`
- `instances.launch` 可带 `--port` 指定调试端口（默认 `9222`）

## 验证与排障

推荐顺序：

1. `root --ensure`
2. `profiles list`
3. `instances list` / `instances launch`
4. `tabs open`
5. `snapshot` / `action`

需要排障时，先看 root、instances、tabs 的结构化 JSON，不要直接猜当前浏览器状态，不要猜 `tabId`。

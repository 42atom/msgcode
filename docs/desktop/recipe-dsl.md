# Desktop Recipes v0（规范）

> 原则：Recipe 是"流程即数据"，不耦合 Bridge 原语，不改 msgcode 内核。

## Recipe DSL（v0，稳定后再扩展）

Recipe 文件结构：
```json
{
  "id": "terminal_echo_v0",
  "name": "Terminal Echo Demo",
  "description": "在 Terminal 中输入文本并回车",
  "version": "0.1.0",
  "author": "msgcode",
  "workspacePath": "/abs/path",
  "steps": [
    {
      "op": "desktop.observe",
      "params": { "options": { "includeScreenshot": true } }
    },
    {
      "op": "desktop.confirm.issue",
      "params": {
        "intent": {
          "method": "desktop.typeText",
          "params": {
            "target": { "selector": { "byRole": "AXTextArea" } },
            "text": "echo T11_OK"
          }
        },
        "ttlMs": 60000
      }
    },
    {
      "op": "desktop.typeText",
      "params": {
        "target": { "selector": { "byRole": "AXTextArea" } },
        "text": "echo T11_OK",
        "confirm": { "tokenRef": "$lastToken" }
      }
    },
    {
      "op": "desktop.hotkey",
      "params": {
        "keys": ["enter"],
        "confirm": { "tokenRef": "$lastToken" }
      }
    }
  ]
}
```

## 约定

- `tokenRef` 引用：`$lastToken`（上一步 confirm.issue 产物）
- 所有副作用动作必须显式 confirm（token 优先）
- 每步都要写入 T10 的 `events.ndjson`
- 失败重试：由执行器决定（当前 v0 不支持）

## 支持的操作（ops）

- `desktop.observe`：截图 + AX 树
- `desktop.find`：查找 UI 元素
- `desktop.click`：点击元素
- `desktop.typeText`：输入文本
- `desktop.hotkey`：快捷键
- `desktop.waitUntil`：等待条件成立
- `desktop.confirm.issue`：签发一次性令牌
- `desktop.abort`：中止执行

## Recipe 目录结构

```
recipes/desktop/
├── README.md           # 本规范文档
├── terminal_echo_v0.json  # Demo: Terminal 回显
└── finder_search_v0.json  # Demo: Finder 搜索
```

## 执行器

v0 执行器可以先做成脚本（Node/TS）读取 recipe，逐步调用 `/desktop rpc`（走 session）。

```bash
# 执行 recipe
npx tsx scripts/desktop/run-recipe.ts recipes/desktop/terminal_echo_v0.json
```

## 验收标准

- 不改 Bridge 原语，仅新增一个 recipe 文件即可新增流程
- 至少提供 2 个弱耦合 demo：
  - Terminal echo：在 Terminal 中输入文本并回车
  - Finder 搜索：在 Finder 中搜索文件并打开

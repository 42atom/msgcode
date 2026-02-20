---
name: browser
description: 浏览器自动化。触发时机：打开网页/点击元素/输入文本。
---

# 浏览器自动化 (browser)

## 触发时机

- 打开网页
- 点击元素
- 输入文本

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode browser open --url <url>` | 打开网页 |
| `msgcode browser click --selector <css> [--url <url>]` | 点击元素 |
| `msgcode browser type --selector <css> --val <text> [--url <url>]` | 输入文本 |

## 示例

```bash
# 打开网页
msgcode browser open --url https://github.com

# 点击搜索框
msgcode browser click --selector "#query-builder-test"

# 输入文本
msgcode browser type --selector "#query-builder-test" --val "msgcode"
```

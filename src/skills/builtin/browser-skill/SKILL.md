---
name: browser-skill
description: 无头浏览器基础操作能力。触发时机：用户需要操作浏览器时。
---

# 浏览器自动化技能

## 触发时机

当用户请求涉及浏览器操作时触发：
- 打开指定网页
- 点击页面元素
- 在输入框中输入文本

## 可用命令

### msgcode browser open

打开网页。

```bash
msgcode browser open --url https://example.com
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --url | 是 | 目标网页 URL |

### msgcode browser click

点击元素。

```bash
msgcode browser click --selector "#submit-button"
msgcode browser click --selector ".nav-link" --url https://example.com
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --selector | 是 | CSS 选择器 |
| --url | 否 | 目标网页 URL |

### msgcode browser type

输入文本。

```bash
msgcode browser type --selector "#search-input" --val "搜索内容"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --selector | 是 | CSS 选择器 |
| --val | 是 | 输入值 |
| --url | 否 | 目标网页 URL |

## 依赖

- Playwright (Chromium/Firefox/WebKit)

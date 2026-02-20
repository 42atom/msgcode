---
name: media
description: 媒体感知能力。触发时机：屏幕截图。
---

# 媒体感知 (media)

## 触发时机

- 截取屏幕
- 截取指定窗口

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode media screen --out <path> [--window <id>]` | 屏幕截图 |

## 示例

```bash
# 截取当前屏幕
msgcode media screen --out ./screenshot.png

# 截取指定窗口
msgcode media screen --out ./window.png --window "Finder"
```

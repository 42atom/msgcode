---
name: media-skill
description: 屏幕截图能力。触发时机：用户需要截取屏幕或窗口时。
---

# 媒体感知技能

## 触发时机

当用户请求涉及截图时触发：
- 截取当前屏幕
- 截取指定窗口

## 可用命令

### msgcode media screen

屏幕截图。

```bash
msgcode media screen --out ./screenshot.png
msgcode media screen --out ./window.png --window <window-id>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --out | 是 | 输出文件路径 |
| --window | 否 | 窗口 ID |

## 依赖

- macOS: screencapture 命令

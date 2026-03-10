---
name: screenshot
description: This skill should be used when the task needs a local screen capture as evidence or UI context, especially on macOS where msgcode already exposes a screenshot CLI.
---

# screenshot skill

## 能力

采集当前屏幕截图并落盘为本地证据。

## 何时使用

- 用户要看当前屏幕
- 需要给 UI 故障、页面状态或本地界面留证据
- 需要先截图再做视觉分析

## 调用合同

优先走 msgcode 自带 CLI：

`msgcode media screen --output <abs-path> --json`

默认输出目录是：

`AIDOCS/media/screenshots/`

## 参考命令

```bash
msgcode media screen --json
msgcode media screen --output "$PWD/AIDOCS/media/screenshots/current.png" --json
```

## 使用要点

- 先让 CLI 产出文件路径，再决定是否读取/分析图片
- 需要进一步视觉理解时，再结合视觉能力处理截图
- 如果系统没有屏幕录制权限，应直接说明权限缺失

## 常见错误

- 不要绕过 `msgcode media screen` 重新发明第二套截图主链
- 不要在没拿到真实文件路径前声称截图成功

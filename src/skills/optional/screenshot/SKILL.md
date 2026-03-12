---
name: screenshot
description: Retired. Local screen capture should use native macOS screencapture or shell directly.
---

# screenshot skill（retired）

这个 optional skill 已退役，不再进入 optional 索引。

本地截图请直接使用原生 macOS `screencapture` 或 shell：

```bash
mkdir -p "$PWD/AIDOCS/media/screenshots"
screencapture -x -t png "$PWD/AIDOCS/media/screenshots/current.png"
```

如果系统缺少屏幕录制权限，应直接说明权限缺失；不要再调用 `msgcode media screen`。

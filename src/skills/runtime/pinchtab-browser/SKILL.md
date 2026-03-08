---
name: pinchtab-browser
description: This skill should be used only when investigating historical PinchTab artifacts or performing rollback-oriented browser diagnosis; it is not part of the active browser mainline.
---

> RETIRED / HISTORICAL / ROLLBACK ONLY
>
> 已被 `patchright-browser` 取代，不再是正式 runtime skill 真相源。
> 保留本文件仅作历史参考与回滚说明，正式浏览器通道请看 `~/.config/msgcode/skills/patchright-browser/`。

# pinchtab-browser skill

## 用途

本 skill 只用于：

- 历史 PinchTab 行为追溯
- 回滚演练前的合同核对
- 对比旧日志、旧命令、旧浏览器状态

本 skill 不再参与当前正式浏览器主链。

## 唯一入口

历史入口：`~/.config/msgcode/skills/pinchtab-browser/main.sh`

## 历史模板

```bash
bash ~/.config/msgcode/skills/pinchtab-browser/main.sh root --ensure --json
bash ~/.config/msgcode/skills/pinchtab-browser/main.sh profiles list --json
bash ~/.config/msgcode/skills/pinchtab-browser/main.sh instances list --json
bash ~/.config/msgcode/skills/pinchtab-browser/main.sh instances launch --mode headed --profile-id <id> --json
bash ~/.config/msgcode/skills/pinchtab-browser/main.sh tabs open --instance-id <id> --url https://example.com --json
bash ~/.config/msgcode/skills/pinchtab-browser/main.sh snapshot --tab-id <id> --compact --json
```

## 当前正式口径

- 当前正式浏览器底座：Patchright
- 当前正式 runtime skill：`patchright-browser`
- `agent-browser` 也不是正式执行路径

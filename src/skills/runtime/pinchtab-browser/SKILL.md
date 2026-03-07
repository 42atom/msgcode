> RETIRED / HISTORICAL / ROLLBACK ONLY
>
> 已被 `patchright-browser` 取代，不再是正式 runtime skill 真相源。
> 保留本文件仅作历史参考与回滚说明，正式浏览器通道请看 `~/.config/msgcode/skills/patchright-browser/`。

# pinchtab-browser skill

触发：浏览器自动化、PinchTab CLI、profile/instance/tab 操作、共享工作 Chrome 根目录。

历史浏览器通道：`browser` 工具（PinchTab，已退役）。
本 skill 作用：保留 PinchTab CLI 合同与最小命令壳，供历史追溯或回滚参考。

优先入口：`~/.config/msgcode/skills/pinchtab-browser/main.sh`

规则：
- 这是旧 PinchTab 合同说明，不再代表当前正式主链；当前正式浏览器底座是 Patchright，`agent-browser` 也不是正式执行路径。
- 需要共享工作 Chrome 路径时，先执行：
  - `bash ~/.config/msgcode/skills/pinchtab-browser/main.sh root --ensure --json`
- 需要查看 profiles/instances/tabs 时，显式调用对应子命令，不猜默认 instance/tab。

常用：
- `bash ~/.config/msgcode/skills/pinchtab-browser/main.sh root --ensure --json`
- `bash ~/.config/msgcode/skills/pinchtab-browser/main.sh profiles list --json`
- `bash ~/.config/msgcode/skills/pinchtab-browser/main.sh instances list --json`
- `bash ~/.config/msgcode/skills/pinchtab-browser/main.sh instances launch --mode headed --profile-id <id> --json`
- `bash ~/.config/msgcode/skills/pinchtab-browser/main.sh tabs open --instance-id <id> --url https://example.com --json`
- `bash ~/.config/msgcode/skills/pinchtab-browser/main.sh snapshot --tab-id <id> --compact --json`

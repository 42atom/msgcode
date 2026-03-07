# pinchtab-browser skill

触发：浏览器自动化、PinchTab CLI、profile/instance/tab 操作、共享工作 Chrome 根目录。

正式浏览器通道：`browser` 工具（PinchTab）。
本 skill 作用：提供 PinchTab CLI 合同与最小命令壳，不替代正式 `browser` 工具。

优先入口：`~/.config/msgcode/skills/pinchtab-browser/main.sh`

规则：
- 先把 PinchTab 当成唯一正式浏览器底座，不要使用 agent-browser。
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

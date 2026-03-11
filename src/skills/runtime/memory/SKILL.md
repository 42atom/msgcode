# memory skill

触发：用户要求“记住”“回忆”“检索历史记忆”。

优先入口：`~/.config/msgcode/skills/memory/main.sh`

默认 workspace：当前目录 `$PWD`（可被 `--workspace` 覆盖）。

常用：
- `bash ~/.config/msgcode/skills/memory/main.sh add "用户偏好..." --json`
- `bash ~/.config/msgcode/skills/memory/main.sh search "偏好" --limit 8 --json`
- `bash ~/.config/msgcode/skills/memory/main.sh stats --json`
- `bash ~/.config/msgcode/skills/memory/main.sh status --json`

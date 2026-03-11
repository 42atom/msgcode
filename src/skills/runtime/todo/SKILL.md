# todo skill

触发：任务记录、查看待办、标记完成。

优先入口：`~/.config/msgcode/skills/todo/main.sh`

默认 workspace：当前目录 `$PWD`（可被 `--workspace` 覆盖）。

常用：
- `bash ~/.config/msgcode/skills/todo/main.sh add "补充测试报告" --json`
- `bash ~/.config/msgcode/skills/todo/main.sh list --json`
- `bash ~/.config/msgcode/skills/todo/main.sh done <taskId> --json`

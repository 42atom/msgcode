# file skill

触发：读取文件、查找内容、写文件、发送文件。

优先入口：`~/.config/msgcode/skills/file/main.sh`

常用：
- `bash ~/.config/msgcode/skills/file/main.sh find . --pattern "*.md" --json`
- `bash ~/.config/msgcode/skills/file/main.sh read README.md --json`
- `bash ~/.config/msgcode/skills/file/main.sh write ./notes/todo.md --content "..." --json`
- `bash ~/.config/msgcode/skills/file/main.sh send --path ./AIDOCS/report.md --to <chat-guid> --json`

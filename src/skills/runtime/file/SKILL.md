# file skill

触发：读取文件、查找内容、写文件、移动/复制文件。

优先入口：`msgcode file ...`

常用：
- `msgcode file find . --pattern "*.md" --json`
- `msgcode file read README.md --json`
- `msgcode file write ./notes/todo.md --content "..." --json`
- `msgcode file copy ./AIDOCS/report.md ./AIDOCS/report.bak.md --json`

说明：
- `file skill` 负责文件查找、读取、写入、复制、移动。
- 如果要把文件回传到当前飞书会话，优先直接调用 `feishu_send_file(...)`，不要再走历史 `msgcode file send`。

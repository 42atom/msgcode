# file skill

触发：读取文件、查找内容、写文件、移动/复制文件。

优先入口：原生 `read_file` 与 `bash`

常用：
- `read_file("/absolute/path/to/file")`
- `rg --files . | head`
- `sed -n '1,120p' README.md`
- `cp ./AIDOCS/report.md ./AIDOCS/report.bak.md`

说明：
- `file skill` 负责文件查找、读取、写入、复制、移动。
- 本地文件操作直接使用原生工具或 shell，不要再期待 `msgcode file ...` 包装层。
- 需要批量查找时优先 `rg` / `find`；需要局部读取时优先 `read_file` 或 `sed -n`。
- 如果要把文件回传到当前飞书会话，优先直接调用 `feishu_send_file(...)`，不要再走历史 `msgcode file send`。

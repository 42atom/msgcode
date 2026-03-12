# thread skill

触发：查看/切换会话线程，读取线程消息。

优先入口：`msgcode thread ...`

常用：
- `msgcode thread list --json`
- `msgcode thread active --json`
- `msgcode thread messages <thread-id> --limit 20 --json`
- `msgcode thread switch <thread-id> --json`

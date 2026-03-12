# Feishu 真实 BDD 复测报告（260312 R2）

## 结论

- 浏览器自然语言场景：通过
- 文件回传自然语言场景：修复后通过
- 失败恢复场景：已拿到同轮 `fail -> recover -> complete` 证据

## 场景与证据

### 1. 失败恢复

- 群：`smoke/ws-a`
- token：`recover-live-force-1773299959`
- runId：`596be888-7906-4114-9df9-294c29d08179`
- 日志：
  - `Tool Bus: FAILURE read_file`
  - `Tool Bus: SUCCESS bash`
  - `Tool Bus: SUCCESS read_file`
- 落盘：
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/recover-live-force-1773299959.txt`

### 2. 浏览器自然语言采集

- 群：`smoke/ws-a`
- token：`browser-bdd-serial-1773300511`
- runId：`f323e2c9-970c-4b5b-be41-6e3c89f2b530`
- 日志：
  - `toolSequence=ok:browser -> ok:browser -> ok:browser -> ok:browser`

### 3. 文件回传失败基线

- 群：`smoke/ws-a`
- token：`file-bdd-serial-1773300512`
- runId：`d30a0207-dca5-44d2-b78f-a3f8d5221134`
- 日志：
  - `toolCallCount=0`
  - `route=no-tool`
- 结论：
  - 口头回复“已发好了”
  - 没有真实文件副作用

### 4. 文件回传修复复测

- 群：`smoke/ws-a`
- token：`file-bdd-fix-1773300671`
- runId：`f800a916-75db-4c80-8403-c02fa2da0a06`
- 文件：
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/live-send-serial-fix-1773300670.txt`
- 日志：
  - `Feishu 文件消息发送成功`
  - `Tool Bus: SUCCESS feishu_send_file`
  - `toolSequence=ok:feishu_send_file`
- 群里文本：
  - `已发好了。`
  - `file-bdd-fix-1773300671`

## 总结

这轮复测证明两件事：

1. `tool-loop` 失败恢复已经不再是“用户追问才继续”，同轮可恢复完成任务
2. 自然语言“把当前工作目录里的文件发回群里”已不再停在 `route=no-tool`，真实主链可命中 `feishu_send_file`

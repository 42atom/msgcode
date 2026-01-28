# Notes: msgcode 2.0（输入/输出/供应链核心发现）

## 事实（已核验）

### imsg 开源
- GitHub 源码仓库：`https://github.com/steipete/imsg`
- License：MIT（仓库内 `LICENSE`）
- brew tap 指向：`https://github.com/steipete/homebrew-tap`，`Formula/imsg.rb` 下载 GitHub Releases 的 `imsg-macos.zip` 并校验 sha256。

### Moltbot 的 iMessage 实现形态（参考）
- 通过 `imsg rpc`（stdio JSON-RPC）：
  - 收：`watch.subscribe` 推送（通知 `method=message`）
  - 发：`method=send`（支持 `chat_id/chat_guid/chat_identifier/to`）
  - 代码锚点：`src/imessage/client.ts:1`、`src/imessage/monitor/monitor-provider.ts:1`、`src/imessage/send.ts:1`

### msgcode 当前形态（风险来源）
- 收消息：SDK watcher + `getMessages({ unreadOnly: true })` 补漏；可选 `fs.watch(chat.db)` 触发轮询。
- 发消息：
  - 私聊：SDK send，失败降级 AppleScript
  - 群聊：AppleScript（并通过读 DB 做回执校验/重发）
- 已读：直接写 `chat.db`（为保证 unreadOnly 流水线）
- 文档要求关闭 iCloud 消息同步（本质是在规避 DB 写/多设备一致性问题）

## 结论（面向 2.0）
- “依赖 unreadOnly + 写 DB 标已读”会把系统正确性绑定在外部状态（iCloud/多设备/锁/权限）上，2.0 应该把“已处理”内化成自己的状态（lastSeen 游标）。
- 供应链风险：就算开源，只用 release zip 也存在“源码-二进制不可证明一致”的风险；2.0 应引入“固定 tag/commit 的源码构建产物”。


# Feishu 真实 BDD 复测报告（260312 R3）

## 结论

- 浏览器自然语言场景：通过
- 文件回传自然语言场景：通过
- 本轮骨架收口（quota 去重、隐藏工具基线移除）后，真实 Feishu 主链未回退

## 场景与证据

### 1. 浏览器自然语言采集

- 群：`smoke/ws-a`
- token：`browser-r3-1773306787885`
- 关键日志：
  - `Tool Bus: SUCCESS browser` 共 5 次
  - `agent final response metadata`
- 最近消息回读：
  - `messageType=text`
  - 回复包含：
    - `Example Domain`
    - `IANA-managed Reserved Domains`
    - `browser-r3-1773306787885`

### 2. 文件回传自然语言动作

- 群：`smoke/ws-a`
- token：`file-r3-1773306807025`
- 文件：
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/live-send-r3-1773306807025.txt`
- 关键日志：
  - `Feishu 文件发送开始`
  - `Feishu 文件上传成功`
  - `Feishu 文件消息发送成功`
  - `Tool Bus: SUCCESS feishu_send_file`
- 最近消息回读：
  - 新 `file` 消息：
    - `file_name=live-send-r3-1773306807025.txt`
  - 新文本消息：
    - `已发好了。`
    - `file-r3-1773306807025`

## 结论补充

这轮复测说明：

1. `getToolsForLlm()` 删除隐藏工具基线之后，没有把 `smoke/ws-a` 的真实浏览器/文件发送主链打坏
2. `tool-loop` quota 热路径去重没有影响真实 Feishu 自然语言任务闭环
3. 当前真实验收面仍满足：
   - 工具真实调用
   - 群里真实结果
   - workspace/日志证据一致

## 证据路径

- Logs:
  - `/Users/admin/.config/msgcode/log/msgcode.log`
- Workspace:
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/.msgcode/config.json`
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/live-send-r3-1773306807025.txt`
- 最近消息回读：
  - `feishu_list_recent_messages`

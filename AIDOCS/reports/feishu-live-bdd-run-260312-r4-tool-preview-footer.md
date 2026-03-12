# Feishu Live BDD Run 260312 R4

## 目的

验证 `Issue 0128` 的执行层 preview 元数据脚注统一收口，没有破坏真实 Feishu 主链。

## 用例

- workspace: `/Users/admin/msgcode-workspaces/smoke/ws-a`
- chatId: `feishu:oc_84740a3aa0a5aebbb0b23a847c023ca4`
- sender: `ou_0443f43f6047fd032302ba09cbb374c3`
- 自然语言任务：

```text
帮我打开 example.com 看看网页标题，并用一句自然语言告诉我这个站点是做什么的。回复末尾带上 browser-r4-1773312896584
```

## 结果

- 实际命中 `browser` 原生工具
- 真实 Feishu 群收到了带 token 的回复
- 最近消息回读命中同一条回复

## 证据

### Logs

- `/Users/admin/.config/msgcode/log/msgcode.log`
- 关键片段：
  - `Tool Bus: SUCCESS browser`
  - `agent final response metadata`
  - `Feishu 最近消息查询成功`

### Recent message hit

```json
{
  "messageId": "om_x100b541df6a738acc4f58b650103b92",
  "senderId": "cli_a92c2991c4e39cb2",
  "messageType": "text",
  "sentAt": "1773312902859",
  "textSnippet": "页面标题是 \"Example Domain\"。这个站点是一个保留的示例域名，专门用于文档示例和教程等场景，可以自由使用而无需许可，但不适合用于实际运营。\n\nbrowser-r4-1773312896584"
}
```

## 结论

`Issue 0128` 的 preview footer 收口没有把真实 Feishu 浏览器自然语言主链打坏；本轮可以作为“静态回归 + 真实通道”双重验收证据。

# Feishu Live BDD Run 260312 R5

## 目的

验证最近这一轮 CLI 命令面收口没有破坏真实主链，重点校对：

- `memory` canonical 子命令与 `help-docs` 是否一致
- `file send` 退出公开 `file --help` 后，真实文件回传主链是否仍正常
- `browser` 自然语言采集主链是否仍正常

## 边界

这轮是：

- **当前正式 `listener + handler + tool-loop`**
- **真实 Feishu 出站**
- **真实最近消息回读**

不是：

- Feishu WS 真入站 transport 冒烟

也就是说，这一轮验证的是**运行时主链 + 真实群回执**，不是飞书平台入站事件本身。

## 固定上下文

- workspace: `/Users/admin/msgcode-workspaces/smoke/ws-a`
- chatGuid: `feishu:oc_84740a3aa0a5aebbb0b23a847c023ca4`
- sender: `ou_0443f43f6047fd032302ba09cbb374c3`

## 用例与结果

### 1. 浏览器自然语言采集

- token: `browser-r5-1773318377080`
- 任务：

```text
哥，最后帮我校对一下浏览器链。帮我打开 example.com 和 IANA 的保留域名页面，告诉我两个页面标题，并说明 example.com 是做什么的。回复末尾带上 browser-r5-1773318377080
```

- 结果：**通过**

证据：

- Logs:
  - `Tool Bus: SUCCESS browser` 两次
  - `agent final response metadata [route=tool]`
  - `listener 消息处理完成` 中的最终回复包含：
    - `Example Domain`
    - `IANA-managed Reserved Domains`
    - `browser-r5-1773318377080`
- Recent messages:
  - `messageId=om_x100b541f4198a8a8c1014625a5e826d`
  - 回复摘要包含：
    - `Example Domain`
    - `IANA-managed Reserved Domains`

### 2. 文件回传自然语言动作

- token: `file-r5-1773318377080`
- 文件：
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/live-send-r5-1773318377080.txt`
- 任务：

```text
哥，最后帮我校对一下发文件主链。请把当前工作目录里的 live-send-r5-1773318377080.txt 发回这个群里，再自然地告诉我已经发好了，并带上标记 file-r5-1773318377080。
```

- 结果：**通过**

证据：

- Logs:
  - `Feishu 文件发送开始`
  - `Feishu 文件上传成功`
  - `Feishu 文件消息发送成功`
  - `Tool Bus: SUCCESS feishu_send_file`
  - `listener 消息处理完成` 中最终回复包含 `file-r5-1773318377080`
- Recent messages:
  - 文本消息：
    - `messageId=om_x100b541f413910a0c38e4764ffd0217`
    - `已发好了。`
    - `file-r5-1773318377080`
  - 文件消息：
    - `messageId=om_x100b541f411ed0a0c4ee8ba4ce319a3`
    - `file_name=live-send-r5-1773318377080.txt`

### 3. CLI/帮助入口自发现

- token: `cli-r5-1773318377080`
- 任务：

```text
哥，最后帮我校对一下命令面。不要凭记忆，直接用 msgcode 的正式帮助入口检查两件事：第一，memory 的正式子命令有哪些；第二，file 的公开子命令里还有没有 send。用自然中文直接告诉我结果，并带上标记 cli-r5-1773318377080。
```

- 结果：**通过**

证据：

- Logs:
  - `Tool Bus: SUCCESS bash` 三次
  - `agent final response metadata [route=tool]`
  - `listener 消息处理完成` 中最终回复明确写出：
    - `memory 的正式子命令有 5 个：index、search、get、add、stats`
    - `file 的公开子命令里没有 send`
    - `cli-r5-1773318377080`
- Recent messages:
  - `messageId=om_x100b541f5ff4a0a8c2b56915b26a562`
  - 回复摘要包含：
    - `memory 的正式子命令有 5 个`
    - `file 的公开子命令`
    - `没有 send`

## 结论

这轮真实校对说明：

1. `memory` canonical 面与 `help-docs` 对齐后，没有把真实任务链打坏。
2. `file send` 退出公开 `file --help` 之后，自然语言文件回传仍稳定命中 `feishu_send_file`。
3. `browser` 自然语言采集主链在这一轮 CLI 收口后没有回退。
4. 当前“程序是真合同、help-docs 是机器可读真相源、SKILL.md 是说明书”这条命令面主线，在真实 Feishu 群验证里成立。

## 证据路径

- Logs:
  - `/Users/admin/.config/msgcode/log/msgcode.log`
- Workspace:
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/live-send-r5-1773318377080.txt`
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/.msgcode/threads/`
- Recent messages:
  - `feishu_list_recent_messages`

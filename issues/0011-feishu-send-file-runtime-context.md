---
id: 0011
title: 飞书文件发送收口到 workspace 当前会话上下文
status: doing
owner: agent
labels: [bug, feature]
risk: medium
scope: listener/config/tools/prompt
plan_doc: docs/design/plan-260307-feishu-send-file-runtime-context.md
links: []
---

## Context

- 当前飞书文件发送链路存在两类问题：
  1. 模型被提示去解析 session 文件名拿 chatId，状态源分叉且理解成本高。
  2. `feishu_send_file` 在文件上传失败后仍可能因为文本降级发送成功而被误判为成功。
- 真实日志证据显示 2026-03-06 18:28:17 出现 `Feishu 文件上传失败 [error=Request failed with status code 400]`，但工具层随后仍记录 `Feishu 文件发送成功`。

## Goal / Non-Goals

- Goal: 在 `.msgcode/config.json` 中写入当前请求的 transport/chatId/chatGuid，作为当前会话单一真相源。
- Goal: `feishu_send_file` 缺省 `chatId` 时优先回读该配置，不再依赖 session 文件名推断。
- Goal: 只有文件真正上传并发出 file message 时，工具才返回成功。
- Non-Goals: 不重做整个路由系统，不引入新的会话注册中心，不扩展飞书身份鉴权。

## Plan

- [x] 新增 workspace 运行时会话上下文字段与写入函数。
- [x] 在请求进入并完成路由后，把当前 transport/chatId/chatGuid 写入工作区 config。
- [x] 收口 `feishu_send_file`：`chatId` 变为可省略，缺省时读 workspace 当前会话上下文。
- [x] 修复飞书上传 `file_type` 与成功语义，补充回归测试。
- [ ] 跑定向测试并补 issue/CHANGELOG 证据。

## Acceptance Criteria

1. `.msgcode/config.json` 能看到 `runtime.current_transport`、`runtime.current_chat_id`、`runtime.current_chat_guid`。
2. 模型提示不再要求解析 session 文件名获取飞书 chatId。
3. 上传失败但文本降级成功时，`feishu_send_file` 返回失败，不再伪装为文件发送成功。
4. `chatId` 缺省时，工具可从 workspace 当前会话上下文回填。

## Notes

- Docs：`prompts/agents-prompt.md`
- Code：`src/listener.ts`、`src/config/workspace.ts`、`src/tools/bus.ts`、`src/feishu/transport.ts`、`src/tools/feishu-send.ts`
- Logs：`/Users/admin/.config/msgcode/log/msgcode.log` 中 2026-03-06 18:28:17 上传失败但工具成功的矛盾日志
- Tests：`PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r12-feishu-send-file.test.ts`
- Tests：`PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r7a-browser-tool-bus.test.ts`
- 2026-03-07：定向测试通过，`feishu_send_file` 已覆盖当前会话写入、缺省 chatId 回填、失败不伪装成功。

## Links

- Plan: `docs/design/plan-260307-feishu-send-file-runtime-context.md`

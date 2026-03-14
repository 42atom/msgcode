# plan-260313-tool-bus-feishu-runner-extraction

## Problem

Tool Bus 里 `feishu_send_file`、`feishu_list_members`、`feishu_list_recent_messages`、`feishu_reply_message`、`feishu_react_message` 五个分支都在重复读取 workspace config、环境变量、当前消息上下文，再转调具体工具实现。总线因此继续承担业务适配职责，而不是只做网关。

## Occam Check

### 不加它，系统具体坏在哪？

- bus 继续背 `feishu_*` 的上下文推断与配置解析
- 同一套 `appId/appSecret/chatId/messageId` 解析逻辑散落五处

### 用更少的层能不能解决？

- 能。把同域适配逻辑收成一个 Feishu runner，bus 只保留调用入口

### 这个改动让主链数量变多了还是变少了？

- 变少了。bus 少五段业务分支，域内适配只有一份真相源

## Decision

选定方案：新增 `src/runners/feishu.ts`，集中处理 Feishu 配置解析、chatId/messageId 默认推断和五个工具的调用编排。Tool Bus 只接收参数并调用 runner，保留既有返回结构与 preview builder。

## Plan

1. 新增 `src/runners/feishu.ts`
2. 从 `src/tools/bus.ts` 删除 Feishu 重复业务推断，改为调用 runner
3. 更新：
   - `test/tools.bus.test.ts`
   - `test/p5-7-r12-feishu-send-file.test.ts`
   - `test/p6-feishu-message-context-phase4-actions.test.ts`
4. 更新 `docs/CHANGELOG.md`
5. 跑验证

## Risks

1. 上下文默认解析如果改错，会影响当前消息回复与默认群聊发送
   - 回滚：回退 `src/runners/feishu.ts` 与 `src/tools/bus.ts` 中 Feishu 部分
2. 这轮只做外移，不改行为；若测试暴露旧口径依赖，应优先修 runner，不把逻辑搬回 bus

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts test/p5-7-r12-feishu-send-file.test.ts test/p6-feishu-message-context-phase4-actions.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]

# 未绑定普通消息不再自动落到 default workspace

## Problem

`default workspace` 目前仍会被普通聊天主链当作临时 route 使用。用户没有显式 `/bind`，系统却已经替用户和模型决定了“这条消息属于 default workspace”。这让未绑定消息看起来像已绑定工作链路，违背“真实 route 只能来自显式绑定或静态配置”的方向。

## Occam Check

- 不加它，系统具体坏在哪？
  - 未绑定普通消息仍会继续进 handler，写入 `default workspace` 相关上下文和产物，系统继续替用户偷偷做主。
- 用更少的层能不能解决？
  - 能。只给 `routeByChatId()` 增加一个是否允许 default fallback 的开关，主聊天链路关掉它，命令链路继续沿用现有 resolver。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。普通聊天主链不再绕过“未绑定”这个真实状态。

## Decision

选定方案：让 `default workspace` 只保留给显式命令链路。

- `routeByChatId()` 新增 `allowDefaultFallback` 选项
- `listener` 普通消息与 `/status` 快车道关闭 default fallback
- `resolveCommandRoute()` 和 `/where` 等命令链仍保持原有 default fallback

这样只改一条旁路，不新开第二套路由控制面。

## Alternatives

### 方案 A：保留现状

- 优点：兼容旧行为
- 缺点：普通消息仍会被系统偷偷路由到 `default`

### 方案 B：主聊天链路 fail-closed，命令链路保留 fallback

- 优点：最小切口，直接对准“系统替用户做主”的旁路
- 缺点：未绑定普通消息第一次会多一个绑定提示

### 方案 C：彻底删除所有 default fallback

- 优点：更彻底
- 缺点：会同时打坏 `/where`、`/bind` 之前的命令链体验，扩大了本轮范围

推荐：方案 B

## Plan

1. 更新 [src/router.ts](/Users/admin/GitProjects/msgcode/src/router.ts)
   - 为 `routeByChatId()` 增加 `allowDefaultFallback` 选项
   - `isConfiguredChatId()` 改为只认显式绑定/静态配置

2. 更新 [src/listener.ts](/Users/admin/GitProjects/msgcode/src/listener.ts)
   - 普通消息主链用 `routeByChatId(chatId, { allowDefaultFallback: false })`
   - 未绑定时对普通消息和未路由 slash 统一做节流提示

3. 更新 [src/commands.ts](/Users/admin/GitProjects/msgcode/src/commands.ts)
   - `/status` 快车道不再偷偷落到 `default workspace`

4. 更新测试
   - [test/p5-7-r13-default-workspace-command-fallback.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r13-default-workspace-command-fallback.test.ts)
   - [test/listener.test.ts](/Users/admin/GitProjects/msgcode/test/listener.test.ts)

5. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

6. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 一部分历史预期默认认为“未绑定也能像已绑定一样聊天”，本轮会改成提示绑定
- `/status` 在未绑定场景下会回到显式报错，不再偷偷读 default workspace

回滚策略：

- 回退 `router/listener/commands`、对应测试、issue/plan 和 changelog 本轮改动

评审意见：[留空,用户将给出反馈]

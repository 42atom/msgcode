# plan-260313-desktop-route-rpc-only-thinning

## Problem

desktop legacy runner 已经收口为单次 `msgcode-desktopctl rpc` 调用，但 route 层还在维护 `/desktop find|click|type|hotkey|wait`、`/desktop confirm`、`/desktop ping|doctor|observe` 这些旧糖衣。它们会在 slash 路由里替用户改写意图、拼下一步命令模板、把显式 RPC 主链重新包厚。

## Occam Check

### 不加它，系统具体坏在哪？

- `/desktop` 仍然存在两套心智模型：显式 `rpc` 和 route 糖衣
- route 层继续替桌面桥做方法翻译与下一步引导
- 后续切换开源 desktop 实现时，还要先拆这层历史糖衣

### 用更少的层能不能解决？

- 能。只保留 `/desktop rpc <method> ...`，其余入口直接退出主链

### 这个改动让主链数量变多了还是变少了？

- 变少了。desktop slash 主链收口为单一 RPC 入口

## Decision

选定方案：`/desktop` 只保留 `rpc` 子命令，顶层 `/desktop` 返回 RPC 用法；删除 shortcut/confirm/ping/doctor/observe 糖衣解析与对应文件的主链资格。

- route 只负责识别 `/desktop` 与 `/desktop rpc ...`
- 绑定校验只对真正执行 RPC 时生效
- 文档和帮助统一改成 RPC 口径

## Plan

1. 修改 `/Users/admin/GitProjects/msgcode/src/routes/cmd-desktop.ts`
   - 删除 `shortcut` / `confirm` / 其他子命令分发
   - `/desktop` 或无效子命令只返回 RPC 用法
2. 修改 `/Users/admin/GitProjects/msgcode/src/routes/commands.ts`
   - 删除 `/desktop find|click|type|hotkey|wait` 的专门识别
   - parser 只保留 `/desktop` 与 `/desktop rpc ...`
3. 修改 `/Users/admin/GitProjects/msgcode/src/routes/cmd-info.ts`
   - slash help 由 `/desktop ...` 改为 `/desktop rpc <method> ...`
4. 更新现役文档
   - `/Users/admin/GitProjects/msgcode/docs/desktop/README.md`
   - `/Users/admin/GitProjects/msgcode/docs/desktop/recipe-dsl.md`
5. 将已退役的 route 糖衣文件移到 `.trash`
6. 跑测试并更新 `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`

## Risks

1. 旧手工命令 `/desktop find ...` 会失效
   - 回滚：恢复 route 糖衣解析，但不恢复更多 next-step 模板
2. 帮助文案若不同步，用户会继续使用旧入口
   - 回滚：恢复旧文案，或补一条更明确的 RPC-only 帮助

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/routes.commands.test.ts test/tools.bus.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]

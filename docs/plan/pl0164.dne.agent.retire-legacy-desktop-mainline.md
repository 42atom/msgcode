# plan-260313-retire-legacy-desktop-mainline

## Problem

`ghost_*` 已经接入成为正式桌面能力面，但 legacy `desktop` 还同时存在于 Tool Bus、slash 路由和 `/tool allow` 里。这样会让系统继续维护两套桌面主链，也继续把 `msgcode-desktopctl` 旧桥放在现役代码结构里。

## Occam Check

- 不加这层，系统具体坏在哪？
  - 不需要加层；真正的问题是旧层还没删，导致桌面能力面有双主链，用户和代码都可能继续走 legacy `desktop`。
- 用更少的层能不能解决？
  - 能。直接删除 `desktop` 的正式工具和 slash 入口，只保留 `ghost_*`。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。桌面执行主链从 `desktop + ghost_*` 双路收口为单一路径 `ghost_*`。

## Decision

选定方案：直接退役 legacy `desktop` 主链。

核心理由：

1. `ghost_*` 已经是正式桌面能力面，继续保留 `desktop` 只会延续历史债。
2. `/desktop` 与 Tool Bus `desktop` 都属于现役入口，删除它们比继续 suppress/legacy 标注更符合做薄原则。
3. 历史文档和源码可以保留到 `.trash`，不需要继续占据主链结构。

## Plan

1. 删除正式工具面
   - 修改 `src/tools/types.ts`
   - 修改 `src/tools/manifest.ts`
   - 修改 `src/tools/bus.ts`
   - 验收：`desktop` 不再是正式工具名，Tool Bus 不再接受它

2. 删除 slash 入口
   - 修改 `src/routes/commands.ts`
   - 修改 `src/routes/cmd-info.ts`
   - 修改 `src/routes/README.md`
   - 将 `src/routes/cmd-desktop.ts`、`src/routes/cmd-desktop-rpc.ts` 移到 `.trash/...`
   - 验收：`/desktop` 不再被解析或帮助显示

3. 删除 tooling 遗留入口
   - 修改 `src/routes/cmd-tooling.ts`
   - 验收：`/tool allow` 不再列 `desktop`，也不再接受它

4. 处理 legacy runner
   - 将 `src/runners/desktop.ts` 移到 `.trash/...`
   - 验收：现役源码目录不再保留 legacy desktop 执行臂

5. 更新测试与文档
   - 修改 `test/tools.bus.test.ts`
   - 修改 `test/routes.commands.test.ts`
   - 修改 `test/p5-6-8-r4g-pi-core-tools.test.ts`
   - 更新 `README.md` 与 `docs/CHANGELOG.md`
   - 验收：测试锁定“ghost_* 是唯一现役桌面能力面”

## Risks

1. 风险：现有少量手工调试仍依赖 `/desktop`
   - 回滚：从 `.trash` 恢复 legacy route/runner；不引入新的 compat 包装层
2. 风险：测试或文档还残留现役 `/desktop` 口径
   - 回滚：先修文档/测试，不恢复主链
3. 风险：误删与历史归档相关的发布记录
   - 回滚：本轮只改现役帮助与现役主链，不清理 release notes 历史记录

（章节级）评审意见：[留空,用户将给出反馈]

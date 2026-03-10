# Plan: default workspace 成为新群的真实初始绑定

Issue: 0051

## Problem
当前“未绑定新群 -> default workspace”只在消息入口成立，未写入 `routes.json`。结果是普通消息能工作，但依赖显式 route 的链路（如 `schedule add`）仍会报“工作区未绑定到任何群组”，用户体验与既定设计冲突。

## Occam Check
- 不加它，系统具体坏在哪？
  - 新群虽然能在 `default` 中聊天，但创建 cron/schedule 会失败，出现“能聊天但不能定时”的断裂。
- 用更少的层能不能解决？
  - 能。直接把 default fallback 写入现有 `routes.json`，不新增 scheduler fallback，不新增新表。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。把“临时 fallback”收口为“真实 route”，让消息链和 schedule 链共用一份真相源。

## Decision
选定方案：当 chat 未命中显式 route、也未命中静态 group 配置时，仍回落到 `default` workspace，但同时把该映射持久化到 `routes.json`。

核心理由：
- 符合“新群默认落地，`/bind` 仅用于切换文件夹”的既定 UX。
- 不给 `schedule` 单独打补丁，避免再造分叉。
- 继续复用现有 RouteStore，保持系统做薄。

## Alternatives
1. 只修 `schedule add`，让它回退读取 workspace `runtime.current_chat_guid`
   - 优点：改动局部。
   - 缺点：继续分叉，普通路由与 schedule 口径不一致。
2. 给 scheduler 增专用 fallback / 自动推断 chat
   - 优点：能修当前症状。
   - 缺点：新增层，违背做薄原则。

推荐：都不选，直接把 default fallback 变成真实 route。

## Plan
1. 修改 `src/router.ts`
   - default fallback 命中时，将 route 持久化到 `routes.json`
   - 显式 route / 静态 group 配置优先级保持不变
2. 补测试
   - `test/p5-7-r13-default-workspace-command-fallback.test.ts`
   - `test/p5-7-r10-workspace-absolute-path-regression.test.ts`
3. 更新 `docs/CHANGELOG.md`
4. 运行针对性测试，记录结果

## Risks
- 风险：未绑定新群会自动写入 route store，`routes.json` 条目会增长。
  - 缓解：这是设计目标本身；后续如需清理，走显式 `/unbind` 或状态归档。
- 风险：静态 group 配置与 default 自动持久化优先级混淆。
  - 缓解：仍保持“显式 route > 静态配置 > default”顺序。

## Rollback
- 回滚 `src/router.ts` 的自动持久化逻辑。
- 删除新增的 default 自动 route 条目，不涉及 schema 迁移。

## Test Plan
- `bun test test/p5-7-r13-default-workspace-command-fallback.test.ts test/p5-7-r10-workspace-absolute-path-regression.test.ts`

评审意见：[留空,用户将给出反馈]

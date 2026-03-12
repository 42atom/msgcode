# default workspace fallback 退出自动持久化

## Problem

当前 `routeByChatId()` 会把“未绑定 chat -> default workspace”这个临时 fallback 直接写成真实 route。这样虽然解决了旧的 schedule 断裂，但系统也因此替用户和模型做了永久路由决定。按照当前主线，default fallback 可以保留为运行时便利，但不能再被系统偷偷升级成真实绑定。

## Occam Check

- 不加它，系统具体坏在哪？
  - 新 chat 一旦触发消息，系统就会把它永久绑定到 `default`，后续 schedule、route store、workspace 历史都建立在一个并非用户显式确认的路由上。
- 用更少的层能不能解决？
  - 能。只删除 `setRoute()`，保留临时 fallback，不新建任何 route 推断层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉“临时 fallback -> 自动持久化真实 route”这条升级旁路，回到“显式 `/bind` 才产生真实 route”的单一主线。

## Decision

选定方案：保留 default workspace 的运行时 fallback，但取消自动持久化。也就是说，聊天仍可在 default workspace 开箱即用；但依赖真实 route 的能力（如 schedule 投递）必须先 `/bind`。

关键理由：

1. 这是最小可删版本，不破坏普通聊天的开箱体验
2. 明确区分“临时运行时 fallback”和“真实持久化绑定”
3. 让系统不再替用户和模型做永久路由决定

## Alternatives

### 方案 A：保留现有自动持久化

- 优点：schedule/add 等显式 route 依赖链继续工作
- 缺点：系统继续代路由，违背当前主线

### 方案 B：取消自动持久化，但保留临时 fallback

- 优点：最小收口，显式边界清楚
- 缺点：未 `/bind` 时，schedule/add 这类链路会重新失败

### 方案 C：连 default fallback 也一起删掉

- 优点：最彻底
- 缺点：开箱即用体验退化更大，不是当前最小切口

推荐：方案 B

## Plan

1. 更新 [src/router.ts](/Users/admin/GitProjects/msgcode/src/router.ts)
   - 删除 default fallback 下的 `setRoute()` 持久化
   - 注释改为“运行时临时 fallback”

2. 更新测试
   - [test/p5-7-r13-default-workspace-command-fallback.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r13-default-workspace-command-fallback.test.ts)
     - fallback 仍存在
     - 但 route store 不应写入
   - [test/p5-7-r10-workspace-absolute-path-regression.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r10-workspace-absolute-path-regression.test.ts)
     - `schedule add` 不再因 default 自动落地而成功
     - 应重新报 `SCHEDULE_WORKSPACE_NOT_FOUND`

3. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

4. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 旧行为曾被当成用户体验优化，一些人会觉得 schedule 变“更严格”了
- 历史文档/issue 里有把它定义成“真实初始绑定”的记录
- 若还有别的链路暗依赖 default 持久化，可能会在这轮暴露

回滚策略：

- 若回归范围过大，可回滚 router 与测试
- 但不应回到“系统自动永久绑定新 chat”的状态作为长期方案

## Test Plan

- routeByChatId 仍返回 default workspace
- getRouteByChatId 在未 `/bind` 时仍返回 `null`
- schedule add 在 default fallback 但未显式 route 时失败闭合

评审意见：[留空,用户将给出反馈]

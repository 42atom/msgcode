# 后 iMessage 时代的通道策略

## Problem

`msgcode` 的真实使用重心已经转向 Feishu，但系统里仍残留大量 `iMessage-first` 假设。继续围绕 `chat.db`、`imsg`、TCC 权限打补丁，只会让主链继续被历史通道牵着走，也不利于将来接入 Telegram、Discord。

## Occam Check

- 不加它，系统具体坏在哪？
  后续每做一个通道相关决策，都会继续被 iMessage 历史包袱拖偏；Feishu 难以真正成为唯一主通道，Telegram/Discord 也会被迫继承旧心智。
- 用更少的层能不能解决？
  能。先冻结方向与边界，不做 transport platform，不做 adapter framework，只保留薄的 channel adapter + 现有统一主链。
- 这个改动让主链数量变多了还是变少了？
  变少了。产品叙事和工程主链都收口为：Feishu 当前主通道，未来再按同一边界接 Telegram / Discord。

## Decision

正式冻结以下方向：

1. **当前唯一主通道：Feishu**
   - 新功能、新 smoke、新稳定性投入优先 Feishu
2. **未来扩展通道：Telegram、Discord**
   - 复用现有路由、附件、schedule、task、workspace 主链
   - 只补“薄的 channel adapter”
3. **iMessage：进入 legacy / sunset 轨道**
   - 停止新增能力投入
   - 不再为 iMessage 单独做新设计
   - 仅在不影响主链的前提下维持兼容，最终逐步退场

## Design Rule

后续通道设计只允许遵守这条最小边界：

- **统一入口对象**：继续围绕现有 `InboundMessage`
- **统一发送能力**：继续围绕现有 `sendClient`
- **统一状态真相源**：route / workspace / task / schedule 不按通道分叉
- **统一附件主链**：图片、语音、文件不为单通道再造独立 pipeline

明确不做：

- 不做 transport platform
- 不做 channel orchestrator
- 不做多层 adapter registry
- 不做“每个通道一套独立调度/路由/记忆系统”

## Phases

### Phase 0: Freeze iMessage

目标：
- 停止新增 iMessage 相关功能与特殊优化
- 任何新需求默认不再以 iMessage 为前提设计

动作：
- 文档、README、package metadata、help 继续收口为 Feishu-first
- 新的 smoke 清单不再以 iMessage 为主验收
- 新 issue 默认不再为 iMessage 单独开新方向

验收：
- 新计划与新文档口径不再使用 `iMessage-first`

### Phase 1: Feishu Harden

目标：
- 把 Feishu 主链打到稳定可长期在线

动作：
- 优先继续收口 Feishu 的：
  - route
  - attachments
  - schedule
  - task / long-running
  - browser handoff
- 把仍然影响 Feishu 主链的 iMessage 假设逐步条件化或移除

重点文件：
- [src/commands.ts](/Users/admin/GitProjects/msgcode/src/commands.ts)
- [src/feishu/transport.ts](/Users/admin/GitProjects/msgcode/src/feishu/transport.ts)
- [src/router.ts](/Users/admin/GitProjects/msgcode/src/router.ts)
- [src/listener.ts](/Users/admin/GitProjects/msgcode/src/listener.ts)

验收：
- daemon / preflight / status / smoke 都以 Feishu 为主链通过

### Phase 2: Channel-Neutral Cleanup

目标：
- 让未来 Telegram / Discord 接入时，不需要再穿过 iMessage 心智

动作：
- 收口仍然 iMessage-centric 的位置：
  - [src/index.ts](/Users/admin/GitProjects/msgcode/src/index.ts)
  - [src/cli.ts](/Users/admin/GitProjects/msgcode/src/cli.ts)
  - [src/config/workspace.ts](/Users/admin/GitProjects/msgcode/src/config/workspace.ts)
  - `src/output/*` 里的 iMessage 文案与长度假设
  - `src/jobs/*` 里的 `imsgSend` 命名
- 命名从 `imsg` 特定口径逐步改成 channel-neutral，但不大爆炸式重写

验收：
- Telegram / Discord 接入前，主链关键命名与 contracts 不再默认假设 iMessage

### Phase 3: Telegram Adapter

目标：
- 接入 Telegram 作为第二主用通道

动作：
- 仅补最薄适配层：
  - 入站消息 -> `InboundMessage`
  - 出站消息 -> `sendClient`
  - 附件映射 -> 现有附件主链
- 不新增平台层

验收：
- Telegram 可以复用 Feishu 同级能力：
  - bind / where / help
  - attachments
  - task / schedule

### Phase 4: Discord Adapter

目标：
- 按同样边界接入 Discord

动作：
- 复用 Telegram 阶段已经验证的 channel-neutral seam

验收：
- Discord 也能走同一主链，不需要额外控制面

### Phase 5: iMessage Sunset

目标：
- 把 iMessage 从主链完全降为 legacy，最终可删除

动作：
- 将 iMessage 相关入口、probe、README、help 彻底移出默认面
- 评估是否移到 `.trash/legacy-imsg/` 或独立兼容包

验收：
- 主仓默认体验不再依赖 iMessage
- 删除 iMessage 后，Feishu / Telegram / Discord 主链仍完整

## Near-Term Priority

最近两轮优先级建议：

1. 继续清理 Feishu 主链中残留的 iMessage 假设
2. 把 `status/preflight/cli/package metadata` 全面收口成 Feishu-first
3. 再做 Telegram 的最小 adapter 方案

不建议现在做：

- Discord 具体实现
- iMessage 大删除
- 设计新的 transport framework

## Risks

- 风险 1：一边说 sunset iMessage，一边继续在 iMessage 上打补丁
  - 缓解：新 issue 默认不再接受 iMessage-only 增量需求
- 风险 2：Telegram / Discord 接入时反而诱发“重做 transport 平台”的冲动
  - 缓解：坚持 `thin adapter + existing mainline`
- 风险 3：旧文档和旧命名继续干扰心智
  - 缓解：按阶段持续清理对外口径和关键内部命名

## Rollback

这是路线冻结文档，本身无代码回滚需求；若后续方向调整，只需回退具体实施批次，不需要回滚本计划文档。

评审意见：[留空,用户将给出反馈]

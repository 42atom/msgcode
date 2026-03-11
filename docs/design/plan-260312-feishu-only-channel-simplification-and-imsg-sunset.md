# Feishu-only 通道简化与 iMessage Sunset

## Problem

`msgcode` 的总路线已经冻结为 Feishu 主通道、iMessage 进入 legacy，但仓库里仍残留一整套 `imsg` 主链假设。只做“Feishu-first”还不够，因为系统默认面、配置面、probe、CLI 和运行时命名还在被 iMessage 牵引。继续拖着这层历史包袱，不利于未来接自有 app / web 客户端。

Issue: 0093

## Occam Check

1. 不加它，系统具体坏在哪？
   - `imsg` 会继续作为隐性主链存在，后续每次改 transport / app / web 接入时，都还要先绕过旧 iMessage 假设。
2. 用更少的层能不能解决？
   - 能。不是加 transport 平台，而是直接删掉 `imsg` 历史主链，保留现有统一主链与更薄的 channel seam。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。运行时从“Feishu + legacy imsg 混合主链”收口成“Feishu-only 主链 + 后续可复用的 channel-neutral 边界”。

## Decision

把 [AIDOCS/reviews/remove-imessage-channel.md](/Users/admin/GitProjects/msgcode/AIDOCS/reviews/remove-imessage-channel.md) 归类为执行输入，并将真正工作拆成两段：

1. **Phase A: Channel-Neutral Cleanup**
   - 先清掉配置、文案、probe、CLI、命名里的 iMessage 默认假设
   - 目标是让未来 app / web client 接入时，不再被 `imsg` 心智绑架
2. **Phase B: iMessage Sunset Execution**
   - 再移除 `src/imsg/`、`vendor/imsg`、相关 runtime 与测试
   - 目标是把 iMessage 从主仓默认面完全降为历史归档

这样比分散地“顺手删一点”更稳，也比一次性大删除更可控。

## Alternatives

### 方案 A：继续保持 Feishu-first，但不正式移除 imsg

- 缺点：历史包袱继续活着，未来 app/web client 接入时仍会到处撞见 `imsg` 特定假设。

### 方案 B：直接一次性删除全部 imsg 代码

- 缺点：跨边界太大，测试、probe、CLI、文档会同时爆，回滚和验收成本过高。

### 方案 C：先做 channel-neutral cleanup，再做 iMessage sunset（推荐）

- 优点：主链更稳，删层顺序清楚，也更符合“为未来自有 app/web 保留薄边界”的目标。

## Plan

1. 收口真相源
   - 继续以 [Issue 0065](/Users/admin/GitProjects/msgcode/issues/0065-post-imessage-channel-strategy.md) 作为总路线
   - 本 plan 只承接执行层
   - [AIDOCS/reviews/remove-imessage-channel.md](/Users/admin/GitProjects/msgcode/AIDOCS/reviews/remove-imessage-channel.md) 仅作为输入清单
2. Phase A: Channel-Neutral Cleanup
   - 先把 `InboundMessage / Attachment / chatId helpers` 提取到 `src/channels/*`
   - `src/imsg/*` 仅保留 legacy compat 壳，避免一次性大删除
   - 清理 `src/config.ts` 中 `IMSG_PATH / IMSG_DB_PATH / MSGCODE_TRANSPORTS` 的默认面假设
   - 清理 `src/cli*`、README、help、package 描述中的 iMessage 主叙事
   - 收口 `src/probe/probes/*` 中对 imsg/chat.db/FDA 的默认依赖
   - 收口 `src/jobs/*`、`src/output/*`、`src/attachments/vault.ts` 中的 iMessage 特化命名和逻辑
3. Phase B: Runtime Removal
   - 移除 `src/imsg/` 主链
   - 清理 `src/index.ts` 等入口对 imsg 的默认依赖
   - 归档 `vendor/imsg`
4. Phase C: Tests and Docs
   - 删除或改写 `imsg` 相关回归测试
   - 保留必要的 sunset / archive 证据
   - 更新 README、docs、CHANGELOG（若实际执行跨边界变更）
5. 验收口径
   - 启动、probe、status、listener、CLI 都不再要求 imsg
   - 默认口径转为 Feishu-only
   - 未来 app/web client 只需要接薄的 channel adapter，不需要绕过 `imsg` 历史层

## Risks

1. 一次牵动配置、probe、CLI、runtime、测试，影响面很大
   - 回滚：按阶段拆 commit，先清默认面与 probe，再删 runtime
2. 把“Feishu-only”做成“Feishu 写死”，反而不利于未来 app/web client
   - 缓解：Phase A 明确目标是 channel-neutral cleanup，不是把 Feishu 特化硬编码进核心
3. 历史文档与 archive 清理不彻底，继续形成第二真相源
   - 缓解：执行时同步做 archive 和 docs 索引更新

## Progress

当前仅完成归类与规划：

- `0065` 继续作为总路线 issue
- `0093` 承接具体执行规划
- `remove-imessage-channel.md` 明确归类为执行输入
- 已完成 Phase A 第一刀：
  - `src/channels/types.ts`
  - `src/channels/chat-id.ts`
  - 主链 imports 已脱离 `src/imsg/*`
  - `src/imsg/types.ts` / `src/imsg/adapter.ts` 暂保留 compat re-export
- 已完成 Phase A 第二刀：
  - 默认 transport 已从 `fallback-imsg` 收口为 `feishu`
  - `config.ts` 不再因缺飞书凭据在 import/load 阶段直接报错
  - `preflight` / `start` 会显式暴露 `FEISHU_APP_ID / FEISHU_APP_SECRET` 缺失
  - transport-aware startup deps 已支持按 `feishu-only / imsg-only / hybrid` 动态提升依赖

（章节级）评审意见：[留空,用户将给出反馈]

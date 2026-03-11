---
id: 0065
title: 后 iMessage 时代的通道策略冻结
status: open
owner: agent
labels: [feature, refactor, docs]
risk: medium
scope: 通道路线图 / Feishu 主通道 / Telegram、Discord 预留边界
plan_doc: docs/design/plan-260310-post-imessage-channel-strategy.md
links: []
---

# Context

用户明确要求：**后续不再考虑 iMessage，把主要投入放在 Feishu，以及将来的 Telegram、Discord。**

当前仓库虽然已经开始转向 `Feishu-first`，但仍有大量 iMessage-centric 历史包袱：

- [src/index.ts](/Users/admin/GitProjects/msgcode/src/index.ts) 仍是 imsg-only 入口
- [src/cli.ts](/Users/admin/GitProjects/msgcode/src/cli.ts) 文案仍以 iMessage 为主
- [src/imsg/](/Users/admin/GitProjects/msgcode/src/imsg/) 仍占据一整套 transport 主链
- [src/config/workspace.ts](/Users/admin/GitProjects/msgcode/src/config/workspace.ts) 的 transport 字段仍只覆盖 `imsg | feishu`
- 多处日志、README、旧研究文档仍残留 `iMessage-first` 心智

如果不先冻结方向，后面很容易继续在 `chat.db`、`imsg`、TCC 权限上消耗时间，反而拖慢 Feishu 和未来通道。

# Goal / Non-Goals

## Goal

- 冻结通道优先级：
  - 当前主通道：Feishu
  - 下一阶段：Telegram
  - 再下一阶段：Discord
  - iMessage：停止新增投入，进入 sunset / legacy 轨道
- 明确未来通道扩展边界，避免继续围绕 iMessage 设计系统
- 给出分阶段实施顺序，方便后续一批批做

## Non-Goals

- 本轮不实现 Telegram / Discord
- 本轮不立即删除所有 iMessage 代码
- 本轮不发明新的 transport platform 或 channel framework

# Plan

- [ ] 冻结产品与工程口径：Feishu 主通道，iMessage 进入 legacy
- [ ] 列出仍然 iMessage-centric 的入口、探针、文案、数据结构
- [ ] 定义 channel-neutral 最小边界，供 Telegram / Discord 后续复用
- [ ] 给出分阶段迁移顺序：Freeze -> Feishu harden -> Telegram -> Discord -> iMessage sunset
- [ ] 明确每阶段的验收口径与非目标

# Acceptance Criteria

- 有一份正式计划文档定义通道优先级与 sunset 路线
- 计划明确哪些地方不再继续为 iMessage 投入
- 计划明确 Telegram / Discord 不靠新增平台层，而是复用现有主链能力

# Notes

- 关键现状位置：
  - `src/index.ts`
  - `src/cli.ts`
  - `src/imsg/`
  - `src/feishu/transport.ts`
  - `src/config/workspace.ts`
  - `src/router.ts`
- 后续执行归类：
  - `AIDOCS/reviews/remove-imessage-channel.md` 属于本 issue 的执行输入，不是新的真相源
  - 具体落地拆分到 [Issue 0093](/Users/admin/GitProjects/msgcode/issues/0093-feishu-only-channel-simplification-and-imsg-sunset.md)

# Links

- [Plan](/Users/admin/GitProjects/msgcode/docs/design/plan-260310-post-imessage-channel-strategy.md)
- [Follow-up](/Users/admin/GitProjects/msgcode/issues/0093-feishu-only-channel-simplification-and-imsg-sunset.md)

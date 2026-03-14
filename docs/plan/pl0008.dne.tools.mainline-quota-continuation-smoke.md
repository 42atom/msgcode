# Plan: Tool Loop 配额续跑真实主流程 Smoke

Issue: 0008

## Problem

`Issue 0007` 当前只剩最后一个阻断项：虽然配额策略、续跑信号、总预算闸门都已存在，但仍缺少一条真实主流程 smoke，来证明这些能力不是只在局部单测里成立。

缺口在于：

1. 现有测试多为基础设施验证
2. 还没有一条明确经过 `/task run -> heartbeat -> 终态` 的最小闭环证据

## Decision

采用“**最小真实主流程 smoke**”方案：

1. 不启动真实定时器循环
2. 通过 `/task run` 创建任务
3. 直接调用 `TaskSupervisor.handleHeartbeatTick()` 作为 heartbeat 驱动
4. 通过模块 mock 控制 `runAgentRoutedChat()` 返回序列

核心理由：

1. 能覆盖主流程边界
2. 不把测试复杂度抬成全系统 e2e
3. 足以为 `0007 done` 提供真实闭环证据

（章节级）评审意见：[留空,用户将给出反馈]

## Plan

1. 新增 smoke 测试文件
   - `test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`

2. 成功链路
   - `/task run`
   - 第 1 轮返回 `continuable=true`
   - heartbeat 驱动第 2 轮
   - verify 成功，状态进入 `completed`

3. 失败链路
   - `/task run`
   - 连续返回 `continuable=true`
   - 总预算耗尽
   - 状态进入 `failed`

4. 跑定向门禁
   - `npx tsc --noEmit`
   - `PATH=\"$HOME/.bun/bin:$PATH\" npm test -- test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`
   - `npm run docs:check`

## Risks

1. 动态 import mock 失败，导致测试不稳定
   - 回滚/降级：若 Bun 模块 mock 不稳定，再退回到更窄的 supervisor 层集成测试

2. 测试越界修改真实配额逻辑
   - 回滚/降级：本单只写测试和文档，不改默认配额

（章节级）评审意见：[留空,用户将给出反馈]

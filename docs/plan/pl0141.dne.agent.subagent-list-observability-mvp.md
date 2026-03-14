# Subagent List Observability MVP

## Problem

当前 `subagent` 只有 `run/status/stop`。  
这已经能跑单任务主链，但仍有一个现实摩擦：

- 主脑或用户需要先记住 `taskId`
- 然后才能继续 `status/stop`

在“一个主脑 + 一个子例程”的薄模型下，这会让观察链不够顺手。

## Occam Check

- 不加它，系统具体坏在哪？
  - 子代理任务启动后，主脑如果没把 `taskId` 保持好，就难以继续观察；这会直接妨碍真实 BDD 中的“委派后持续监控”。
- 用更少的层能不能解决？
  - 能。只加一个 `list` 观测原语即可，不需要 queue / orchestrator / tail。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。它减少了“记 taskId 的隐式状态”，不新增编排主链。

## Decision

选定方案：

- 增加 `msgcode subagent list`
- 保持 `run/status/stop` 不变
- 不新增 `tail`
- 不新增 queue / parallel / orchestrate

设计借鉴 Node.js 异步最佳实践，但只借鉴原则，不照搬实现：

- 句柄化：taskId 是句柄
- 提交与观察分离：run vs list/status
- 调用方编排：主脑自己决定轮询谁
- 背压诚实：busy/running/timeout 照旧

## Plan

- 在 `src/runtime/subagent.ts` 增加 list 函数
- 在 `src/cli/subagent.ts` 增加 `list`
- 更新 `src/cli/help.ts`
- 更新 `src/skills/optional/subagent/SKILL.md`
- 补测试：
  - CLI 合同
  - runtime list 行为
- 做 direct smoke
- 做真实 Feishu BDD 验收

## Risks

- 风险：一旦顺手加 `tail/queue/parallel`，会把观测原语拉成控制面
- 回滚/降级：
  - 保持只加 `list`
  - 若发现 `list` 价值不高，可单独回滚，不影响既有 `run/status/stop`

评审意见：[留空,用户将给出反馈]

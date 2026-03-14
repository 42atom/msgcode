# Plan: 工具调用成功率优先于协议摩擦

Issue: 0017

## Problem

当前系统在工具调用上有两处典型“人为制造失败”：

1. `edit_file` 的 manifest 与执行层合同不一致，模型按说明书调用也会报错。
2. 显式工具偏好把模型锁到单工具路径，`edit_file/browser` 一旦不稳，就先返回 `MODEL_PROTOCOL_FAILED`，而不是让模型改走 `bash` 完成任务。

## Occam Check

- 不加它，系统具体坏在哪？
  模型会因为错误的工具合同和过硬的协议门而失败，真实任务被迫卡死在“没按指定工具调用”而不是“任务没法完成”。
- 用更少的层能不能解决？
  能。直接统一合同，删除单工具强绑，让 `bash` 成为现有工具集里的后备路径，不新增控制层。
- 这个改动让主链数量变多了还是变少了？
  变少了。把“显式工具硬绑定失败 -> 协议判死”收口成“优先专用工具，失败可退回 bash”的单一路径。

## Decision

采用最小修法：

1. `edit_file` 同时支持：
   - `edits: [{ oldText, newText }]`
   - `oldText + newText` 单次简写
2. 对 `edit_file` / `write_file` / `browser` 这类显式工具偏好：
   - 不再只暴露单工具
   - 同时暴露 `bash` 作为后备
3. 模型若返回的是 `bash`，不再按“工具不匹配”直接判死。

## Plan

1. 统一 `edit_file` 合同
- 修改：
  - `src/tools/bus.ts`
  - `src/tools/manifest.ts`
- 验收点：
  - 简写参数可执行

2. 放宽显式工具偏好
- 修改：
  - `src/agent-backend/tool-loop.ts`
- 验收点：
  - `edit_file/write_file/browser` 可退回 `bash`

3. 回归测试
- 修改：
  - `test/p5-6-8-r3b-edit-file-patch.test.ts`
  - `test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`
- 验收点：
  - 定向测试通过

## Risks

1. 过度放宽可能让模型滥用 `bash`。
回滚/降级：仅对 `edit_file/write_file/browser` 允许后备，不对全部工具开放。

2. `edit_file` 简写与数组并存后，参数校验若写坏可能引入歧义。
回滚/降级：先标准化为 `edits[]`，再进入执行体。

## Rollback

- 回退 `tool-loop.ts`、`bus.ts`、`manifest.ts` 本轮改动。

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-8-r3b-edit-file-patch.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3h-tool-failure-diagnostics.test.ts`

## Observability

- 继续使用现有日志观察：
  - `Tool Bus: FAILURE edit_file`
  - `MODEL_PROTOCOL_FAILED`
  - `Tool Bus: SUCCESS bash`

（章节级）评审意见：[留空，用户将给出反馈]

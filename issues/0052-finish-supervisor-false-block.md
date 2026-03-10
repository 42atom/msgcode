---
id: 0052
title: 修复 finish supervisor 误判导致的假失败
status: done
owner: agent
labels: [bug, agent, supervisor]
risk: medium
scope: agent-backend finish supervisor 调用、解析与阻断条件
plan_doc: docs/design/plan-260309-finish-supervisor-false-block.md
links: []
---

## Context

- 2026-03-09 真实日志显示：自然语言创建 schedule 时，前面出现过工具失败，但后续已经补救成功并落盘了 schedule 文件与 jobs 投影。
- 最终用户仍收到 `FINISH_SUPERVISOR_BLOCKED`，阻塞原因为 `监督员未明确放行`。
- 这类情况会让“任务已完成但用户看到失败”，属于高噪音假失败。

## Goal / Non-Goals

- Goal: 找出 finish supervisor 将成功任务误判为阻塞的根因。
- Goal: 让“任务实际已完成”的主链不再因为 supervisor 输出形态问题被误拦。
- Goal: 补足日志与测试，能区分“真实未完成”与“解析/口径误判”。
- Non-Goals: 不修改 scheduler/route/bind 业务逻辑。
- Non-Goals: 不重写整个 supervisor 机制。

## Plan

- [x] 创建 Plan 文档，冻结最小修法
- [x] 审计 `src/agent-backend/tool-loop.ts` 中 supervisor 调用、输出解析、阻断分支
- [x] 核对 minimax/anthropic 兼容 provider 下的 supervisor 返回形态
- [x] 实施最小修复，并增加必要日志
- [x] 补测试，锁住“任务已完成但 supervisor 未明确 PASS”场景
- [x] 运行针对性测试并记录结果

## Acceptance Criteria

1. 已完成的任务不会再因 `监督员未明确放行` 被假阻塞。
2. 若 supervisor 真正认为未完成，仍保留显式阻塞能力。
3. 日志中能看到 supervisor 原始输出或等价证据，便于定位解析问题。
4. 不新增额外控制层，不扩 scope 到其他业务域。

## Notes

- Logs: `/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-09 04:23:45` / `04:23:48`：`Tool Bus: SUCCESS bash`
  - `2026-03-09 04:24:10`：`FINISH_SUPERVISOR_BLOCKED`
  - 同时 `default/.msgcode/schedules/pick-up-kids.json` 与 `~/.config/msgcode/cron/jobs.json` 已存在对应 schedule
- Code:
  - `src/agent-backend/tool-loop.ts`
  - `test/p5-7-r20-minimal-finish-supervisor.test.ts`
  - `test/p5-7-r10-minimax-anthropic-provider.test.ts`
- Tests:
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r20-minimal-finish-supervisor.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts`
  - `13 pass / 0 fail`

## Links

- /Users/admin/GitProjects/msgcode/docs/design/plan-260309-finish-supervisor-false-block.md

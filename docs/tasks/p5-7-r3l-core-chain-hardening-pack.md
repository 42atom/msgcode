# 任务单总整理：P5.7-R3l（核心链路硬化改造包）

优先级：P0（先稳主链，再扩能力）

## 目标（冻结）

1. 建立三核最小实现：`dialog` 只表达、`exec` 只执行、`orchestrator` 只编排。
2. 消除“伪执行回复”风险：tool 路由下无真实 `tool_calls` 必须失败回执。
3. 落地 Exec -> Dialog 的最小状态回写，保证 report 基于事实而非猜测。
4. 保持实现简洁：先双路由（`no-tool`/`tool`），`complex-tool` 先映射 `tool`。

## 子任务顺序（冻结）

1. `P5.7-R3l-1`：协议硬门（toolCallCount=0 禁伪执行）
2. `P5.7-R3l-2`：Prompt 双核拆分（Dialog/Exec）
3. `P5.7-R3l-3`：Plan->Act->Report 管道落地
4. `P5.7-R3l-4`：action_journal 状态回写契约
5. `P5.7-R3l-5`：TTFT 补偿 + 可观测锁

## 依赖关系（冻结）

```text
R3l-1 -> R3l-2 -> R3l-3 -> R3l-4 -> R3l-5
```

## 子任务索引（可直接派发）

1. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3l-1-tool-protocol-hard-gate.md`
2. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3l-2-dialog-exec-prompt-split.md`
3. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3l-3-plan-act-report-pipeline.md`
4. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3l-4-action-journal-state-sync.md`
5. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3l-5-ttft-observability-lock.md`

## 统一硬验收（所有子任务必须满足）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实成功证据：至少 1 条真实工具执行成功
5. 真实失败证据：至少 1 条 `MODEL_PROTOCOL_FAILED` 或 `TOOL_EXEC_FAILED`
6. 无新增 `.only/.skip`

## 提交纪律（统一）

1. 禁止 `git add -A`。
2. 每步隔离提交；单提交改动文件数 > 20 必须拆分。
3. 若发现非本单异常改动，暂停并上报。

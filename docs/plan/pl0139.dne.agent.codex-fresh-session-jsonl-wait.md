# plan-260312-codex-fresh-session-jsonl-wait

## Problem

Codex subagent 在新建 tmux 会话时，会比 Codex JSONL 初始化更快地进入 delegate 分支。当前实现要求 JSONL 立即存在，导致 fresh-session 直接失败，任务文本甚至还没真正发出去。

## Occam Check

- 不加它，系统具体坏在哪？真实 `test-real` 验收里，fresh-session 下 `subagent run codex --watch` 直接报 `SUBAGENT_DELEGATE_FAILED`，任务未发送、产物未落盘。
- 用更少的层能不能解决？能。只要在 codex 分支发任务前短暂等待 JSONL 就绪，不需要新状态中心、队列或恢复器。
- 这个改动让主链数量变多了还是变少了？变少了。删掉“新会话必须立刻已有 JSONL”这条假前提，让 delegate 回到一条正常主链。

## Decision

选择最小修补：

- 仅在 `runnerOld === "codex"` 的 JSONL 选路前增加一个短等待轮询
- 等待窗口内拿到 JSONL 就继续原主链
- 窗口结束仍拿不到时，继续保留原 `SUBAGENT_DELEGATE_FAILED` fail-closed 行为

核心理由：

1. 这是时序修正，不是新层。
2. 不改变 `subagent` 协议和调用方式。
3. 与真实 Codex 行为一致：允许新会话热起来，而不是要求瞬时就绪。

## Plan

1. 在 `src/tmux/responder.ts` 中为 codex JSONL 增加 15s 内的短轮询等待
2. 保持错误消息与现有 fail-closed 语义不变
3. 复跑 responder/subagent 定向测试
4. 在 `/Users/admin/msgcode-workspaces/test-real` 先跑单文件 smoke
5. 再跑贪吃蛇 HTML 项目级 BDD

## Risks

1. 等待窗口过长会拖慢真实失败反馈；回滚/降级：把等待窗口调小或回退该 helper。
2. 新会话若永远不产出 JSONL，仍会失败；回滚/降级：保留现有错误并提示用户 `/start` 后重试。
3. `--watch` 返回的 `response` 仍可能是 Codex 的过程性话术；回滚/降级：验收以任务状态、marker、真实产物为准，不以 `response` 字段单独判定。

## Test Plan

- targeted：
  - `test/tmux.responder.runner.test.ts`
  - `test/p5-7-r37-subagent-runtime.test.ts`
  - `test/p5-7-r36-subagent-cli-contract.test.ts`
  - `test/p5-7-r35-subagent-skill-contract.test.ts`
- 类型：
  - `npx tsc --noEmit`
- 文档：
  - `npm run docs:check`
- 真实：
  - codex 单文件 smoke
  - codex 贪吃蛇 HTML 项目

## Observability

- 任务状态以 `workspace/.msgcode/subagents/*.json` 为真相源
- 真实完成仍以 `MSGCODE_SUBAGENT_DONE <taskId>` 为唯一 marker
- 产物必须实际落盘，不以 pane 文本或 `response` 字段代替

（章节级）评审意见：[留空,用户将给出反馈]

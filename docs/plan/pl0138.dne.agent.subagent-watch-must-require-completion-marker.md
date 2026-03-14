# plan-260312-subagent-watch-must-require-completion-marker

## Problem

`subagent --watch` 当前把“tmux 执行臂已回了同步文本”误判成“子代理任务已完成”。这让 `watch` 失去正式语义：用户和主脑都会看到 `completed`，但真实任务仍在运行，产物也可能尚未齐全。

## Occam Check

- 不加它，系统具体坏在哪？真实 `claude-code` 贪吃蛇任务里，CLI 已返回 `completed`，但 pane 仍停在 `Actualizing…`，`style.css/game.js` 当时尚未落盘。
- 用更少的层能不能解决？能。只要把 `watch` 的成功条件收窄成“必须看到完成标记”，不需要新调度器或新状态中心。
- 这个改动让主链数量变多了还是变少了？变少了。删掉“同步响应=完成”这条假旁路，收口回唯一完成信号。

## Decision

选择最小修复：

- `run --watch` 只认 `MSGCODE_SUBAGENT_DONE/FAILED`
- 若 `handleTmuxSend()` 已返回但还没看到 marker，则继续轮询 pane
- 若到超时仍未看到 marker：
  - task 继续保持 `running`
  - CLI 返回 `SUBAGENT_WATCH_TIMEOUT`
  - 用户/主脑改走 `subagent status`

核心理由：

1. 不改命令协议，只修正错误语义。
2. 不新增层，只删除“假完成”路径。
3. 让 `watch` 真正等同于“监控直到子代理完成”。

## Plan

1. 在 `src/runtime/subagent.ts` 中新增薄轮询 helper：
   - 用 marker 作为唯一完成条件
   - 不再把 `handleTmuxSend().success` 视为任务完成
2. 在 timeout 场景下：
   - 保留 task `running`
   - 返回 `SUBAGENT_WATCH_TIMEOUT`
3. 更新 `test/p5-7-r37-subagent-runtime.test.ts`：
   - 覆盖“先无 marker、后有 marker 才 completed”
   - 覆盖“无 marker 超时仍为 running”
4. 用真实 `claude-code` 重跑贪吃蛇 HTML 项目验收

## Risks

1. 轮询窗口过短会误判超时；回滚/降级：增大 `--timeout-ms`，任务仍可继续用 `status` 观察。
2. 子代理忘记输出 marker，会导致 watch 超时；回滚/降级：主脑/用户通过 `status` 看 pane tail，并修正 delegation 提示词。
3. 长任务 watch 会阻塞更久；回滚/降级：不带 `--watch`，改走 `run + status`。

## Test Plan

- `run --watch` 在 mocked tmux 中必须等待第二次 pane 轮询拿到 marker 后才完成
- 无 marker 时必须抛 `SUBAGENT_WATCH_TIMEOUT`
- 真实 `claude-code` 贪吃蛇任务必须在 `--watch` 返回前产出三文件

## Observability

- task JSON 必须继续记录：
  - `status`
  - `updatedAt`
  - `lastPaneTail`
- 真正完成时才写 `completedAt`

（章节级）评审意见：[留空,用户将给出反馈]

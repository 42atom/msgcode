# plan-260312-subagent-cli-runtime-mvp

## Problem

`subagent` 现在只有 skill 说明书，没有正式程序合同。主脑即使学会了“什么时候该委派”，也没有一条可靠的 `msgcode` 主链把任务派给 `codex` / `claude-code` 并回收状态。继续依赖 bash 字符串拼接会让合同漂回隐式层。

## Occam Check

- 不加它，系统具体坏在哪？主脑只能“知道应该委派”，却没有正式 `subagent` 合同，真实任务会退回 skill 文案和 shell glue，无法做稳定 BDD 验收。
- 用更少的层能不能解决？能。直接复用现有 `TmuxSession`、`handleTmuxSend`、`sendEscape`，只补一个薄 runtime 文件和一个 CLI 域，不新造调度器/队列。
- 这个改动让主链数量变多了还是变少了？变少了。把“skill 说明书 + tmux 隐式用法”收口成单一 `msgcode subagent` 主链。

## Decision

选择最小 `subagent` 正式合同：

- `msgcode subagent run <codex|claude-code> --goal <text> [--workspace <id|path>] [--watch] [--timeout-ms <ms>]`
- `msgcode subagent status <task-id> [--workspace <id|path>]`
- `msgcode subagent stop <task-id> [--workspace <id|path>]`

核心理由：

1. CLI 是正式合同，skill 只负责说明书，不再反客为主。
2. 任务状态只落盘一份 JSON，路径固定在 workspace 下 `.msgcode/subagents/`，没有第二状态中心。
3. 通过显式完成 token 监控 tmux pane，避免再加隐式裁判层。

## Plan

1. 在 `src/runtime/subagent.ts` 实现最小 runtime：
   - 解析 workspace
   - 生成稳定 groupName
   - 任务 JSON 落盘
   - `run/status/stop` 三个原语
   - `run --watch` 基于 tmux pane 轮询完成 token
2. 在 `src/cli/subagent.ts` 增加 CLI 域：
   - 文本输出 + `--json` envelope
   - 合同导出 `getSubagent*Contract`
3. 接到：
   - `src/cli.ts`
   - `src/cli/help.ts`
   - `src/skills/optional/subagent/SKILL.md`
   - `docs/CHANGELOG.md`
4. 增加 targeted tests：
   - CLI 合同测试
   - runtime 薄服务测试（mock tmux）
   - help-docs 暴露测试

## Risks

1. 同一 tmux pane 上并发子任务会互相污染；回滚/降级：同 workspace + 同 client 只允许一个 running task。
2. `claude-code` / `codex` 未安装时任务会失败；回滚/降级：返回明确安装提示，不假装已委派成功。
3. pane marker 检测不稳会导致 watch 误判；回滚/降级：保留 task 状态为 running，由 `status` 继续人工检查，不新增更复杂状态机。

## Test Plan

- `subagent --help` 应只公开 `run/status/stop`
- `help-docs --json` 应暴露三条正式合同
- `run --watch` 在 mocked tmux 下应完成 task 状态闭环
- `status/stop` 应复用同一 task 文件

## Observability

- task JSON 记录：
  - `taskId`
  - `client`
  - `status`
  - `groupName`
  - `sessionName`
  - `marker`
  - `createdAt/updatedAt/completedAt`
- `status` 返回最新 pane tail，帮助主脑/用户判断进展

（章节级）评审意见：[留空,用户将给出反馈]

# plan-260313-desktop-legacy-runner-one-shot-cli

## Problem

legacy desktop runner 仍然在 `msgcode` 内部维护 `DesktopSessionPool`、长驻 `msgcode-desktopctl session` 进程、请求队列和 idle 清理逻辑。这让 msgcode 又替外部桥接命令加了一层状态控制面。既然 `msgcode-desktopctl` 已经提供单次 `rpc` 命令，runner 最薄形态就应是“一次请求 -> 一次 CLI -> 返回 stdout/stderr/artifacts”。

## Occam Check

### 不加它，系统具体坏在哪？

- `desktop` legacy runner 继续自带 session 池和状态机
- 后续替换开源 desktop 实现时，先要拆 msgcode 自己这层历史状态壳
- `desktop` 作为遗留链路仍然过厚，不像普通外部命令桥

### 用更少的层能不能解决？

- 能。直接调用 `msgcode-desktopctl rpc`，不维护 session 池

### 这个改动让主链数量变多了还是变少了？

- 变少了。legacy desktop runner 从“runner + session pool + child queue”收成单次 CLI 主链

## Decision

选定方案：把 `src/runners/desktop.ts` 收口为单次 `msgcode-desktopctl rpc` 调用。

- 保留 desktopctl 路径发现
- 保留 stdout/stderr/exitCode 结果合同
- 保留 evidence artifact 解析
- 删除 session 池、队列、idle 清理器

## Plan

1. 修改 `/Users/admin/GitProjects/msgcode/src/runners/desktop.ts`
   - 删除 `DesktopSessionPool`、`SessionState`、NDJSON 处理
   - 增加单次 CLI 调用 helper
2. 维持 `/Users/admin/GitProjects/msgcode/src/tools/bus.ts` 现有 `runDesktopTool()` 调用面不变
3. 跑测试
   - `/Users/admin/GitProjects/msgcode/test/tools.bus.test.ts`
   - `/Users/admin/GitProjects/msgcode/test/routes.commands.test.ts`
4. 更新 `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`
5. 提交

## Risks

1. 某些历史行为若暗依赖 session 复用，可能暴露为性能下降而不是合同回归
   - 回滚：恢复 session 池实现，但不恢复更多解释层
2. timeout/kill 处理若不完整，可能留下子进程
   - 回滚：恢复当前实现，或补单次进程 timeout 收口

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts test/routes.commands.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]

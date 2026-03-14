# scheduler refresh 风暴诊断与最小收口

## Problem

`msgcode.log` 在 `2026-03-08 03:17:51` 到 `03:17:55` 连续打印大量 `[Scheduler] 已刷新` 与 `[Scheduler] 下次唤醒`。目前日志没有 refresh 来源，也没有 jobs 路径维度，无法区分是正式 daemon 内部重复触发，还是测试/热加载链路把独立 scheduler 实例写进了同一个正式日志文件。

## Occam Check

1. 不加这次改动，系统具体坏在哪？
   当前表现为 refresh 风暴，带来无意义的 wake/rearm、日志噪音，以及对正式运行时状态的误判。
2. 用更少的层能不能解决？
   可以。先给现有 refresh 链路补来源证据，再删除多余调用点或隔离污染源；不新增新的调度层。
3. 这个改动让主链数量变多了还是变少了？
   目标是减少重复 refresh 来源，回到单一 mutation -> refresh 主链。

## Decision

采用“两步最小法”：

1. 先在现有 `refresh` 主链上补来源标签与关键上下文，不先改行为。
2. 复现实验后只修真实来源：
   - 若是正式链重复调用，删重或合并同一事务内的 refresh。
   - 若是测试/热加载污染，隔离测试日志，避免把测试 scheduler 写进正式 `msgcode.log`。

核心理由：

1. 现有显式 refresh 调用点很少，先补证据成本最低。
2. 风暴片段同时出现 `已停止/已启动/jobs.json 不存在`，高度怀疑不是单一正式 scheduler；证据不足前不能靠猜测删调用点。
3. 如果根因是测试污染，改 scheduler 行为反而会误伤主链。

最终结论：

1. 风暴来源是测试污染，不是正式 scheduler 主链级联 refresh。
2. 正式 daemon 在重启后的 add/remove smoke 中只出现一次 `start` 与各一次 `signal:SIGUSR2` refresh，没有复现风暴。
3. 最小修复是隔离测试文件日志，并补齐正式 refresh reason 证据。

## Alternatives

### 方案 A：直接加 debounce

不选。它会掩盖重复来源，无法回答“谁在重复触发”，也可能吞掉本来必要的 refresh。

### 方案 B：直接删掉部分 refresh 调用点

不选。当前还没有证据证明是哪个入口重复触发，直接删存在误删必要 refresh 的风险。

## Plan

1. 更新 `src/jobs/scheduler.ts`
   - `refresh(reason = "unknown")`
   - `armTimer(reason = "unknown")`
   - 记录 `reason`、`jobCount`、`jobsPath`、`running`、`rearmed`
2. 更新 refresh 入口
   - `src/jobs/schedule-sync.ts`
   - `src/commands.ts`
   - `src/cli/schedule.ts`
   - `src/routes/cmd-schedule.ts`
   - 所有调用点显式传 reason
3. 做两组最小复现
   - 正式 daemon：重启 -> add schedule -> remove schedule
   - 定向测试：运行 scheduler/schedule 相关测试并观察是否污染正式日志
4. 基于证据做最小修复
   - 若为测试污染：隔离测试文件日志
   - 若为正式链重复：删重或合并同事务 refresh
5. 补回归测试
   - 至少锁住单次 mutation 不会级联多次有效 refresh，或锁住测试不会污染正式日志

## Risks

1. 观测日志若过重会继续放大噪音。
   - 回滚：保留 `reason` 字段但删额外上下文。
2. 若误把测试污染当正式故障，会下错刀。
   - 回滚：先保留证据提交，再单独调整修复。
3. 调整 logger 默认行为可能影响依赖文件日志的测试。
   - 降级：仅在 `NODE_ENV=test` 且未显式设置 `LOG_FILE` 时关闭文件日志。

## Test Plan

1. `bun test` 定向回归：
   - `test/p5-7-r18-schedule-refresh-on-mutation.test.ts`
   - 新增 refresh 来源/日志隔离测试
2. 真机 smoke：
   - `./bin/msgcode restart`
   - 创建 `live-cron`
   - 删除 `live-cron`
   - 检查 `msgcode.log`、`jobs.json`、`runs.jsonl`

## Observability

新增 refresh reason 与 jobsPath 维度，便于区分：

1. `start`
2. `signal:SIGUSR2`
3. `schedule-sync:add:*`
4. `schedule-sync:remove:*`
5. `schedule-sync:enable:*`
6. `schedule-sync:disable:*`
7. `schedule-sync:reload:*`

评审意见：[留空,用户将给出反馈]

# P5.6.10：Runtime 硬化收口（Review v2 响应单）

## 背景

外部审查指出 3 个高价值改进点：

1. `src/tools/bus.ts` 体量过大（上帝类，>1100 行）
2. CLI 冷启动缺少可观测指标（TTI 不可见）
3. 崩溃告警单通道依赖 iMessage（告警可能“哑巴”）

本单作为 `P5.6.9` 后续收口，目标是降低维护风险与线上不可观测风险。

## 目标

1. 拆解 `bus.ts`：执行器、会话池、编排分层，保留单一入口。
2. 增加 CLI 冷启动遥测：可量化 import/init 耗时与 TTI。
3. 增加崩溃兜底通道：`sendAlert` 失败时落盘 `crash.log`。

## 范围

- `src/tools/bus.ts`
- `src/tools/runners/*`（新增）
- `src/runtime/session-pool.ts`（新增）
- `src/cli/run.ts`（冷启动埋点）
- `src/index.ts`（崩溃兜底）
- `test/*`（对应回归锁）
- `docs/tasks/README.md`（索引同步）

## 非范围

- 不新增业务工具能力
- 不改工具权限策略语义
- 不改 direct/tmux 双管道契约

## 分阶段实施

### R1：Tool Bus 解耦（P0）

- 提取 `DesktopSessionPool` -> `src/runtime/session-pool.ts`
- 提取工具执行分支 -> `src/tools/runners/`（如 `bash-runner.ts`、`file-runner.ts`）
- `bus.ts` 只保留：
  - `canExecuteTool`
  - 统一路由分发
  - 遥测入口与错误包装

### R2：CLI 冷启动遥测（P1）

- 在 `src/cli/run.ts` 增加启动埋点（import/init/ready）
- 输出 TTI 指标（建议毫秒级）
- 阈值建议：`>200ms` 给出 warning 日志

### R3：崩溃告警备用通道（P0）

- 在 `src/index.ts` 的 `sendAlert` 失败分支增加 fallback：
  - 写入 `~/.config/msgcode/crash.log`
  - 若 daemon 模式下文件写失败，至少输出 `stderr`
- 保留原 iMessage 告警，不替换，只补兜底

### R4：回归锁（P0）

- Tool Bus 解耦后行为一致性测试
- CLI 冷启动埋点存在性测试
- 崩溃 fallback 写盘测试（模拟 `imsgClient.send` 失败）

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 体量收口 | `src/tools/bus.ts` 明显下降且职责单一 | ✅ |
| 告警兜底 | `sendAlert` 失败仍可留痕 | ✅ |

## 约束

- 小步提交，禁止一把梭大改
- 每阶段必须单独可回滚
- 零语义漂移优先于“漂亮重构”

## 交付物

- 迁移映射表（`bus.ts` -> 新模块）
- CLI 冷启动指标样例
- 崩溃 fallback 日志样例
- 三门验收日志

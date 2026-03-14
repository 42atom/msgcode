# 任务单：P5.7-R10（可用性稳定化派单包）

优先级：P0（影响真实使用成功率）

## 背景

最近主链冒烟发现 3 个可用性阻断：

1. `memory add` 后若未手动执行 `memory index`，`memory search` 可能返回 0。
2. `thread` 命令缺少 `--workspace` 维度，真实多工作区排障成本高。
3. `gen image` 遇到区域限制时缺少可恢复降级路径，用户只能手工切后端。

## 目标（冻结）

1. 消除 `memory` 的“手动补索引”心智负担（零手工索引可召回）。
2. 补齐 `thread` 与 `memory/todo/schedule` 的 workspace 参数一致性。
3. 为 `gen image` 增加可诊断、可降级的提供方链路（不因单供应商失败中断）。

## 子任务顺序（冻结）

1. `P5.7-R10-1`：memory 零手工索引召回
2. `P5.7-R10-2`：thread workspace 作用域补齐
3. `P5.7-R10-3`：gen image 提供方降级与诊断

## 依赖关系（冻结）

```text
R10-1 -> R10-2 -> R10-3
```

## 子任务索引（可直接派发）

1. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r10-1-memory-zero-touch-recall.md`
2. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r10-2-thread-workspace-scope-parity.md`
3. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r10-3-gen-image-provider-fallback-diagnostics.md`

## 统一硬验收（所有子任务必须满足）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 至少 1 条真实成功证据 + 1 条真实失败证据（错误码固定可断言）
5. 无新增 `.only/.skip`
6. 行为断言优先，禁止源码字符串脆弱锁

## 提交纪律（统一）

1. 禁止 `git add -A`
2. 每步隔离提交；每提交只包含当前子单必要文件
3. 发现非本单改动，暂停并上报

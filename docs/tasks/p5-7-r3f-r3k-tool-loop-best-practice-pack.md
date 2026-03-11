# 任务单总整理：P5.7-R3f ~ R3k（Tool Loop 最佳实践改造包）

优先级：P0（先稳工具链，再扩能力面）

## 目标（冻结）

1. 全面吸收 `pi-mono` 工具链实践：可中断、可流式、可诊断、多工具闭环。
2. 修复当前 `msgcode` 工具链四类高风险缺口：孤儿进程、单工具瓶颈、大输出失控、失败不可归因。
3. 在不回流 `run_skill` 的前提下，固化 `agent` 工具主链可用性。

## 子任务顺序（冻结）

1. `P5.7-R3f`：Bash Runner 工程化（可中断 + 流式 + 截断落盘）
2. `P5.7-R3g`：Tool Loop 多工具闭环（单轮顺序执行 + 步数上限）
3. `P5.7-R3h`：失败合同与诊断增强（统一 error envelope）
4. `P5.7-R3i`：文件权限策略分层（workspace/unrestricted）
5. `P5.7-R3j`：双模型路由稳定化（executor/responder 强分流）
6. `P5.7-R3k`：Tool Loop SLO 门禁落地（smoke + 指标降级）

## 依赖关系（冻结）

```text
R3f -> R3g -> R3h -> R3i -> R3j -> R3k
```

## 子任务单索引（可直接派发）

1. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3f-bash-runner-engineering.md`
2. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3g-tool-loop-multi-call-closure.md`
3. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3h-tool-failure-contract-diagnostics.md`
4. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3i-fs-scope-policy-layering.md`
5. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3j-dual-model-routing-stabilization.md`
6. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3k-tool-loop-slo-gate.md`

## 统一硬验收（所有子任务必须满足）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `msgcode help-docs --json`（若命令合同有变化必须同步）
5. 至少 1 条真实成功证据（非 mock）
6. 至少 1 条真实失败证据（非 mock，错误码可断言）
7. 无新增 `.only/.skip`

## 提交纪律（统一）

1. 禁止 `git add -A`。
2. 每步隔离提交；单提交改动文件数 > 20 必须拆分。
3. 仅提交本单范围文件，其他改动保持隔离。
4. 若发现非本单异常改动，暂停并上报。

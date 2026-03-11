# 任务单：P5.7-R3k（Tool Loop SLO 门禁落地）

优先级：P1（稳定性收口）

## 目标（冻结）

1. 建立 Tool Loop 三指标门禁：
   - `R1`：工具命中率
   - `R2`：可展示回答率
   - `E2E`：端到端成功率
2. 明确“20-case = smoke gate”，SLO 使用连续流量统计，不与小样本混用。
3. 指标低于阈值时自动触发降级策略（安全模型或纯文本模式）。

## 范围

- `docs/product/msgcode-tool-loop-slo-v1.md`
- `scripts/*tool-loop*`（若需新增统计脚本）
- `test/*p5-7-r3k*.test.ts`（新增门禁回归锁）
- `AIDOCS/reports/*`（结果样例）

## 非范围

1. 不改核心工具执行逻辑（R3f~R3h 已处理）。
2. 不新增业务能力命令。
3. 不改 tmux 链路行为。

## 指标口径（冻结）

1. `R1` 分母：标注为“需要工具”的请求集（必须可复现标注来源）。
2. `R2` 分母：进入二轮收口的请求。
3. `E2E` 分母：全量评测请求。
4. 20-case 只做 smoke：用于每日健康检查，不直接判定高精度 SLO。

## 实施步骤（每步一提交）

### R3k-1：文档口径修复

提交建议：`docs(p5.7-r3k): fix slo metric definitions and sample policy`

1. 修复失败合同字段一致性。
2. 修复 20-case 与高精度阈值的统计冲突。
3. 统一工具命名（`read_file/write_file/edit_file/bash`）。

### R3k-2：门禁脚本

提交建议：`feat(p5.7-r3k): add smoke and slo gate scripts`

1. 日常 smoke 20-case 脚本。
2. 周期性统计脚本（连续数据）。

### R3k-3：降级策略接线

提交建议：`feat(p5.7-r3k): add auto-degrade strategy on slo breach`

1. 低阈值触发降级标记。
2. 记录降级原因与恢复条件。

### R3k-4：回归锁

提交建议：`test(p5.7-r3k): add slo gate regression lock`

1. 指标口径一致性测试。
2. 低阈值触发降级测试。
3. 结果报表字段完整性测试。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. smoke 报表可生成
5. SLO 统计口径可复现
6. 低阈值降级可触发
7. 无新增 `.only/.skip`

## 验收回传模板

```md
# P5.7-R3k 验收报告

## 提交
- <sha> <message>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- smoke gate (20-case):
- slo stats (continuous):
- auto-degrade:
```

## 回链

- Issue: issues/0007-tool-loop-quota-strategy.md
- Plan: docs/design/plan-260306-tool-loop-quota-strategy.md

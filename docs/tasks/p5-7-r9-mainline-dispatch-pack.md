# 任务单：P5.7-R9 主线派单包（T2 → T3 → T4）

优先级：P0（连续会话能力 + 架构语义收敛）

## 基线（已完成）

1. `R9-T1` 已签收（8 场景 PASS）。
2. `R9-T1-hotfix` 已签收：`4e30eac`
   - Tool Loop skills 来源锁为 global-only
   - 回归锁：`test/p5-7-r9-t2-skill-global-single-source.test.ts`

## 执行顺序（冻结）

1. `R9-T2`：上下文余量感知 + 70% 自动 compact  
   - 文档：`docs/tasks/p5-7-r9-t2-context-budget-auto-compact.md`
2. `R9-T3`：记忆默认开启 + `/clear` 边界硬锁  
   - 文档：`docs/tasks/p5-7-r9-t3-memory-default-on-pi-baseline-and-branch-convergence.md`
3. `R9-T4`：`lmstudio` 命名去耦为 `agent-backend`  
   - 文档：`docs/tasks/p5-7-r9-t4-agent-backend-neutral-naming-refactor.md`

禁止并行跨单改动：必须前一单全绿签收后再开下一单。

## 派单口径（统一）

每一单必须提交以下证据：

1. 提交列表（按步骤一提交）
2. 变更文件清单
3. 三门结果：
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`
4. 关键行为证据（日志或回归锁断言）
5. 未完成项与风险清单（若有）

## Gate 失败即停（冻结）

出现以下任一情况，立即停止并回报，不得继续叠改：

1. `npm test` 非 0 fail
2. 引入新的源码字符串脆弱断言
3. 回退 `R9-T1-hotfix` 的 global-only skill 口径
4. 记忆链路出现“重启/切模丢会话”回归

## 分支约束（冻结）

1. 收敛分支：`codex/p5-7-r9-mainline-convergence`
2. 禁止 `git add -A`
3. 每步只提交本单相关文件


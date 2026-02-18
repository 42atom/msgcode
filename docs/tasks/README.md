# 任务单索引（主线冻结）

## P5 主线顺序（冻结）

1. `P5.4-R2`：Autonomous Skill 默认主路径收敛（自然语言触发优先）
2. `P5.5`：Skill 编排主线收敛（LLM 决策 + `tool_calls(run_skill)`）
3. `P5.6.1`：运行时内核收敛（`handlers` 只做路由/编排入口）
4. `P5.6.2`：模型执行层三分（协议适配 / tool loop / 输出清洗）
5. `P5.6.3`：Skill 执行单一真相源（自动触发与 `/skill run` 同执行器）
6. `P5.6.4`：状态域边界化（window/pending/memory，`/clear` 只清短期）
7. `P5.6.5`：命令层最终瘦身（`commands.ts` 只留注册+分发+fallback）
8. `P5.6.6`：测试 DI 化与回归锁固化

## 当前任务单

- `p5-5-skill-orchestration-toolcalls.md`：P5.5（按最新冻结口径执行）

## 规则

- 任何插单只能是技术债，不得改变主线顺序。
- 每个任务结束必须提交并给出三门验收（`tsc` / `test` / `docs:check`）。
- 未签收任务不得进入下一阶段。

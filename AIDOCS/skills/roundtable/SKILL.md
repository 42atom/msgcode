---
name: roundtable
description: 多视角决策分析与共识收敛。触发时机：方案评估、风险审查、预算/投资判断、不可逆决策评审、唱反调压力测试、历史复盘对照。
---

# 圆桌决策 (roundtable)

## 触发时机

- 需要在多个可选方案中做决策
- 需要提前暴露 downside、执行风险、隐藏假设
- 涉及预算、ROI、成本收益测算
- 涉及不可逆或高风险改动
- 用户明确要求“唱唱反调”或“翻旧账”

## 输入协议

最小输入：
- 任务：一句话目标
- 约束：时间/预算/资源/合规边界
- 候选方案：A/B/C（可为空，允许先生成）

可选输入：
- 风险等级：low|medium|high
- 是否财务敏感：yes|no
- 是否不可逆：yes|no
- 历史案例：issue/doc/commit/事故记录

## 角色池（可扩展）

| 角色 | 关注点 | 典型问题 |
|------|--------|----------|
| RiskGuardian | 风险、downside、防御 | 最坏会发生什么，如何止损 |
| GrowthStrategist | 增长、机会、ROI | 哪个方案的增长杠杆最大 |
| SkepticalOperator | 质疑假设、执行现实 | 这个计划在真实环境能跑起来吗 |
| DevilsAdvocate（严格教官） | 反方论证、压力测试 | 如果该方案失败，最先断在哪里 |
| HistorianAnalyst（历史管理员） | 历史复盘、路径依赖 | 过去类似决策为何成败 |
| FinanceAnalyst | 成本结构、现金流、回报 | 单位经济模型是否成立 |
| SystemsArchitect | 边界划分、复杂度控制 | 是否引入长期结构性负担 |
| ProductStrategist | 需求价值、用户收益 | 真正问题是否被命中 |
| UserAdvocate | 用户体验、可用性 | 用户会在哪一步流失 |
| ExecutionLead | 落地路径、资源排布 | 最小可行落地路线是什么 |
| ComplianceCounsel | 合规、审计、政策 | 是否触碰红线 |
| OperationsSRE | 稳定性、可观测性、回滚 | 出问题后如何快速恢复 |

## 选人规则

基础规则：
- 默认选择 3-4 人
- 必含 1 个“业务导向”角色 + 1 个“风险导向”角色 + 1 个“执行导向”角色

强制规则：
- `high_risk`：选择 6 人以上，且必须包含 `RiskGuardian`
- `financial=yes`：必须包含 `FinanceAnalyst`
- `irreversible=yes`：必须包含 `DevilsAdvocate（严格教官）`
- 用户说“唱唱反调”：强制加入 `DevilsAdvocate（严格教官）`
- 用户说“翻旧账”：强制加入 `HistorianAnalyst（历史管理员）`

任务类型到初始角色：
- 需求/功能：`ProductStrategist` + `UserAdvocate` + `ExecutionLead`
- Bug/稳定性：`RiskGuardian` + `OperationsSRE` + `SkepticalOperator`
- 架构/重构：`SystemsArchitect` + `ExecutionLead` + `SkepticalOperator`
- 增长/商业化：`GrowthStrategist` + `FinanceAnalyst` + `UserAdvocate`

冲突消解：
- 角色重复时去重
- 强制规则优先于默认人数
- 总人数上限建议 8 人，避免讨论失焦

## 讨论流程（一轮）

步骤 1：问题定标
- 明确目标、非目标、判定标准
- 若信息不足，先列缺失证据，不直接拍板

步骤 2：角色陈述（并行）
- 每个角色输出 3 点：
  - 关键判断
  - 最大担忧/机会
  - 推荐动作（做/不做/条件做）

步骤 3：交叉质询（单轮）
- 每个角色只提 1 个最关键反问
- 优先攻击高不确定性假设

步骤 4：共识收敛（Consensus）
- 产出单一建议；若无法统一，产出“主张 A / 主张 B”及触发条件

## 输出模板（纯文本）

```text
Decision:
- Recommendation: go | hold | pivot
- Confidence: low | medium | high
- Scope: 影响范围一句话

Why:
- 支持该建议的前三条证据

Risks:
1) ...
2) ...
3) ...

Guardrails:
- 前置条件:
- 监控指标:
- 回滚条件:

Next Actions:
1) ...
2) ...
3) ...

Evidence:
- Docs: <文档名/章节>
- Code: <路径 + 关键符号>
- Tests: <命令 + 关键输出>
- Logs: <关键字段/片段>
```

## 执行约束

- 不做无证据结论；证据优先级：官方文档 > 源码定位 > 测试输出 > 日志
- 讨论只进行一轮，避免无限拉扯
- 当共识不足时，输出最小补证实验，不强行给唯一答案

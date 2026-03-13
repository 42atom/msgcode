# plan-260313-ghost-skill-risk-confirmation-guidance

## Problem

`ghost_*` 现在已经是现役桌面能力面。是否要为高风险动作加 confirm gate，结论已经明确：不新增执行层拦截，而是把风险确认责任放回 skill 与用户交互层。但当前这条原则还没有被写死在 `ghost` skill、系统 prompt 和 README 中。

## Occam Check

- 不加它，系统具体坏在哪？
  - 不会立刻坏，但口径不冻结，后续很容易因为“安全感”再回流 confirm gate 或其他执行层控制面。
- 用更少的层能不能解决？
  - 能。直接改 skill、prompt 和 README，不改执行层。
- 这个改动让主链数量变多了还是变少了？
  - 不增加主链；只是把约束收口到说明书，避免未来新增 gate。

## Decision

选定方案：用 skill / prompt 约束 `ghost_*` 的高风险语义，不做 confirm gate。

核心理由：

1. 项目目标是把整台电脑交给 LLM，不再用系统执行层把能力切碎。
2. 高风险动作的“先问用户”属于说明书约束，不应上升成新的控制层。
3. 没有真实人类授权闭环时，confirm gate 很容易退化成假安全和新债务。

## Plan

1. 更新 `src/skills/runtime/ghost-mcp/SKILL.md`
   - 明确哪些动作是高风险动作
   - 明确默认先向用户确认
   - 明确这不是系统 gate，而是执行约束

2. 更新 `prompts/agents-prompt.md`
   - 增加 `ghost_*` 高风险动作的口径
   - 明确不要发明系统级 confirm gate

3. 更新 `src/skills/README.md` / `README.md`
   - 对齐 skill-first 约束原则
   - 说明能力面保留完整，但高风险动作先问用户

4. 增加回归锁
   - 新增 `ghost` skill 合同测试
   - 必要时补 system prompt 断言

## Risks

1. 风险：文案写得过重，重新变成软 gate
   - 回滚：删掉会让模型误以为“必须等系统批准”的句子，只保留“先询问用户”
2. 风险：文案写得太轻，失去约束价值
   - 回滚：加强高风险动作列举与反例，但不改执行层

（章节级）评审意见：[留空,用户将给出反馈]

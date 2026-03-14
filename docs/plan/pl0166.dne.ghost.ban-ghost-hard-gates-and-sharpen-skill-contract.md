# plan-260313-ban-ghost-hard-gates-and-sharpen-skill-contract

## Problem

`ghost_*` 现已是桌面主链。风险边界已经决定走 skill / prompt 的语义契约路线，但仓库级 AGENTS 还没有把“不要自作多情写代码拦截”写成硬规则，`ghost` skill 的风险文案也还不够锋利，不足以形成稳定约束。

## Occam Check

- 不加它，系统具体坏在哪？
  - 不会立即坏，但执行同学后续很容易又因为“安全感”回流 confirm gate 或别的硬编码拦截。
- 用更少的层能不能解决？
  - 能。只改 AGENTS、skill、prompt/test，不动执行层。
- 这个改动让主链数量变多了还是变少了？
  - 不增加主链；它是在阻止未来增加新主链和新控制层。

## Decision

选定方案：把“安全边界优先写进 skill 契约，不写执行层硬拦截”写入仓库铁律，并把 `ghost` skill 的风险段落锐化。

核心理由：

1. 项目目标是薄脑，不是薄能力。
2. `ghost_*` 已经是完整能力面，再回流硬拦截就是再次自缚手脚。
3. 对高风险动作，最该变硬的是文案和责任，不是代码 gate。

## Plan

1. 更新 `AGENTS.md`
   - 加入禁止为 ghost 自作多情新增执行层 gate 的硬规则
   - 明确先写 skill 契约，再谈代码变更

2. 锐化 `src/skills/runtime/ghost-mcp/SKILL.md`
   - 写清高风险动作的典型灾难
   - 写清责任归属：模型先问用户，不是系统替用户做主
   - 写清“点得准”不等于“做得对”

3. 更新回归锁与 changelog
   - 强化 `test/p5-7-r38-ghost-mcp-skill-guidance.test.ts`
   - 更新 `docs/CHANGELOG.md`

## Risks

1. 风险：文案过度煽情，变成空洞口号
   - 回滚：保留锋利，但必须可执行、可判断、可验证
2. 风险：文案不够明确，不能有效阻止回流 gate
   - 回滚：继续加强责任和后果描述，但仍不改执行层

（章节级）评审意见：[留空,用户将给出反馈]

# Skill Live Testing Cognition Gate

## Problem

现在的真实 skill 验收，如果直接跳到“让主脑完成任务”，会把多个问题混成一团：

- skill 根本没同步到运行时
- 主脑没看到 skill
- 主脑没去读 skill
- 主脑读了但没理解正式合同
- 真正的执行链 bug

这会让 live BDD 很难定位失败根因。

## Occam Check

- 不加它，系统具体坏在哪？
  - skill 测试一旦失败，无法快速区分“说明书暴露失败”和“执行链失败”，真实例子就是 `subagent` 第一次 Feishu 验收先卡在 skill 未同步。
- 用更少的层能不能解决？
  - 能。只需要在现有 live corpus / Feishu BDD 文档前面加一层固定前置问题，不需要新框架。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。先把认知问题单独排除，避免后面把所有失败都混进执行链。

## Decision

选定方案：所有 skill 的真实测试统一采用两阶段协议：

1. 认知关
2. 执行关

认知关的目标不是“考试”，而是先确认主脑：

- 看得到 skill
- 读得到 skill
- 读懂了正式合同
- 能按预期解释自己下一步会如何做

只有认知关通过，才进入完整执行关。

## Plan

- 在 `AIDOCS/prompts/skill-live-prompt-corpus-v1.md` 新增“前置认知关”
- 在 `AIDOCS/prompts/feishu-live-bdd-acceptance-suite-v1.md` 新增“统一前置关卡”
- 用 `subagent` 的真实 Feishu case 作为协议样例

## Risks

- 风险：如果把认知关写得太长，会变成新的流程负担
- 回滚/降级：
  - 保持最小协议，只要求 3-4 个固定问题
  - 不引入新框架，不新增新目录

评审意见：[留空,用户将给出反馈]

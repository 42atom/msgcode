# 群聊记忆调用与技能发现收口

## Problem

群聊里模型会把 `memory` 错当成工具名发起 tool call，导致记忆检索失败；同时 repo 内置 optional skill 没有汇总到运行时主索引，模型默认发现性偏弱。

## Occam Check

- 不加它，系统具体坏在哪？
  群聊继续出现 `TOOL_NOT_ALLOWED: memory`，可选技能虽然已内置和同步，但模型默认看不到，等于半失效。
- 用更少的层能不能解决？
  能。只改提示词和运行时索引汇总，不新增工具层或技能平台。
- 这个改动让主链数量变多了还是变少了？
  变少了。把技能发现收口到单一主索引，减少“主索引 + optional 索引二选一”的分叉心智。

## Decision

采用最薄方案：

1. 提示词明确 `memory` 不是工具名，必须走 skill/CLI 主链
2. `runtime-sync` 在保留 `optional/` 目录的同时，把 optional 摘要汇总进主索引
3. optional skill 继续保留 `layer: optional` 标记，作为按需加载能力，而不是常驻上下文

## Plan

1. 修改 [prompts/agents-prompt.md](/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md)
2. 修改 [src/skills/runtime-sync.ts](/Users/admin/GitProjects/msgcode/src/skills/runtime-sync.ts)
3. 更新测试：
   - [test/p5-7-r13-runtime-skill-sync.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r13-runtime-skill-sync.test.ts)
   - [test/p5-7-r3n-system-prompt-file-ref.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3n-system-prompt-file-ref.test.ts)
4. 同步运行时 skill 目录
5. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

## Risks

- 风险 1：optional 摘要并入主索引后，被误解成“默认全加载”
  - 缓解：保留 `layer: optional`，并在提示词中继续声明“按需读取”
- 风险 2：旧用户索引里仍有历史 skill 项
  - 缓解：本轮只收口 discoverability，不顺手重构 skill provenance
- 风险 3：模型仍可能偶发把 skill 名当工具名
  - 缓解：提示词明确禁止，并通过回归锁保持该口径

## Rollback

- 回退 `prompts/agents-prompt.md`
- 回退 `src/skills/runtime-sync.ts`
- 回退相关测试与 changelog

评审意见：[留空,用户将给出反馈]

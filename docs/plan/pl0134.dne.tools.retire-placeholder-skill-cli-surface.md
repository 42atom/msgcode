# plan-260312-retire-placeholder-skill-cli-surface

## Problem

`msgcode skill` 当前仍是可执行命令，但它没有提供真实能力，只会输出“功能待实现”。这会让程序公开面继续携带一个假合同，与“程序是真合同、skill 是说明书”的主线冲突。

## Occam Check

### 1. 不加它，系统具体坏在哪？

- 用户和模型都可能把 `msgcode skill` 误判为正式可用合同
- 程序公开面继续暴露一个不存在的能力入口

### 2. 用更少的层能不能解决？

- 能。直接把它降为 retired compat shell 即可
- 不需要新增 skill 管理层

### 3. 这个改动让主链数量变多了还是变少了？

- 变少了。它消灭的是“假合同”和“真实合同”并行的歧义

## Decision

推荐方案：**保留 `skill/skills` 名字，只作为显式 retired compat shell。**

理由：

1. 向后兼容仍在
2. 不再伪装成真实能力
3. 迁移口径清晰：程序合同看 `help-docs`，runtime skill 看 `SKILL.md`

## Plan

1. 把 `src/cli/skills.ts` 改成 retired shell：
   - `skill --help` 只展示退役说明
   - `skill ...` 一律返回非 0 和迁移提示
2. 补测试：
   - `skill --help`
   - `skill run demo`
   - `skills run demo`
3. 更新 `0132` 命令面审计表与 changelog

## Risks

- 风险低
- 回滚：恢复原占位子命令定义即可

## 评审意见

[留空,用户将给出反馈]

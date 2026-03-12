# plan-260313-retire-system-info-auto-skill

## Problem

`msgcode` 刚刚退掉了 `system` CLI 包装层，但 repo 侧仍保留 `system-info` auto skill：

- 它会把“系统信息 / system info”自然语言命中成内置 skill
- 它会在进程内返回一份拼装后的系统信息文本

这条链和已退役的 `msgcode system info` 属于同一类问题：没有桥接新的能力边界，只是在替原生 shell 做主。

## Occam Check

### 不加它，系统具体坏在哪？

- “系统信息”仍存在一条系统内置捷径，继续污染能力边界
- prompt 说“系统操作走原生 shell”，仓库却暗地里保留 auto skill，口径不一致

### 用更少的层能不能解决？

- 能。直接退役 `system-info` auto skill，不新增任何替代层
- 真需要系统信息时，交回原生 `bash`

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是 repo 内的一条兼容捷径链

## Decision

选定方案：退役 `system-info` auto skill，把系统信息查询完全交回原生 shell。

核心理由：

1. 这条 skill 没有桥接新能力，不值得占用常驻认知面
2. 删除后，仓库“系统操作走原生能力”的口径才能真正闭环
3. 保留 retired compat 提示即可，不需要恢复另一条新主链

## Plan

1. 更新 `src/skills/auto.ts`
   - `detectAutoSkill()` 不再命中 `system-info`
   - `normalizeSkillId()` 不再把 `system-info` 视为现役 skill
   - `runSkill()` 对 `system-info` 返回 retired 错误与 shell 迁移提示

2. 更新 `src/skills/index.ts` 与 `src/skills/types.ts`
   - 去掉“repo 侧仅保留 system-info 兼容链”的现役表述
   - 改成“repo 侧 auto skill 已退役，仅保留最小兼容接口”

3. 更新 `src/skills/README.md`
   - 不再把 `auto.ts` 描述为“仅保留 system-info”
   - 改成 retired compat 口径

4. 更新测试
   - `test/skills.auto.test.ts`
   - `test/p5-6-7-r6-smoke-static.test.ts`
   - 如需，更新 `test/handlers.runtime-kernel.test.ts` 里的文案预期

## Risks

1. 历史测试或说明书仍假设 `system-info` 现役；回滚/降级：保留 compat 错误返回，不恢复自动执行

## Test Plan

- `detectAutoSkill("系统信息") === null`
- `normalizeSkillId("system-info") === null`
- `runSkill("system-info", ...)` 返回 retired 错误
- `npx tsc --noEmit`

（章节级）评审意见：[留空,用户将给出反馈]

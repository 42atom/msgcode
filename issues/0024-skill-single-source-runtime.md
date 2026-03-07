---
id: 0024
title: Skill 单真相源收口 - runtime 为唯一正式真相源
status: done
owner: agent
labels: [refactoring, skills, architecture]
risk: medium
scope: src/skills/, prompts/agents-prompt.md
plan_doc: docs/design/plan-260308-skill-single-source-runtime.md
links:
  - /Users/admin/GitProjects/msgcode/src/skills/runtime/index.json
  - /Users/admin/GitProjects/msgcode/src/skills/registry.ts
created: 2026-03-08
due:
---

## Context

- 当前存在两套 skill 体系：
  - runtime skills (`src/skills/runtime/*`) - 正式真相源
  - builtin registry (`src/skills/registry.ts`) - 历史遗留
- builtin registry 中仍包含 `schedule-skill`/`browser-skill` 等描述，容易误导为现役执行通道
- `runSkill()` 若仍是 TODO，占位语义必须明确退役

## Goal / Non-Goals

### Goals
- 明确 runtime skills 是唯一正式真相源
- 退役 builtin registry 的现役语义
- 清理误导性文案/注释
- 补测试锁住 single-source 口径

### Non-Goals
- 不重构整个 skill 框架
- 不删除所有历史 skill 代码
- 不改 scheduler/browser/memory 业务逻辑
- 不新增 skill 控制层或路由层

## Plan

- [x] 创建 issue + plan 文档
- [x] 盘点两套 skill 体系的实际职责
- [ ] 收正式口径（README/registry.ts/prompt）
- [ ] 测试补齐
- [ ] 全文搜索确认
- [ ] 提交 commit

## Notes

### 盘点结果（2026-03-08）

**runtime skills** (`src/skills/runtime/`) - ✅ 正式真相源
- `runtime/index.json` - 只有 2 个技能：`scheduler` 和 `patchright-browser`
- `runtime-sync.ts` - 同步到用户目录
- 测试 `p5-7-r13-runtime-skill-sync.test.ts` 锁住了同步行为

**builtin registry** (`src/skills/registry.ts`) - ⚠️ 历史占位（需退役）
- 包含 10 个技能描述，但 `runSkill()` 只是 TODO 占位
- `getSkillIndex()` 和 `detectSkillMatch()` 仍被导出，但主链已不再使用
- `handlers.ts` 中已经注释掉了相关导入

**skill-orchestrator.ts** - ✅ 已收敛
- `getSkillIndex()` 只返回 `system-info`
- 不再依赖 `registry.ts`

**测试** - ✅ 锁住了 single-source
- `p5-7-r9-t2-skill-global-single-source.test.ts` 验证 Tool Loop 只读取全局 skills
- 但需要补充测试锁住"builtin registry 不再被当作正式 skill 来源"

### 问题点

1. `registry.ts` 仍包含完整的 builtin skills 注册表，文案暗示为"现役执行通道"
2. `README.md` 中 `registry.ts` 被描述为"技能注册、发现、检测、路由分发"
3. `schedule-skill`/`browser-skill` 描述与 runtime skill 重复
4. `index.ts` 仍在导出 `registry.ts` 的内容，可能误导后人

## Occam Check

1. **不收口会坏在哪里？**
   - 两套 skill 体系并存，模型/新人无法判断哪份是真相源
   - builtin registry 中的 `schedule-skill`/`browser-skill` 描述与 runtime skill 重复，可能误导调用
   - `runSkill()` 若被误判为现役执行通道，可能导致错误集成

2. **为什么 builtin registry 不能继续作为另一份"准真相源"？**
   - skill 发现/加载主链已经收敛到 runtime (`runtime/index.json` + `runtime-sync.ts`)
   - builtin registry 无实际加载逻辑，仅为历史占位
   - 维持两份"准真相"会增加认知成本，且无收益

3. **本轮怎么在不大重构的前提下减少主链数量？**
   - 不改架构，只改文案语义
   - 明确标注 builtin registry 为"历史占位/非正式索引"
   - 删除/修改暗示"现役执行通道"的注释

## Acceptance Criteria

1. runtime skills 被明确为唯一正式真相源
2. builtin registry 不再被文案或代码暗示为现役执行主链
3. 测试锁住 single-source 口径
4. 不新增新的框架层

## Notes

### 已知坑

1. 不要把"退役 registry"误做成"删除一切旧代码"
2. 重点是去掉现役语义，不是大扫除
3. `registry.ts` 里还有 `schedule-skill/browser-skill` 等描述，最容易继续误导
4. 如果某处还真实依赖 registry，必须先指出，再决定是迁还是标注

## Links

- Issue 0022: Scheduler skill + bash 主链收口
- Plan: docs/design/plan-260308-skill-single-source-runtime.md

# Plan: Skill 单真相源收口 - runtime 为唯一正式真相源

## Problem

当前 skill 体系存在两份"准真相源"：

1. **runtime skills** (`src/skills/runtime/`)
   - `runtime/index.json` - 正式 skill 索引
   - `runtime/scheduler/`, `runtime/browser/` 等 - skill 定义
   - `runtime-sync.ts` - 同步到用户目录

2. **builtin registry** (`src/skills/registry.ts`)
   - 包含 `schedule-skill`/`browser-skill` 等描述
   - 无实际加载逻辑，为历史占位
   - 文案暗示为"现役执行通道"

**断裂点**：
- 模型/新人无法判断哪份是真相源
- builtin registry 的描述与 runtime skill 重复，可能误导调用
- `runSkill()` 若被误判为现役执行通道，可能导致错误集成

**约束**：
- 不大重构 skill 框架
- 不删除历史代码，只退役现役语义

## Occam Check

1. **不收口会坏在哪里？**
   - 两套 skill 体系并存，认知负担重
   - 可能错误调用已退役的 builtin skill
   - 新人/模型无法判断真相源

2. **为什么 builtin registry 不能继续作为另一份"准真相源"？**
   - skill 发现/加载主链已经收敛到 runtime
   - builtin registry 无实际加载逻辑
   - 维持两份"准真相"会增加认知成本，且无收益

3. **本轮怎么在不大重构的前提下减少主链数量？**
   - 不改架构，只改文案语义
   - 明确标注 builtin registry 为"历史占位/非正式索引"
   - 删除/修改暗示"现役执行通道"的注释

## Decision

**选型：runtime skills 为唯一正式真相源**

核心理由：
1. runtime 已经有完整的发现/加载/同步机制
2. builtin registry 仅为历史占位，无实际加载逻辑
3. 单真相源减少认知负担

**不选另一条的理由**：
- 若保留 builtin registry 为"准真相"，继续模糊边界
- 本轮目标是收口，不是维持现状

## Plan

### 步骤 1：盘点两套 skill 体系的实际职责

**盘点范围**：
- `src/skills/runtime/*`
- `src/skills/registry.ts`
- `src/skills/runtime-sync.ts`
- `prompts/agents-prompt.md`
- 测试文件

**重点回答**：
- 哪些地方真的在读取 runtime skill
- 哪些地方只是历史 registry / 占位能力描述
- 哪些 prompt/注释还在模糊这两者

### 步骤 2：收正式口径

**改动文件**：
- `src/skills/README.md` - 明确 runtime 为唯一真相源
- `src/skills/registry.ts` - 标注为历史占位/非正式索引
- `prompts/agents-prompt.md` - 更新 skill 引用口径

**目标**：
- 明写 runtime skills 是唯一正式真相源
- builtin registry 若保留，只能是历史/占位/非正式索引
- `runSkill()` 若仍是 TODO，占位语义必须明确退役

### 步骤 3：测试补齐

**改动文件**：
- `test/p5-7-r13-runtime-skill-sync.test.ts`
- `test/p5-7-r9-t2-skill-global-single-source.test.ts`

**验收点**：
- runtime sync 后用户目录以 runtime/index.json 为准
- prompt / 注入 / 文档不再把 builtin registry 当正式 skill 来源
- 旧 `pinchtab-browser` 这类 retired skill 不会重新变成正式入口

### 步骤 4：全文搜索确认

**搜索关键词**：
- `builtinSkills`
- `schedule-skill`
- `browser-skill`
- `runSkill(`
- `runtime skill`

**目标**：
- 确认正式口径不再含混
- 发现潜在的遗漏点

### 步骤 5：提交

**Commit message**：
```
feat(skills): 收口 skill 双真相源，runtime 为唯一正式真相源
```

## Risks

### 主要风险

1. **误删现役代码**
   - 风险：把仍在使用的 builtin registry 逻辑误删
   - 缓解：先搜索引用，确认无现役依赖再退役

2. **文案修改不彻底**
   - 风险：仍有注释/文档暗示 builtin registry 为现役
   - 缓解：全文搜索关键词，逐一确认

3. **测试覆盖不足**
   - 风险：single-source 口径无测试锁住
   - 缓解：补充/修改现有测试

## Alternatives

### 方案 B：完全删除 builtin registry

**描述**：
- 删除 `src/skills/registry.ts`
- 删除所有 builtin skill 描述

**优缺点**：
- 优点：彻底清理
- 缺点：可能破坏历史引用，风险较大

**决策**：本轮不采用，只退役语义，不删除代码

## Test Plan

1. runtime sync 测试：
   - 用户目录以 runtime/index.json 为准
   - builtin skill 不会被同步

2. single-source 测试：
   - prompt / 注入 / 文档不再引用 builtin registry
   - retired skill 不会重新变成正式入口

## Observability

无运行时行为变化，不需要额外日志

---

**评审意见**：[留空，用户将给出反馈]

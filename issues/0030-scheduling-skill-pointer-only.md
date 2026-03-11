---
id: 0030
title: 收口定时任务口径：skill pointer-only，不再暗示 cron 为内建能力
status: done
owner: agent
labels: [refactor, agent, docs]
risk: medium
scope: prompt、scheduler skill、manifest
plan_doc: docs/design/plan-260308-scheduling-skill-pointer-only.md
links: []
---

## Context

当前 scheduler skill 主要描述 `cron` 风格实现，但一次性任务（如"明天早上10点看看天气预报并回报给我"）并不适合被压成 cron 模型。系统如果继续把 schedule/cron 暗示成内建能力，会误导 LLM 走错误实现。

## Goal / Non-Goals

### Goal

1. 修改 prompt（agents-prompt.md）遇到定时任务时只提示去 runtime skills 目录读取对应 skill，不再暗示内建 schedule/cron 能力
2. 修改 scheduler skill 明确它是参考 skill，不是唯一实现
3. 清理 manifest / 文档中对 schedule/cron 的过强注入语气
4. 补测试锁住"pointer-only"口径

### Non-Goals

1. 不重构 scheduler 引擎
2. 不改 tmux / chat delivery 主链
3. 不新增一次性 at 任务系统
4. 不新增新的 LLM tool
5. 不做 prompt 分层实验

## Plan

- [ ] 创建 plan 文档
- [ ] 盘点当前哪些地方在暗示"定时任务是系统内建能力"
- [ ] 修改 agents-prompt.md 文案，明确 pointer-only
- [ ] 修改 scheduler/SKILL.md，明确是参考实现
- [ ] 验证 index.json 描述是否符合 pointer-only 原则
- [ ] 补测试锁住 pointer-only 口径

## Acceptance Criteria

1. 系统 prompt 只指向 skills 目录，不再注入 schedule/cron 固定实现
2. scheduler skill 明确是参考 skill，不冒充唯一实现
3. 测试锁住 pointer-only 口径

## Notes

### 证据

- agents-prompt.md 第70行：scheduler 描述
- scheduler/SKILL.md：cron 风格实现
- manifest.ts 第511行：cron 禁止名单

### Occam Check

1. 不加这次改动，系统具体坏在哪？
   - 会继续把不完整的 cron 能力误注入为通用定时能力，导致 LLM 选错实现

2. 用更少的层能不能解决？
   - 只保留 skill 指路，不做系统内建编排

3. 这个改动让主链数量变多了还是变少了？
   - 减少系统内建流程假设，回到"LLM 读 skill 自主执行"的单一主链

## Links

- /Users/admin/GitProjects/msgcode/prompts/agents-prompt.md
- /Users/admin/GitProjects/msgcode/src/skills/runtime/scheduler/SKILL.md
- /Users/admin/GitProjects/msgcode/src/tools/manifest.ts
- /Users/admin/GitProjects/msgcode/issues/0028-llm-unshackle.md

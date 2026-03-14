# Plan: 收口定时任务口径 - skill pointer-only

## Problem

当前 scheduler skill 主要描述 `cron` 风格实现，但一次性任务（如"明天早上10点看看天气预报并回报给我"）并不适合被压成 cron 模型。系统如果继续把 schedule/cron 暗示成内建能力，会误导 LLM 走错误实现。

## Occam Check

1. **不加它，系统具体坏在哪？**
   - 会继续把不完整的 cron 能力误注入为通用定时能力，导致 LLM 选错实现

2. **用更少的层能不能解决？**
   - 推荐答案：只保留 skill 指路，不做系统内建编排

3. **这个改动让主链数量变多了还是变少了？**
   - 目标：减少系统内建流程假设，回到"LLM 读 skill 自主执行"的单一主链

## Decision

选定方案：**pointer-only + 参考 skill 说明**

核心理由：
- 系统只负责告诉 LLM skills 目录位置，不预设实现方式
- scheduler skill 明确为"可参考的实现方式之一"
- 一次性任务由 LLM 根据环境自行决定实现（cron/at/launchd/bash 等）

## Plan

### Step 1: 修改 agents-prompt.md

**文件**：`prompts/agents-prompt.md`

**当前第70行**：
```
scheduler：定时任务。先读 ~/.config/msgcode/skills/scheduler/SKILL.md，再用 bash 调用 scheduler skill
```

**修改为**（更明确 pointer-only）：
```
scheduler：定时任务相关。先读 ~/.config/msgcode/skills/scheduler/SKILL.md，由 skill 描述决定实现方式（周期任务用 cron / 一次性任务自行选择实现）
```

### Step 2: 修改 scheduler/SKILL.md

**文件**：`src/skills/runtime/scheduler/SKILL.md`

**添加说明**：
- 明确这是"参考实现之一"，不是唯一方式
- 添加一次性任务（如"明早10点"）的说明，由 LLM 自行选择实现

**文案调整**：
- 标题下方增加：`本 skill 是参考实现，不是唯一方式。周期任务可用 cron；一次性任务请根据环境自行选择实现（at/launchd/定时脚本等）。`
- 常用命令部分保留，但明确是"周期任务示例"

### Step 3: 验证 index.json

**文件**：`src/skills/runtime/index.json`

**当前**：
```
"description": "定时任务与 cron 的 skill + bash 主链，走 msgcode schedule CLI"
```

**建议改为**：
```
"description": "定时任务 skill 参考实现，周期任务走 msgcode schedule CLI，一次性任务由 LLM 自行决定实现"
```

### Step 4: 验证 manifest.ts

**文件**：`src/tools/manifest.ts`

**当前第511行**：
```
- 重要边界：skill 名不是工具名。禁止把 file、memory、thread、todo、cron、media、gen、banana-pro-image-gen 当作工具名。
```

**保持不变**（已经是正确认知：cron 不是工具，是 skill）

### Step 5: 补测试

**测试目标**：验证 prompt 只指向 skills 目录，不再暗示内建 cron 能力

**测试方式**：
- 检查 agents-prompt.md 不包含"cron 是内建能力"等表述
- 检查 scheduler/SKILL.md 包含"参考实现"说明

## Risks

1. **风险**：修改后 LLM 可能不知道具体怎么实现定时任务
   - **缓解**：skill 里有完整示例，LLM 读取后自行决定

2. **风险**：一次性任务场景没有现成 CLI
   - **缓解**：这是 LLM 自己的事情，系统不负责替它选实现

## Rollback

如需回滚：
- 恢复 agents-prompt.md 第70行文案
- 删除 scheduler/SKILL.md 中的"参考实现"说明
- 恢复 index.json 描述

## Test Plan

1. 读取修改后的 agents-prompt.md，确认 scheduler 描述符合 pointer-only
2. 读取修改后的 scheduler/SKILL.md，确认包含"参考实现"说明
3. grep 检查项目中不再有"cron 是内建"等误导性表述

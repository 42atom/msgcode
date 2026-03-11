# Plan: 详细视觉能力迁到 skill 层，系统只保留图片预览摘要

Issue: 0054

## Problem

当前图片主链虽然已经把自动层收口为“只做摘要预览”，但详细视觉能力仍停留在 runtime `vision` 工具里。这会导致系统继续吸收供应商差异、重试策略和模型特判：GPT 原生看图、GLM MCP、本地 LM Studio 脚本都会被迫映射到同一个 runtime 视觉合同。最近的表格图片事故已经说明，这类设计会让系统再次越权，替模型决定“该怎么读图”“该如何重试”“该走哪个供应商”。

## Occam Check

- 不加这次改动，系统具体坏在哪？
  - 每新增或切换一个视觉供应商，都要继续改 `vision` runtime 和 tool contract；同类“系统先替模型裁任务”问题会反复出现。
- 用更少的层能不能解决？
  - 可以。系统层只保留图片预览摘要；详细视觉能力迁到 skill，用说明书指导模型自己选择供应商和调用方式。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。系统主链收口为单一“图片 intake -> 预览摘要”；详细视觉退出 runtime 主链，不再在系统里做第二套供应商控制面。

## Alternatives

### 方案 A：继续保留 runtime `vision`，不断加供应商适配

优点：
- 现有调用点最少变更
- 对当前测试改动较小

缺点：
- 供应商差异持续进入系统层
- GPT 原生看图、GLM MCP、本地脚本会继续堆成多分支控制逻辑
- 与“系统做薄、skill 增强模型能力”的原则冲突

### 方案 B：保留 runtime `vision` 作为统一壳，底层再分发到不同供应商

优点：
- 模型看到的工具名稳定
- 供应商可在内部切换

缺点：
- 本质仍是视觉供应商编排层
- runtime 仍要决定 provider selection / retry / fallback
- 系统仍在替模型做详细视觉任务决策

### 方案 C：系统只保留图片预览摘要，详细视觉迁到 skill 层

优点：
- 最符合“说明书增强模型能力”的路线
- 供应商差异收口到 skill，不继续污染 runtime 主链
- 后续扩 GPT 原生看图、GLM MCP、本地脚本都只需加/改 skill

缺点：
- 需要调整现有 `vision` 工具暴露与相关测试
- 需要补 runtime skill 与 discoverability 文案

## Decision

选择方案 C。

核心理由：

1. 系统层职责应稳定在“图片收口与预览”，而不是“详细视觉执行控制”。
2. 视觉供应商差异本质上属于能力说明书问题，不应继续堆进 runtime。
3. 这条路线最贴合当前项目北极星：统一内核、共享基础能力、通过 skill/soul/preset 形成不同交付。

## Plan

1. 冻结系统边界
   - 文件：
     - `src/listener.ts`
     - `src/media/pipeline.ts`
     - `src/runners/vision.ts`
   - 调整：
     - 系统只保留图片 intake、落盘、预览摘要
     - 图片-only 场景不再伪造 `"请用一句话概括主要内容。"`
     - `vision.ts` 明确降级为“预览摘要内部实现”，不再承担 LLM 正式详细视觉合同
   - 验收：
     - 图片主链代码中不再把详细视觉任务描述注入为系统默认问题

2. 退出 `vision` 的 LLM 正式工具暴露
   - 文件：
     - `src/tools/manifest.ts`
     - `src/config/workspace.ts`
     - `src/routes/cmd-tooling.ts`
     - `src/tools/types.ts`（按阶段决定是否仅保留 internal）
   - 调整：
     - `vision` 不再作为 LLM 正式暴露工具
     - 默认 `tooling.allow` 与 `/tool allow` 用户口径不再把 `vision` 当常规工具
     - 若短期仍保留 internal 执行实现，只允许 `media-pipeline/internal` 使用
   - 验收：
     - LLM 工具索引中不再出现 `vision`

3. 建立 skill-first 视觉能力层
   - 文件：
     - `src/skills/runtime/index.json`
     - 新增 `src/skills/runtime/vision-index/SKILL.md`
     - 新增 provider-specific runtime skill（至少本地 LM Studio、ZAI MCP）
   - 调整：
     - `vision-index` 只做 provider-neutral 指路：
       - 若当前模型原生支持图片输入，优先原生看图
       - 若有 GLM MCP，按 skill 调 MCP
       - 若有本地 LM Studio，按 skill 用 `bash` 调脚本
     - provider-specific skill 只教模型如何调用，不在系统层做统一控制
   - 验收：
     - skill 文案中明确“何时使用、如何调用、失败如何与用户沟通”

4. 迁移与兼容
   - 文件：
     - 相关测试
     - issue / plan / skill 文档
   - 调整：
     - 旧 workspace 中残留的 `vision` allow 暂不强制迁移，可先视为无效暴露项
     - 旧测试中依赖 `vision` 为 LLM 工具的断言改为 internal / preview 口径
     - `0053` 标记为“自动摘要主链已完成，但详细视觉策略被 `0054` supersede”
   - 验收：
     - 迁移后不引入双主链：系统预览摘要一条、skill 详细视觉一条

## Risks

1. 迁移期会同时存在“内部 preview vision”和“skill 详细 vision”两种表述
   - 回滚/降级：短期在文档中明确 internal vs skill 边界，避免同时对外暴露两个正式入口

2. 旧 workspace / 旧帮助文案仍可能把 `vision` 当成可用 LLM 工具
   - 回滚/降级：先收口 tool manifest 与 `/tool` 文案，再做配置清理

3. 图片-only 场景若直接取消默认问题，用户可感知行为会变化
   - 回滚/降级：先改为“直接展示预览摘要”或“仅把预览摘要交给模型，不伪造问题”，不一次性做更多行为变化

4. 还有同类越权点未收
   - 例子：ASR 默认强制中文转写
   - 回滚/降级：本计划只记为下一轮队列，不在本轮扩 scope

## Migration / Rollout

1. Phase 1：文档与边界冻结
   - 冻结“系统摘要 / skill 详细视觉”口径
   - 记录旧 `vision` 工具的退场策略

2. Phase 2：先退暴露，再补 skill
   - 先让 LLM 不再把 `vision` 当正式工具
   - 再把 provider-specific skill 接进 runtime skills 索引

3. Phase 3：清理旧残影
   - 清理 `/tool allow vision`、旧帮助文案、旧测试中的正式暴露假设

## Test Plan

- 行为测试：
  - 图片-only 场景不再伪造默认问题
  - LLM 工具索引不再暴露 `vision`
  - runtime skills 索引可发现 `vision-index`
- 回归测试：
  - 自动图片预览摘要仍正常生成
  - 旧附件落盘 / artifact 路径不回归

评审意见：[留空,用户将给出反馈]

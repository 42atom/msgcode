# 移除 getToolsForLlm 的隐藏工具基线

## Problem

`getToolsForLlm()` 当前在两种场景下都会偷偷把 `[read_file, bash, help_docs]` 拼回工具列表：

1. `workspacePath` 为空时
2. workspace 显式配置了 `tooling.allow` 时

这会让 `tooling.allow` 不再是唯一真相源，模型实际看到的工具面和配置声明的工具面出现漂移。

## Occam Check

- 不加这次改动，系统具体坏在哪？
  - 用户和模型配置的工具面是一套，执行核实际暴露的又是一套，`tooling.allow` 无法精确表达边界。
- 用更少的层能不能解决？
  - 能。直接删掉隐藏基线拼接，只保留“显式配置用显式配置，缺省时回退默认配置”这一条主链。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。工具暴露只剩 `tooling.allow -> manifest/filter -> exposedTools` 一条路径。

## Decision

选定方案：删除 `getToolsForLlm()` 中的 `[read_file, bash, help_docs]` 隐藏并集逻辑。

核心理由：

1. 默认基线已经在 `DEFAULT_WORKSPACE_CONFIG["tooling.allow"]` 中，不需要再补一层
2. workspace 显式配置时，执行核不应再偷偷扩权
3. 这样才能让工具面真正统一，符合单一真相源

## Plan

1. 修改 `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
   - `getToolsForLlm(undefined)` 直接读取默认配置
   - `getToolsForLlm(workspacePath)` 在显式 `tooling.allow` 时不再拼隐藏基线
2. 更新测试
   - `/Users/admin/GitProjects/msgcode/test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts`
   - `/Users/admin/GitProjects/msgcode/test/p5-7-r8c-llm-tool-manifest-single-source.test.ts`
3. 更新
   - `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`
4. 运行验证
   - `bun test test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts test/p5-7-r8c-llm-tool-manifest-single-source.test.ts test/p5-7-r15-agent-read-skill-bridge.test.ts`
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 风险：少数旧测试或旧 workspace 习惯依赖“显式只放一个工具，但系统会偷偷补 read/bash/help”
  - 应对：把这类行为定义为历史漂移，测试改锁新真相源

回滚/降级策略：

- 如发现误伤，可直接回滚该 commit，恢复隐藏基线拼接

评审意见：[留空,用户将给出反馈]

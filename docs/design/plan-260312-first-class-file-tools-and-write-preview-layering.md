# 恢复 write_file/edit_file 为第一公民并下沉写改预览

## Problem

当前 runtime 的文件主链仍带着旧收口策略：

- `write_file/edit_file` 已有实现，但默认被 suppress
- `bash` 被迫承担隐式文件写改总线
- 写改成功后的回灌没有执行层 preview，tool-loop 只能回灌原始 JSON

这不是能力不足，而是骨架没有收正。系统一边保留原生文件工具，一边默认不让模型看到它们，等于继续让 `bash` 吞掉第一公民能力面。

## Occam Check

- 不加它，系统具体坏在哪？
  - 模型默认主链仍会把文件写改绕到 `bash`，即使 `write_file/edit_file` 已存在；工具面继续不统一，输出层也继续让写改结果走原始 JSON 回灌。
- 用更少的层能不能解决？
  - 能。不是加新工具层，而是把已存在的 `write_file/edit_file` 恢复为默认暴露，并让执行层自己生成 preview。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。文件写改不再需要“原生工具存在但默认隐藏，再靠 bash 兜底”这条暗旁路。

## Decision

选定方案：取消 `write_file/edit_file` 的默认 suppress，把它们恢复到默认 `tooling.allow` / `getToolsForLlm()` 主链；同时为写改结果补执行层 previewText，让 tool-loop 继续只转运执行层产物。

关键理由：

1. `write_file/edit_file` 已实现且有回归测试，继续隐藏只会制造折返
2. `bash` 仍保留，但退回通用 shell，不再被预设为文件写改总入口
3. preview 下沉到执行层，能继续减少 tool-loop 对写改结果的呈现介入

## Plan

1. 恢复默认文件工具面
   - `src/tools/manifest.ts`：从默认 suppress 列表移除 `write_file/edit_file`
   - `src/config/workspace.ts`：默认 `tooling.allow` 加入 `write_file/edit_file`
   - `src/routes/cmd-tooling.ts`：加入用户可见工具列表
2. 收口执行提示
   - `src/agent-backend/tool-loop.ts`：原生工具优先提示里明确文件写改优先 `write_file/edit_file`
3. 下沉写改 preview
   - `src/tools/bus.ts`：为 `write_file/edit_file` 构造 `previewText`
   - `src/tools/types.ts`：必要时补充写改结果数据字段
4. 更新回归锁
   - `test/p5-7-r8c-llm-tool-manifest-single-source.test.ts`
   - `test/p5-7-r15-agent-read-skill-bridge.test.ts`
   - `test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`
   - 以及默认工具面相关测试

## Risks

1. 模型可能过度偏好 `write_file/edit_file`，少量原先依赖 `bash` 的测试会翻红  
   回滚：重新 suppress 并回退默认 allow
2. 老文档与旧 changelog 仍记录“默认文件主链收口为 read_file + bash”  
   回滚：恢复原说明，但需同时回退实现

## Test Plan

- `bun test test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts test/p5-7-r8c-llm-tool-manifest-single-source.test.ts test/p5-7-r15-agent-read-skill-bridge.test.ts test/p5-6-8-r4g-pi-core-tools.test.ts test/tools.bus.test.ts test/p5-6-8-r3b-edit-file-patch.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

## Observability

- `write_file/edit_file` 成功后统一通过 Tool Bus previewText 回灌模型
- tool-loop 不新增新裁剪层，只继续优先使用 previewText

（章节级）评审意见：[留空,用户将给出反馈]

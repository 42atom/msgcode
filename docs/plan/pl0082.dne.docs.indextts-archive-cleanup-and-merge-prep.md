# plan-260311-indextts-archive-cleanup-and-merge-prep

## Problem

`Qwen-only TTS` 已经把 IndexTTS 赶出主链，但仓库正式真相源里仍保留旧依赖合同、旧路径解析和未使用的源码文件。现在不收口，后续合并到主链时会把“已经弃用”的实现继续带回去。

## Occam Check

1. 不加这次归档清理，系统具体坏在哪？
   - `deps/preflight/manifest/model-paths` 仍会继续暴露 IndexTTS 合同，`src/` 下也还留着未使用实现，合并后别人很难判断它到底是正式能力还是历史残留。
2. 用更少的层能不能解决？
   - 能。把正式真相源里的合同删掉，把源码和文档移到归档区，不需要新层，也不需要兼容包装。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。TTS 相关正式入口只剩 Qwen，一切 IndexTTS 退到归档。

## Decision

采用最小可删方案：

1. 正式真相源中去掉 IndexTTS 合同
2. 未使用源码移动到 `.trash/日期-主题/`
3. 专项历史文档移动到 `docs/archive/`
4. 不主动处理其他无关脏改动，只在结尾汇报剩余工作树

## Alternatives

### 方案 A：只改文案，不动文件

优点：

- 风险小

缺点：

- 源码和依赖合同还在继续误导

不推荐。

### 方案 B：直接删除全部 IndexTTS 文件

优点：

- 仓库最干净

缺点：

- 失去追溯材料
- 不符合“优先移动到归档/.trash”的规则

不推荐。

### 方案 C：正式真相源删口径，遗留移归档（推荐）

优点：

- 主链清楚
- 历史可追溯
- 合并前工作树容易核对

## Plan

1. 收口正式真相源
   - `src/deps/manifest.json`
   - `src/deps/preflight.ts`
   - `src/media/model-paths.ts`
   - `test/p5-7-r9-t6-model-path-hardcode-purge.test.ts`
2. 归档源码
   - `src/runners/tts/backends/indexts.ts`
   - `src/runners/tts/backends/indexts-worker.ts`
   - `src/runners/tts/emotion.ts`
3. 归档文档与垃圾
   - `AIDOCS/msgcode-2.2/indextts_optimization_memo.md`
   - 根目录空文件 `indextts`
4. 更新相关注释/测试/变更日志
   - `src/runners/tts/backends/types.ts`
   - `src/commands.ts`
   - `src/runners/tts/auto-lane.ts`
   - `test/p5-7-r26-local-model-load-retry.test.ts`
   - `docs/CHANGELOG.md`

## Result

已按最小可删版本落地：

1. 正式真相源中的 IndexTTS 合同已删除：
   - `src/deps/manifest.json`
   - `src/deps/preflight.ts`
   - `src/media/model-paths.ts`
2. 未使用源码已移入归档：
   - `.trash/2026-03-11-indextts-legacy-runtime/src/runners/tts/backends/indexts.ts`
   - `.trash/2026-03-11-indextts-legacy-runtime/src/runners/tts/backends/indexts-worker.ts`
   - `.trash/2026-03-11-indextts-legacy-runtime/src/runners/tts/emotion.ts`
3. 专项文档已移入：
   - `docs/archive/indextts_optimization_memo_v2.2.md`
4. 合并前工作树里与 IndexTTS 这条线相关的正式改动已清空；剩余 dirty 文件属于其他任务线

## Risks

1. 旧测试仍假设存在 IndexTTS 路径解析或源码文件。
   - 回滚/降级：先回退测试与 archive move，再保留正式口径清理。
2. 若有外部脚本私下引用 `src/runners/tts/emotion.ts`，归档后会失效。
   - 回滚/降级：从 `.trash` 恢复文件，但不重新接回主链。

## Test Plan

至少覆盖：

1. `model-paths` 只保留 Qwen / ASR 正式路径
2. preflight manifest 不再暴露 IndexTTS 依赖
3. 本轮已有 TTS 主链测试继续通过
4. 依赖 reload 行为锁不再要求 `emotion.ts` 存在

## Observability

- `docs/CHANGELOG.md` 记录 IndexTTS 已归档
- 归档目录保留可追溯路径

（章节级）评审意见：[留空,用户将给出反馈]

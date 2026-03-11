# plan-260311-qwen-only-tts-mainline

## Problem

当前 TTS 主链仍保留 `qwen + indextts` 双后端语义，导致命令面、`/mode`、probe 与配置诊断继续暴露一个用户已经确认弃用的次要实现。系统表面更“完整”，但实际让状态空间更乱。

## Occam Check

1. 不加这次收口，系统具体坏在哪？
   - `/tts-model`、`/mode`、doctor 仍会继续把 `indextts` 当成正式可选项，用户会被过时能力误导，甚至继续看到与 macOS 不友好的配置诊断。
2. 用更少的层能不能解决？
   - 能。直接把 TTS 主链收成 Qwen-only，不新增兼容层、不新增新 provider，也不做替代 fallback。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。TTS 从“双后端 + fallback”收成“单后端 + auto/显式 qwen”。

## Decision

采用最小可删方案：

1. `src/runners/tts.ts` 主链只保留 Qwen 选择
2. `/tts-model` 只允许 `qwen | auto`
3. `/mode` 改为只回显 Qwen-only 语义
4. TTS probe 只检查 Qwen 配置；若检测到旧 `TTS_BACKEND=indextts`，只做忽略说明，不再引导配置 IndexTTS
5. 历史 IndexTTS 文件先保留，不做物理删除

## Alternatives

### 方案 A：彻底删除 IndexTTS 所有文件

优点：

- 仓库更干净

缺点：

- 影响面太大
- 会波及历史文档、路径解析、依赖清单与遗留脚本
- 当前目标只是收口主链，不值得大扫除

不推荐。

### 方案 B：继续保留双后端，但默认只用 Qwen

优点：

- 表面兼容更多

缺点：

- 命令面和 probe 仍继续暴露无效选项
- 继续保留多主链心智负担

不推荐。

### 方案 C：主链 Qwen-only，IndexTTS 退为历史残留（推荐）

优点：

- 改动集中
- 用户心智清楚
- 与“先删主链复杂度，再谈历史清理”一致

## Plan

1. 收口运行时
   - `src/runners/tts.ts`
   - 移除 `qwen -> indextts` fallback
2. 收口用户可见协议
   - `src/handlers.ts`
   - `src/routes/cmd-model.ts`
   - `src/routes/cmd-info.ts`
   - `AIDOCS/design/command-dictionary-260311-backend-lanes-v1.md`
3. 收口诊断口径
   - `src/probe/probes/tts.ts`
4. 补测试与文档
   - `test/p5-6-13-r2a-tts-qwen-contract.test.ts`
   - `test/p5-7-r24-backend-command-lanes.test.ts`
   - `test/p5-7-r31-qwen-only-tts-mainline.test.ts`
   - `issues/0081-qwen-only-tts-mainline.md`
   - `docs/CHANGELOG.md`

## Result

已按最小可删版本落地：

1. `runTts()` 已收口为 Qwen-only，不再回退到 `indextts`
2. `/tts-model` 只接受 `qwen | auto`，旧残值会按 `auto` 处理
3. `/mode` 只回显 `strict:qwen` 或 `auto:qwen`
4. TTS probe 只检查 Qwen 配置；检测到旧 `TTS_BACKEND=indextts` 时会明确标记“已忽略旧配置”
5. 历史 IndexTTS 文件仍保留在仓库中，但已退出正式主链与用户可见协议

## Risks

1. 旧环境里如果残留 `TTS_BACKEND=indextts`，行为会从“严格 indextts”变成“忽略旧值，回到 Qwen-only”。
   - 回滚/降级：回退 `src/runners/tts.ts`、`src/handlers.ts`、`src/routes/cmd-model.ts` 与本轮测试。
2. 如果 probe 还继续提示 IndexTTS 缺失，会和新主链口径冲突。
   - 回滚/降级：优先保留 Qwen-only 运行时，单独回退 probe 文案。

## Test Plan

至少覆盖：

1. 坏 ref 时 Qwen-only 主链直接失败，不再回退
2. `/mode` 只回显 `strict:qwen` 或 `auto:qwen`
3. `/tts-model` 只接受 `qwen | auto`
4. 当前分支 `tts-model` 仍优先于 `TTS_BACKEND`

## Observability

- `/mode` 应明确回显当前 `tts-model`
- logger 中的 `backendMode` 应反映 `strict:qwen` 或 `auto:qwen`

（章节级）评审意见：[留空,用户将给出反馈]

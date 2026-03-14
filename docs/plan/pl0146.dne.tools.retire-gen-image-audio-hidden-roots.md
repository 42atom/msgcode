# plan-260313-retire-gen-image-audio-hidden-roots

## Problem

虽然根级公开命令面已经统一为 `gen`，但 `gen-image` 与 `gen-audio` 仍作为隐藏 compat root 可 direct invoke。

这会继续制造“双口径但 help 不可见”的问题：

- 正式文案说生成入口是 `msgcode gen ...`
- 实际执行面却还保留两组旧根命令

## Occam Check

### 不加它，系统具体坏在哪？

- 生成能力继续保留隐藏重复入口
- 用户和模型都可能误以为 `gen` 之外还存在另一套正式根命令

### 用更少的层能不能解决？

- 能。直接退役 `gen-image` 与 `gen-audio` 根入口，不新增替代层

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是隐藏重复入口

## Decision

选定方案：保留 `msgcode gen ...` 作为唯一正式生成入口，把 `gen-image` / `gen-audio` 收口为 retired compat 提示。

核心理由：

1. 它们不代表新的能力边界
2. 当前正式合同已经完全覆盖 `image/selfie/tts/music`
3. 显式 retired 提示比静默兼容更符合“程序是真合同”的原则

## Plan

1. 更新 `src/cli/gen-image.ts`
   - 保留 `createGenImageCommand` / `createGenSelfieCommand`
   - 新增 `createGenImageRetiredRootCommand`

2. 更新 `src/cli/gen-audio.ts`
   - 保留 `createGenTtsCommand` / `createGenMusicCommand`
   - 新增 `createGenAudioRetiredRootCommand`

3. 更新 `src/cli.ts`
   - `top === "gen-image" | "gen-audio"` 时加载 retired compat root，而非旧命令组

4. 更新测试
   - `test/p5-7-r6-2-gen-image-contract.test.ts`
   - `test/p5-7-r6-3-gen-audio-contract.test.ts`
   - `test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts`

## Risks

1. 历史脚本仍直接调用 `gen-image` / `gen-audio`
   回滚/降级：保留 retired compat 提示，不恢复隐藏根入口执行链

## Test Plan

- `msgcode gen --help` 继续包含 `image/selfie/tts/music`
- `msgcode gen-image --help` 返回 retired 提示
- `msgcode gen-audio --help` 返回 retired 提示
- `help-docs --json` 继续只导出 `msgcode gen ...` 合同

（章节级）评审意见：[留空,用户将给出反馈]

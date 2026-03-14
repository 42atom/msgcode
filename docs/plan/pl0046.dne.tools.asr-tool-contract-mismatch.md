# 修复 asr 工具合同不一致导致的空路径失败

## Problem

飞书语音消息已经能够成功下载并复制到 vault，但 `asr` 工具执行时仍然报错 `输入文件不存在:`。现有证据表明，问题不在附件链路，而在 `asr` 工具说明书与 Tool Bus 执行参数不一致：说明书要求 `audioPath`，执行层却读取 `inputPath`。

## Occam Check

1. 不加它，系统具体坏在哪里？
   飞书语音进入附件主链后，模型即使按工具说明书正确传 `audioPath`，Tool Bus 仍会把空字符串传给 `runAsr()`，导致 ASR 恒定失败。

2. 用更少的层能不能解决？
   可以。直接对齐现有 `asr` 合同字段，并做最小兼容，不需要新增 wrapper、fallback 或新工具。

3. 这个改动让主链数量变多了还是变少了？
   变少。去掉说明书字段和执行字段的双口径，回到单一工具合同。

## Decision

采用最小修复方案：
- 以 `audioPath` 作为对外说明书主字段
- Tool Bus 在 `asr` 分支兼容读取 `audioPath` 和 `inputPath`
- 保持 `runAsr()` 内部仍使用 `inputPath`，不扩大改动面

理由：
- 不改现有 runner 签名，风险最小
- 兼容已有潜在调用方
- 能最快修掉当前飞书语音失败

## Plan

1. 修改 `src/tools/bus.ts`
   - `case "asr"` 改为优先读取 `args.audioPath`，兼容 `args.inputPath`
2. 检查并视需要同步 `src/tools/manifest.ts` / `src/tools/types.ts` 注释与合同文案
3. 补测试
   - manifest/bus 合同测试
   - 至少锁住“传 `audioPath` 时不会空路径失败”
4. 用现有飞书语音链路做定向验证

## Risks

- 若仓库里存在旧调用方使用 `inputPath`，简单地只改成 `audioPath` 会造成兼容问题
- 因此本次不删除 `inputPath` 兼容读取，只统一对外说明书口径

回滚策略：
- 仅为小范围工具合同修复，回滚单文件改动即可

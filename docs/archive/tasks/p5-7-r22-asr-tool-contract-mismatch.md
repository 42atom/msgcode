# 任务单：ASR 工具合同不一致修复

## 回链

- Issue: [0046](../../issues/0046-asr-tool-contract-mismatch.md)
- Plan: docs/plan/pl0046.dne.tools.asr-tool-contract-mismatch.md

## 目标

1. 对齐 `asr` 说明书字段与 Tool Bus 执行字段
2. 保持对旧 `inputPath` 调用的兼容
3. 用合同回归锁防止再次分叉

## 范围

1. `src/tools/manifest.ts`
2. `src/tools/bus.ts`
3. `src/tools/types.ts`
4. `test/p5-7-r22-asr-tool-contract.test.ts`

## 非范围

1. 不重构飞书附件主链
2. 不改 ASR runner 内部接口
3. 不新增 wrapper

## 验收

1. `audioPath` 成为对外说明书主字段
2. Tool Bus 兼容 `audioPath` 与旧 `inputPath`
3. 回归测试通过

# 本地模型 2 次 load 重试策略

## Problem

本地模型生命周期现在分散在聊天、视觉、情感分析三条链路里：有的只等一次，有的只做普通重试，有的完全不尝试 load，导致用户看到的行为不一致。

## Occam Check

- 不加它，系统具体坏在哪？
  本地模型未加载或 crash 时，主链会直接失败，用户需要自己猜该去哪条链手动恢复。
- 用更少的层能不能解决？
  能。直接在现有 `runtime/model-service-lease.ts` 补 `load + retryable error` helper，再复用到调用点即可。
- 这个改动让主链数量变多了还是变少了？
  变少了。三条本地模型链路改成同一 reload 口径。

## Decision

在 `runtime/model-service-lease.ts` 增加本地模型 `load` 动作与统一 reload helper；聊天、视觉、情感分析全部复用它，最大重试次数固定为 2。

## Plan

- 在 `src/runtime/model-service-lease.ts` 增加：
  - `LOCAL_MODEL_LOAD_MAX_RETRIES`
  - `createLocalModelLoadAction()`
  - `shouldRetryLocalModelLoad()`
  - `maybeReloadLocalModelAndRetry()`
- 在 `src/agent-backend/chat.ts` 的三个 LM Studio 调用入口接入 helper
- 在 `src/agent-backend/chat.ts` 放宽 `resolveLmStudioModelId()`，允许回退到 catalog model key
- 在 `src/runners/vision.ts` 接入 helper
- 在 `src/runners/tts/emotion.ts` 接入 helper
- 补 `test/p5-7-r26-local-model-load-retry.test.ts`

## Risks

- 风险：错误判定过宽，导致不该 reload 的错误也走了重试
- 回滚：回退 `src/runtime/model-service-lease.ts`、`src/agent-backend/chat.ts`、`src/runners/vision.ts`、`src/runners/tts/emotion.ts` 与新增测试

（章节级）评审意见：[留空,用户将给出反馈]

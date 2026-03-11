---
id: 0092
title: 测试现代化：本体重构后收口高漂移静态锁到行为合同
status: done
owner: agent
labels: [test, refactor, docs]
risk: medium
scope: context-policy/handlers/tool-loop/fs-scope/compat 层测试真相源收口
plan_doc: docs/design/plan-260312-test-suite-modernization-after-core-refactor.md
links: []
---

## Context

最近几轮主线重构已经完成：

1. 本地 backend lane、provider 真相源、tool manifest、PI 残留、skills 历史层、`fs_scope` 等都已收口。
2. 发布门槛已恢复可信，但 `test/` 里仍有一批测试继续直接读取源码字符串，锁的是实现写法，不是运行时合同。
3. 这类测试在重构后最容易制造“代码没坏、测试先漂”的噪音，尤其集中在 `context-policy / handlers / tool-loop / lmstudio / workspace` 这几条高漂移主链。

盘点结果（2026-03-12，初始）：

- `test/` 共 `151` 个测试文件
- 其中至少 `60` 个文件仍包含 `readFileSync(...)` / `fs.existsSync(...)` 这类源码级静态锁
- 其中部分是有价值的硬切断言（例如退役文件不存在），但一批只是把当前实现细节写死

本轮已完成四批现代化收口后：

- 静态锁文件数已从 `60` 降到 `50`
- 第一批聚焦 `context-policy / fs-scope / hard-cut`
- 第二批聚焦 `handlers / system prompt / scheduler / summary injection`
- 第三批聚焦 `default model / alias guard / local model retry / routed-chat / tool-loop quota`
- 第四批聚焦 `listener / codex policy / feishu message handler context`

## Goal / Non-Goals

### Goal

- 把首批高漂移静态锁收口为行为测试或导出合同测试
- 保留真正有价值的硬切断言
- 让测试继续指向当前单一真相源，而不是回拖旧实现

### Non-Goals

- 不在本轮重写全部 `151` 个测试文件
- 不为了适配旧测试去回退主代码设计
- 不新增新的测试框架、runner、辅助平台

## Plan

- [x] 建立 0092 issue / plan，冻结范围、分类和首批文件
- [x] 第一批：改造 `context-policy / fs_scope / hard-cut` 相关高漂移测试
- [x] 第二批：改造 `handlers / system prompt / scheduler / window-summary` 相关高漂移测试
- [x] 第三批：改造 `default model / alias guard / local model retry / routed-chat / tool-loop quota` 相关高漂移测试
- [x] 第四批：改造 `listener / codex policy / feishu message handler context` 相关高漂移测试

## Acceptance Criteria

1. 首批高漂移测试不再通过 `readFileSync("src/...")` 锁定 `handlers/context-policy/tool-loop/workspace/lmstudio` 的具体实现写法。
2. 退役主链的硬切测试仍保留，但只锁“文件不存在/导出不存在/运行时不暴露”，不锁无关源码字面量。
3. 首批改造后的 targeted suites 全绿。
4. issue 与 plan 记录清楚首批范围、保留理由和后续批次入口。
5. 第四批改造后 `bun test` 全量回归恢复全绿。

## Notes

- Audit:
  - `rg -l "readFileSync\\(|fs\\.existsSync\\(" test | wc -l` -> `60`（初始）
  - `rg -l "readFileSync\\(|fs\\.existsSync\\(" test | wc -l` -> `58`（第二批后）
  - `rg -l "readFileSync\\(|fs\\.existsSync\\(" test | wc -l` -> `54`（第三批后）
  - `rg -l "readFileSync\\(|fs\\.existsSync\\(" test | wc -l` -> `50`（第四批后）
  - `rg --files test | wc -l` -> `151`
- First batch completed:
  - `test/p5-7-r9-t2-context-budget-compact.test.ts`
  - `test/p5-7-r9-t3-memory-persistence-clear-boundary.test.ts`
  - `test/p6-agent-run-core-phase3-context-policy.test.ts`
  - `test/p5-7-r3i-fs-scope-policy.test.ts`
  - `test/p5-6-8-r3e-hard-cut.test.ts`
- Second batch completed:
  - `test/p5-6-8-r4b-window-summary-injection.test.ts`
  - `test/p5-6-7-r6-smoke-static.test.ts`
  - `test/p5-6-2-r1-regression.test.ts`
  - `test/p5-7-r3n-system-prompt-file-ref.test.ts`
  - `test/p5-7-r17-scheduler-pointer-only.test.ts`
- Third batch completed:
  - `test/p5-7-r6b-default-model-preference.test.ts`
  - `test/p5-7-r26-local-model-load-retry.test.ts`
  - `test/p5-7-r3e-model-alias-guard.test.ts`
  - `test/p5-7-r20-llm-unshackle-phase2.test.ts`
  - `test/p5-7-r21-routed-chat-unshackle-phase3.test.ts`
- Fourth batch completed:
  - `test/p5-6-13-r4-listener-trigger.test.ts`
  - `test/p5-7-r9-t5-codex-policy-dedup.test.ts`
  - `test/p6-feishu-message-context-phase1.test.ts`
  - `test/p6-feishu-message-context-phase2.test.ts`
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-8-r4b-window-summary-injection.test.ts test/p5-6-7-r6-smoke-static.test.ts test/p5-6-2-r1-regression.test.ts test/p5-7-r3n-system-prompt-file-ref.test.ts test/p5-7-r17-scheduler-pointer-only.test.ts` -> `27 pass / 0 fail`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r9-t2-context-budget-compact.test.ts test/p5-7-r9-t3-memory-persistence-clear-boundary.test.ts test/p6-agent-run-core-phase3-context-policy.test.ts test/p5-7-r3i-fs-scope-policy.test.ts test/p5-6-8-r3e-hard-cut.test.ts test/p5-6-8-r4b-window-summary-injection.test.ts test/p5-6-7-r6-smoke-static.test.ts test/p5-6-2-r1-regression.test.ts test/p5-7-r3n-system-prompt-file-ref.test.ts test/p5-7-r17-scheduler-pointer-only.test.ts` -> `52 pass / 0 fail`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r6b-default-model-preference.test.ts test/p5-7-r26-local-model-load-retry.test.ts test/p5-7-r3e-model-alias-guard.test.ts test/p5-7-r20-llm-unshackle-phase2.test.ts test/p5-7-r21-routed-chat-unshackle-phase3.test.ts` -> `17 pass / 0 fail`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-13-r4-listener-trigger.test.ts test/p5-7-r9-t5-codex-policy-dedup.test.ts test/p6-feishu-message-context-phase1.test.ts test/p6-feishu-message-context-phase2.test.ts test/p5-6-2-r1-regression.test.ts test/listener.test.ts test/tools.bus.test.ts` -> `51 pass / 0 fail`
  - `PATH="$HOME/.bun/bin:$PATH" bun test` -> `1500 pass / 0 fail`

## Links

- Plan: docs/design/plan-260312-test-suite-modernization-after-core-refactor.md

---
id: 0095
title: imsg sunset 后续收口：archive 与命名清理
status: done
owner: agent
labels: [refactor, docs, chore]
risk: medium
scope: 0093 后续的 archive 真相源、legacy error code、发送合同命名与参考资料标识收口
plan_doc: docs/design/plan-260312-imsg-sunset-followup-archive-and-naming-cleanup.md
links:
  - issues/0093-feishu-only-channel-simplification-and-imsg-sunset.md
  - AIDOCS/reviews/gemini-review-findings-0093.md
---

## Context

[Issue 0093](/Users/admin/GitProjects/msgcode/issues/0093-feishu-only-channel-simplification-and-imsg-sunset.md) 已完成 Feishu-only 主链收口，但后续 review 仍指出几类尚未收干净的遗留点：

- `.trash/2026-03-12-imsg-sunset/` 不进 Git，导致 retired runtime archive 缺少版本化真相源
- `src/jobs/types.ts` 仍保留 `IMSG_SEND_FAILED`
- 内部发送合同仍使用 `chat_guid`
- `AIDOCS/refs/imessage-kit` 一类 iMessage 参考资料仍缺少明确的 legacy/archive 标识

输入文档：

- [AIDOCS/reviews/gemini-review-findings-0093.md](/Users/admin/GitProjects/msgcode/AIDOCS/reviews/gemini-review-findings-0093.md)

这轮不重新打开 `0093` 的大迁移，只做收尾清理，保证主链口径、自我描述与归档证据一致。

## Goal / Non-Goals

### Goal

- 为 retired `imsg` runtime 补齐版本化 archive 真相源
- 清理现役契约里的 iMessage 特化命名残影
- 明确参考资料的历史地位，减少“现役能力幻觉”

### Non-Goals

- 本轮不恢复 `src/imsg/` 到主树
- 本轮不重做 transport / route store / workspace runtime 全量命名迁移
- 本轮不重写历史 research 文档正文，只加索引和标识

## Plan

- [x] 新建版本化 archive 目录，收入口袋里的 retired `imsg` runtime 源码/测试/说明
- [x] 更新 `0093` issue、plan、CHANGELOG、archive 索引，移除对 `.trash` 的真相源依赖
- [x] 将 `JobErrorCode.IMSG_SEND_FAILED` 收口为 channel-neutral 命名
- [x] 将现役发送合同的 `chat_guid` 收口为 `chatId`
- [x] 为 `AIDOCS/refs/imessage-kit` 相关参考资料补 legacy/archive 标识
- [x] 补回归测试与 typecheck，确保本轮只做薄收口、不扩大协议面

## Acceptance Criteria

1. `imsg` retired runtime 在 Git 内有可审查的 archive 目录，不再只存在于 `.trash`。
2. `docs/CHANGELOG.md` 与 `0093` issue/plan 不再把 `.trash` 当作唯一 archive 真相源。
3. `src/jobs/types.ts` 与 `src/jobs/runner.ts` 不再暴露 `IMSG_SEND_FAILED`。
4. 现役发送合同不再使用 `chat_guid` 命名。
5. `AIDOCS/refs/imessage-kit` 有明确的历史参考标识，不再伪装为现役主链依赖。

## Notes

- 这轮优先级：
  1. archive 真相源
  2. error code 收口
  3. send 合同命名
  4. refs 标识
- `runtime.current_chat_guid` 等更深层 legacy 字段暂不在本轮处理，避免把收尾清理升级成大迁移。
- 已落地：
  - 新增 `docs/archive/retired-imsg-runtime/`，收录 `src/imsg/*`、两条 legacy 测试与 `vendor/imsg/v0.4.0/imsg` 最小快照
  - `0093` issue / plan / changelog / archive 索引已改为指向版本化 archive
  - `src/jobs/types.ts` 与 `src/jobs/runner.ts` 已把 `IMSG_SEND_FAILED` 收口为 `DELIVERY_FAILED`
  - 现役发送合同已在 `src/channels/types.ts` 中固定为 `OutboundMessage.chatId`
  - `AIDOCS/refs/README.md`、`docs/testing/TEST_GATE_WHITELIST.md`、`scripts/test-gate.js` 已明确 `imessage-kit` 只是历史参考实现
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/listener.test.ts test/p5-6-13-r4-listener-trigger.test.ts test/p5-7-r12-feishu-send-file.test.ts test/p5-6-8-r4c-test-gate-whitelist.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p6-agent-run-core-phase1.test.ts test/p6-agent-run-core-phase2-session-key.test.ts test/p6-agent-run-core-phase4-run-events.test.ts`
  - `npx tsc --noEmit`

## Links

- [Parent Issue](/Users/admin/GitProjects/msgcode/issues/0093-feishu-only-channel-simplification-and-imsg-sunset.md)
- [Plan](/Users/admin/GitProjects/msgcode/docs/design/plan-260312-imsg-sunset-followup-archive-and-naming-cleanup.md)
- [Review Input](/Users/admin/GitProjects/msgcode/AIDOCS/reviews/gemini-review-findings-0093.md)

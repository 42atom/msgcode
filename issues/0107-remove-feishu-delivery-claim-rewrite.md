---
id: 0107
title: 移除系统对飞书发送措辞的最终改写
status: done
owner: agent
labels: [refactor, architecture]
risk: medium
scope: agent-backend/tool-loop 退出 hardenFeishuDeliveryClaim 系统代答旁路
plan_doc: docs/design/plan-260312-remove-feishu-delivery-claim-rewrite.md
links: []
---

## Context

`tool-loop` 当前会在模型生成最终答复后，再用 `hardenFeishuDeliveryClaim()` 检查“是否声称已把文件发到飞书”。如果 prompt 像“发文件回群”，而模型回答里出现“已发送”，但本轮没有成功的 `feishu_send_file` 结果，系统就会把模型原答案改写成一段固定文案。这属于系统直接改写模型交付，不符合当前“AI 主执行者、系统不代答”的主线。

## Goal / Non-Goals

### Goal

- 删除 `hardenFeishuDeliveryClaim()` 及其调用
- 保留 `feishu_send_file` 作为正式发送工具的提示，但不再由系统改写模型最终措辞
- 更新回归锁，避免继续依赖系统代改写

### Non-Goals

- 本轮不修改 `feishu_send_file` 工具本身的成功/失败语义
- 本轮不新增新的发送校验层
- 本轮不改 live skill corpus

## Plan

- [x] 新建 `0107` issue 与对应 plan，冻结边界
- [x] 删除 `tool-loop` 中 `hardenFeishuDeliveryClaim()` 及相关辅助函数/测试导出
- [x] 更新 `feishu_send_file` 回归测试，移除对系统代改写 helper 的依赖
- [x] 跑定向测试、类型检查和 docs:check

## Acceptance Criteria

- `tool-loop` 不再改写模型“已发送”类回答
- `feishu_send_file` 的成功/失败真相仍由工具结果决定
- 相关测试不再依赖 `tool-loop.__test.hardenFeishuDeliveryClaim`

## Notes

- 已实现：
  - 删除 `hardenFeishuDeliveryClaim()`、相关辅助函数与调用点
  - `tool-loop.__test` 不再导出该 helper
  - `feishu_send_file` 回归测试改为只锁工具结果真相，不再锁系统代改写
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r12-feishu-send-file.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts test/p5-7-r3g-multi-tool-loop.test.ts`
    - 通过
  - `npx tsc --noEmit`
    - `EXIT:0`
  - `npm run docs:check`
    - `✓ 文档同步检查通过`

## Links

- /Users/admin/GitProjects/msgcode/issues/0102-llm-execution-authority-charter.md
- /Users/admin/GitProjects/msgcode/issues/0103-ai-os-foundation-roadmap.md

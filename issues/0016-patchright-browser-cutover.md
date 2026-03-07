---
id: 0016
title: Patchright 浏览器底座切换（Chrome-as-State）
status: open
owner: agent
labels: [feature, refactor, browser]
risk: high
scope: browser/runtime/prompt/tests/docs
plan_doc: docs/design/plan-260307-patchright-browser-cutover.md
links:
  - issues/0015-patchright-phase-a-validation.md
  - issues/0013-pinchtab-single-browser-substrate-bootstrap.md
created: 2026-03-07
due:
---

## Context

- Phase A 已完成，Patchright 在直启和 `connectOverCDP` 两种模式下都通过了 browserscan 的 WebDriver/CDP 检测。
- Phase A 选型结论已冻结为 α：Chrome-as-State。
- 当前正式浏览器主链仍然是 PinchTab，相关运行时、prompt、tests、docs 仍写死了 PinchTab 口径。

## Goal / Non-Goals

### Goals

- 用 Patchright 替换 PinchTab 成为唯一正式浏览器底座。
- 保持现有 `$WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>` 路径契约。
- 去掉 PinchTab orchestrator/baseUrl/binary 的运行时依赖和提示词暴露。
- 让 `browser` 工具在无状态 `ref` 语义下继续可用。

### Non-Goals

- 本轮不保留双底座兼容层。
- 本轮不引入 Patchright daemon。
- 本轮不解决内容农场的代理池/指纹策略问题。

## Plan

- [ ] 创建并评审 Phase B Plan：`docs/design/plan-260307-patchright-browser-cutover.md`
- [ ] 新增 Patchright runner，替换 PinchTab runner
- [ ] 重写 browser CLI / gmail readonly / tool bus 接线
- [ ] 更新启动链与 prompt 口径
- [ ] 更新 browser manifest、tests 与 docs
- [ ] 移除 PinchTab 专属 runtime 暴露

## Acceptance Criteria

1. `browser` 工具不再依赖 PinchTab orchestrator。
2. `connectOverCDP` 成为唯一正式浏览器连接方式。
3. `tabs.snapshot` / `tabs.action` 使用无状态可重建 ref。
4. 所有 browser 相关回归测试通过。
5. msgcode 重启后 browser 主链可直接工作。

## Notes

- Phase A 报告：`docs/notes/research-260307-patchright-phase-a.md`

## Links

- Plan: `docs/design/plan-260307-patchright-browser-cutover.md`
- Related: `issues/0015-patchright-phase-a-validation.md`

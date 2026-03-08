---
id: 0028
title: 收口 LLM 约束层并制定松绑计划
status: done
owner: agent
labels: [refactor, agent, docs]
risk: high
scope: agent-first 路由、tool-loop、prompt、工具暴露与协议限制
plan_doc: docs/design/plan-260308-llm-unshackle.md
links: []
---

## Context

最近真实日志已经证明，当前系统不是“LLM 不会做事”，而是框架在多处前置约束和中途阻断：

- 自然语言请求一度落到 `no tools exposed`，模型只能吐伪 `[TOOL_CALL]`
- 修到能真实 `read_file` 后，又被“未暴露工具：bash”直接打死
- skill 主链本应是 `读 skill -> 执行 skill -> 继续循环`，但当前实现把这条链拆成半套能力

这意味着：问题核心不是能力不足，而是约束层过多。

## Goal / Non-Goals

### Goal

- 盘点所有会阻断 LLM 的约束点
- 明确哪些约束必须删除、哪些需要降级、哪些可以保留
- 形成逐步松绑的执行顺序

### Non-Goals

- 本单不直接大改 agent-first 主链
- 本单不顺手重构 browser / memory / scheduler
- 本单不做 prompt 分层实验

## Plan

- [x] 盘点代码中的限制点并分类：前置裁判 / 中途协议阻断 / 次数上限 / prompt 硬约束 / 工具面裁剪
- [x] 为每个限制点记录：代码位置、当前行为、真实失败证据、建议处理方式
- [x] 产出“松绑顺序”：P0 先拆、P1 再收、P2 观察保留
- [x] 明确需要后续创建的派单清单

## Acceptance Criteria

- 有一份完整的限制清单
- 每个限制点都有代码证据与建议动作
- 有清晰的优先级与派单顺序
- 结论符合 README 中的“支持优先、不得阻断 LLM”铁律

## Notes

### 已确认的真实失败证据

- Logs：`/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-07 17:20:58`：`agent-first chat fallback: no tools exposed`
  - `2026-03-07 17:38:56`：`Tool Bus: SUCCESS read_file`
  - `2026-03-07 17:38:59`：`未暴露工具：bash` / `MODEL_PROTOCOL_FAILED`

### 后续落地

1. `0041` 已完成 prompt/tool-loop Phase 2 清理，删除剩余流程裁判器并抬高默认 quota。
2. 真实日志已出现：
   - `03:56:50.055 Tool Bus: SUCCESS read_file`
   - `03:56:51.545 Tool Bus: SUCCESS bash`
   - `03:57:02.388 消息处理完成`
3. 新时间窗内未再出现新的 `MODEL_PROTOCOL_FAILED`。

## Links

- /Users/admin/GitProjects/msgcode/docs/design/plan-260308-llm-unshackle.md
- /Users/admin/GitProjects/msgcode/README.md
- /Users/admin/GitProjects/msgcode/issues/0041-llm-unshackle-phase2-remove-control-logic.md

# plan-260223-r9-t7-agent-backend-core-extraction

Issue: 0002  
Task: docs/tasks/p5-7-r9-t7-agent-backend-core-extraction.md

## Problem

`src/lmstudio.ts` 当前仍承担 agent-backend 主链大部分实现，导致：
1. 代码边界不清晰，后端切换改动影响面过大。
2. 兼容层与业务层混杂，难以建立“兼容壳只出不进”的硬约束。
3. 高耦合文件对回归测试不友好，重构成本持续上升。

## Decision

选择“核心拆分 + 兼容壳保留”路线：
1. 把配置、提示词、tool loop、routed chat 分拆到 `src/agent-backend/` 子模块。
2. `src/lmstudio.ts` 只保留兼容导出与注释，不再承载新主链逻辑。
3. 以行为锁替代源码字符串锁，防止未来回流和脆弱断言。

## Plan

1. 模块骨架拆分：新增 `types/config/prompt/tool-loop/routed-chat` 文件并建立中性导出。
2. 逻辑迁移：分两步迁移 config+prompt，再迁移 tool-loop+routed-chat，确保每步门禁全绿。
3. 兼容收口：`lmstudio.ts` 仅保留兼容 API；补回归锁（新入口锁、兼容壳锁、行为一致锁、规模锁）。
4. 文档同步：更新 `R9-T7` 任务单状态与证据模板，保持 issue-plan-task 互链可校验。

## Risks

1. tool loop 迁移引发行为漂移（温度/路由/actionJournal）；回滚/降级：按提交粒度回退到上一步并先修回归锁。
2. 历史测试依赖实现细节导致误报；回滚/降级：优先改为行为断言，暂保留兼容别名。

## Migration / Rollout

1. 先迁移内部实现，再切调用点，最后收紧兼容层。
2. 保持 `runLmStudio*` 别名导出至 R9 阶段收敛完成，避免外部调用瞬断。

## Test Plan

1. 每步执行 `npx tsc --noEmit` + `npm test` + `npm run docs:check`。
2. 新增 `p5-7-r9-t7` 回归锁覆盖：
   - 禁止新增 `runLmStudio*` 业务调用
   - `runAgent*` 路由与温度行为一致
   - `actionJournal` 结构一致

## Observability

1. 保持 `traceId/route/phase/kernel` 观测字段不变。
2. 对迁移后的模块继续输出 `MODEL_PROTOCOL_FAILED`、`TOOL_EXEC_FAILED` 诊断路径。

（章节级）评审意见：[留空,用户将给出反馈]

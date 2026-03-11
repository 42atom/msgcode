# 任务单：P5.7-R5c（回头优化：File-First 状态收敛）

优先级：P2（R8 后排队执行，不抢当前主线）

## 目标（冻结）

1. 贯彻 `Everything is a file`：业务状态以文件为唯一真相源（SSOT）。
2. 除记忆索引外，移除业务对 DB 的主状态依赖。
3. 统一三类载体：`md`（人读叙事）、`json`（机读状态）、`yml`（声明配置）。
4. 保持可重建：索引可从文件全量重放，不影响业务正确性。

## 范围（冻结）

1. `thread/todo/schedule` 状态写路径改为 file-first。
2. `memory` 保留索引数据库（FTS/Vec），但只作为投影层，不做真相源。
3. 补齐 `rebuild-index` 与一致性校验命令（从文件重建索引）。

## 非范围

1. 不改 R6 多模态 provider 选型。
2. 不改 R3l 三核链路协议。
3. 不做跨机器同步协议设计。

## 数据载体规范（冻结）

1. `md`：日志、journal、记忆正文。
2. `json`：thread/todo/schedule 运行态与快照。
3. `yml`：策略配置、路由策略、生命周期参数。

## 执行步骤（每步一提交）

1. `refactor(p5.7-r5c): migrate thread/todo/schedule to file-first ssot`
2. `feat(p5.7-r5c): keep memory db as projection and add rebuild-index`
3. `test(p5.7-r5c): add file-first consistency and regression lock`
4. `docs(p5.7-r5c): update help-docs contracts and data layout guide`

## 验收标准（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真成功证据：删库后 `rebuild-index` 可恢复查询能力
5. 真失败证据：文件损坏/缺失时返回固定错误码
6. 无新增 `.only/.skip`

## 风险与约束

1. 禁止双写真相源（文件 + DB 同时作为主状态）。
2. 索引落后不得影响主流程正确性（允许 eventual consistency）。
3. 迁移阶段需提供只读回滚开关（紧急切回旧读路径）。

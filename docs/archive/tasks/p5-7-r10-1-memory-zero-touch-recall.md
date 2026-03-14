# 任务单：P5.7-R10-1（memory 零手工索引召回）

优先级：P0

## 目标（冻结）

1. 用户执行 `memory add` 后，`memory search` 在同 workspace 下可直接命中，不要求先手动 `memory index`。
2. 保持现有 `memory index` 命令兼容可用（不删不改语义）。
3. 修复 `npm run memory:e2e` 漂移，确保脚本可持续验证召回链路。

## 涉及文件（预期）

- `/Users/admin/GitProjects/msgcode/src/cli/memory.ts`
- `/Users/admin/GitProjects/msgcode/src/memory/store.ts`（仅在需要增量索引时）
- `/Users/admin/GitProjects/msgcode/scripts/memory/e2e-recall.ts`
- `/Users/admin/GitProjects/msgcode/test/*memory*`

## 范围外（冻结）

1. 不改 `memory` 错误码枚举语义（仅新增时需评审）。
2. 不改 `thread/todo/schedule` 命令逻辑。
3. 不引入新的外部存储。

## 实施要求（冻结）

1. 优先“最小改动”：
   - 写入时增量更新索引，或
   - 搜索时做一次自愈索引（命中为空且检测到索引落后时）。
2. 日志必须可观测：
   - 是否触发自动索引
   - 触发原因（写入后增量/搜索自愈）
3. `memory:e2e` 必须覆盖 `add -> search` 零手工索引主路径。

## 提交建议

1. `feat(p5.7-r10-1): make memory recall zero-touch without manual index`
2. `test(p5.7-r10-1): add memory zero-touch recall regression lock`

## 验收标准（冻结）

1. `msgcode memory add "<marker>" --workspace <abs-path>` 后直接  
   `msgcode memory search "<marker>" --workspace <abs-path>` 命中 `count>=1`。
2. `msgcode memory index` 仍返回成功且不破坏结果。
3. `npm run memory:e2e` 通过。
4. 三门全绿：`tsc` / `test` / `docs:check`。

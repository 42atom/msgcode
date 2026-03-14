# 任务单：P5.7-R3l-7（Tool 协议重试 + SOUL 路径纠偏）

优先级：P0（工具链路稳定性止血）

## 目标（冻结）

1. 降低 `tool` 路由下首轮漏发 `tool_calls` 的失败率。
2. 修复 `read_file` 读取 SOUL 文件时常见路径漂移（`<workspace>/SOUL.md` vs `<workspace>/.msgcode/SOUL.md`）。
3. 保持 R3l-1 硬门口径：最终仍无 `tool_calls` 时必须 `MODEL_PROTOCOL_FAILED`。

## 线上现象

1. `执行 bash pwd` 进入 `tool` 路由后，偶发 `toolCallCount=0`，触发 `MODEL_PROTOCOL_FAILED`。
2. `你能读取soul文件吗` 进入 `tool` 路由后，模型生成路径为 `<workspace>/SOUL.md`，导致 `ENOENT`。

## 方案

1. 在 `runLmStudioToolLoop` 增加一次协议重试：
   - 首轮 `toolChoice=auto` 无 `tool_calls` 时，追加一条“仅返回 tool_calls”的重试提示。
   - 第二次请求使用 `toolChoice=required`。
2. 在 `runTool(read_file)` 前增加参数归一化：
   - 若目标为 `SOUL.md` 且原路径不存在，自动探测 `<workspace>/.msgcode/SOUL.md` 并改写。

## 代码变更

1. `src/lmstudio.ts`
   - 新增 `normalizeReadFilePathArgs(...)`。
   - `runTool(...)` 改为先执行参数归一化，再调用 Tool Bus。
   - `runLmStudioToolLoop(...)` 增加 `toolChoice=required` 重试路径。
2. `test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`
   - 新增 2 条行为回归：
     - 首轮无 `tool_calls`，二次 `required` 重试成功。
     - `read_file` 自动纠偏到 `.msgcode/SOUL.md` 并成功。

## 验收结果

1. `npx tsc --noEmit`：PASS
2. `npm test -- test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`：PASS
3. 回归保护：
   - `test/p5-7-r3l-1-tool-protocol-hard-gate.test.ts`：PASS
   - `test/p5-7-r3l-4-journal-hotfix-regression.test.ts`：PASS

## 实机链路验证（minimax）

1. `执行 bash pwd`：
   - 路由：`tool`
   - 工具：`bash`
   - 输出：`/Users/admin/msgcode-workspaces/medicpass`
2. `你能读取soul文件吗`：
   - 路由：`tool`
   - 工具：`read_file`
   - 结果：成功读取 SOUL 内容

## 风险与后续

1. 当前 `SOUL.md` 纠偏是特例规则（低风险止血）。
2. 后续可收敛为“文件别名映射层”（统一管理 `.msgcode/*` 常见别名），避免分散特判。

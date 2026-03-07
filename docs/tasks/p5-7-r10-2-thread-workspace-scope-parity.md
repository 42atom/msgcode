# 任务单：P5.7-R10-2（thread workspace 作用域一致性）

优先级：P1

## 目标（冻结）

1. `thread` 命令补齐可选 `--workspace <id|path>` 参数，行为与现有 workspace 型命令一致。
2. 默认行为保持兼容（不传 `--workspace` 时维持当前全局行为）。
3. 修复“unknown option --workspace”类真实可用性问题。

## 涉及文件（预期）

- `/Users/admin/GitProjects/msgcode/src/cli/thread.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`
- `/Users/admin/GitProjects/msgcode/test/p5-7-r4-2-thread-contract.test.ts`
- `/Users/admin/GitProjects/msgcode/test/*thread*`

## 范围外（冻结）

1. 不改 route store 存储结构。
2. 不改 thread 文件落盘格式。
3. 不引入跨 workspace 的新索引。

## 实施要求（冻结）

1. 参数口径：
   - `thread list`：支持 workspace 过滤
   - `thread messages <thread-id>`：可选 workspace 校验（thread 必须属于指定 workspace）
   - `thread switch <thread-id>`：可选 workspace 校验
   - `thread active`：可选 workspace 校验（不匹配返回固定失败码）
2. `--workspace` 支持 ID、相对路径、绝对路径（与 memory/todo/schedule 对齐）。
3. 错误码必须固定，不得返回伪成功。

## 提交建议

1. `feat(p5.7-r10-2): add workspace scoping support for thread commands`
2. `test(p5.7-r10-2): add thread workspace-scope regression lock`

## 验收标准（冻结）

1. `thread` 全命令在传入 `--workspace` 时不再报 `unknown option`。
2. workspace 不匹配时返回固定错误码（可诊断）。
3. 不传 `--workspace` 的旧调用行为保持不变。
4. 三门全绿：`tsc` / `test` / `docs:check`。

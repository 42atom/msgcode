# 任务单：P5.7-R4-T1（Memory/Thread 真机冒烟门禁）

优先级：P1（`R4` 出口门禁，进入 `R5` 前必须通过）

## 目标（冻结）

1. 在真实工作区验证 `memory/thread` 命令链路可用。
2. 验证合同口径稳定：`help-docs --json` 可发现全部 `memory/thread` 命令。
3. 验证错误码语义稳定：参数错误与执行错误必须可区分。
4. 作为 `P5.7-R5` 前置门禁，留存成功/失败证据。

## 范围

- `msgcode memory add/search/stats`
- `msgcode thread list/messages/active/switch`
- `msgcode help-docs --json`
- `/Users/admin/GitProjects/msgcode/test/p5-7-r4-t1-*.test.ts`

## 非范围

1. 不新增业务命令。
2. 不改 memory/thread 核心实现逻辑。
3. 不改 ToolLoop 路由与模型策略。

## 验证清单（冻结）

1. Memory 成功链：
   - `memory add` 成功
   - `memory search` 命中新增内容
   - `memory stats` 返回统计
2. Thread 成功链：
   - `thread switch` 成功
   - `thread active` 返回与 switch 一致的快照
3. 失败链：
   - 空查询触发 `MEMORY_EMPTY_QUERY`
   - 无效 thread id 触发固定错误码（如 `THREAD_NOT_FOUND`）
   - 无活动线程触发 `THREAD_NO_ACTIVE_THREAD`
4. 合同可发现：
   - `help-docs --json` 含全部 `memory/thread` 命令

## 断言规范（冻结）

1. 必须是行为断言：调用真实命令/函数验证返回结构。
2. 禁止源码字符串断言：不允许 `readFileSync(...src/*)` + `toContain("...")`。
3. 禁止 `.only/.skip`。

## 执行步骤（单提交）

1. `test(p5.7-r4-t1): add memory-thread smoke verification gate`

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 至少 2 条成功证据 + 2 条失败证据（含固定错误码）
